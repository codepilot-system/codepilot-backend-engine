import prisma from '../../lib/prisma';
import { ApiError } from '../../lib/ApiError';
import { ScanStatus } from '@prisma/client';
import { analyzeLocalScan, CodeFile } from '../ai/ai.service';
import { runRepoScanPipeline } from './scan-pipeline';
import { analyzeFileContents } from './analysis/analyzer';
import { buildScanReportPdf } from './scan-report.pdf';



interface RawScanFile {
    path: string;
    content: string;
    selectedLines?: { start: number; end: number }[];
}

interface LineRange {
    start: number;
    end: number;
}


function validateAndMergeLines(filePath: string, content: string, selectedLines?: { start: number; end: number }[]): LineRange[] | undefined {
    if (!selectedLines || selectedLines.length === 0) return undefined;

    const totalLines = content.split('\n').length;
    const mappedLines: LineRange[] = selectedLines.map((line) => {
        const start = parseInt(String(line.start), 10);
        const end = parseInt(String(line.end), 10);

        if (isNaN(start) || isNaN(end) || start < 1 || end < start)
            throw new ApiError(`Invalid selectedLines range in file "${filePath}": start and end must be positive integers with end >= start`, 400);

        if (end > totalLines)
            throw new ApiError(`Invalid selectedLines range in file "${filePath}": end line (${end}) exceeds total lines (${totalLines})`, 400);

        return { start, end };
    });

    if (mappedLines.length <= 1) return mappedLines;

    // merge overlapping or adjacent ranges to avoid duplicate snippet tags
    mappedLines.sort((a, b) => a.start - b.start);
    const merged: LineRange[] = [mappedLines[0]];
    for (let i = 1; i < mappedLines.length; i++) {
        const prev = merged[merged.length - 1];
        if (mappedLines[i].start <= prev.end + 1) {
            prev.end = Math.max(prev.end, mappedLines[i].end);
        } else {
            merged.push(mappedLines[i]);
        }
    }
    return merged;
}


function buildScanFiles(files: RawScanFile[]): CodeFile[] {
    const scanFiles: CodeFile[] = [];

    for (const file of files) {
        if (!file.path)
            throw new ApiError('Each file must have a non-empty path', 400);
        if (typeof file.content !== 'string')
            throw new ApiError(`File "${file.path}" must have string content`, 400);

        if (!file.content.trim()) continue;

        const mergedLines = validateAndMergeLines(file.path, file.content, file.selectedLines);

        scanFiles.push({
            filePath: file.path.trim(),
            content: file.content,
            selectedLines: mergedLines && mergedLines.length > 0 ? mergedLines : undefined,
        });
    }

    if (scanFiles.length === 0)
        throw new ApiError('All provided files are empty. At least one file with content is required.', 400);

    return scanFiles;
}

async function getProjectBrief(projectId: unknown): Promise<string | undefined> {
    if (!projectId) return undefined;

    const parsedProjectId = parseInt(String(projectId), 10);
    if (isNaN(parsedProjectId))
        throw new ApiError('Invalid projectId format', 400);

    const project = await prisma.project.findUnique({
        where: { id: parsedProjectId },
        select: { projectBrief: true },
    });

    return project?.projectBrief ?? undefined;
}


export const getProjectScans = async (
    userId: number,
    projectId: number,
    status?: ScanStatus,
    page: number = 1,
    limit: number = 20
) => {
    const project = await prisma.project.findFirst({
        where: { id: projectId, members: { some: { userId } } }
    });
    if (!project) throw new ApiError('Project not found or access denied', 404);

    const skip = (page - 1) * limit;
    const where = { projectId, ...(status && { status }) };

    const [scans, total] = await prisma.$transaction([
        prisma.scan.findMany({
            where,
            orderBy: { scanDate: 'desc' },
            skip,
            take: limit,
        }),
        prisma.scan.count({ where })
    ]);

    return { scans, total };
};

export const getScanById = async (userId: number, scanId: number) => {
    const scan = await prisma.scan.findFirst({
        where: {
            id: scanId,
            project: { members: { some: { userId } } }
        }
    });

    if (!scan) throw new ApiError('Scan not found or access denied', 404);
    return scan;
};

export const startScan = async (userId: number, projectId: number, branchName: string) => {
    const project = await prisma.project.findFirst({
        where: { id: projectId, members: { some: { userId } } }
    });
    if (!project) throw new ApiError('Project not found or access denied', 404);

    const scan = await prisma.scan.create({
        data: {
            projectId,
            initiatorId: userId,
            branchName,
            status: 'IN_PROGRESS'
        }
    });


    runRepoScanPipeline(scan.id).catch((error) => {
        console.error(`[ScanService] Unhandled error dispatching pipeline for scan ${scan.id}:`, error);
    });

    return scan;
};

export const deleteScan = async (userId: number, scanId: number) => {
    const scan = await prisma.scan.findFirst({
        where: {
            id: scanId,
            project: { members: { some: { userId } } }
        }
    });

    if (!scan) throw new ApiError('Scan not found or access denied', 404);

    await prisma.scan.delete({ where: { id: scanId } });
    return true;
};


export const analyzeLocalCode = async (
    userId: number,
    files: RawScanFile[],
    projectId?: unknown,
    preferredModel?: string
) => {
    if (!Array.isArray(files) || files.length === 0)
        throw new ApiError('At least one file is required for analysis', 400);

    const scanFiles = buildScanFiles(files);
    const projectBrief = await getProjectBrief(projectId);

    const analyzerOutput = analyzeFileContents(
        scanFiles.map((f) => ({ filePath: f.filePath, content: f.content })),
        'local'
    );

    const aiResult = await analyzeLocalScan(scanFiles, String(userId), preferredModel, projectBrief);


    const issues = aiResult.issues.map((issue) => ({
        filePath: issue.filePath,
        lineNumber: issue.lineNumber,
        severity: issue.severity,
        category: issue.category,
        summary: issue.summary,
        codeSnippet: issue.codeSnippet,
        suggestions: [{
            summary: issue.suggestedFixSummary,
            explanation: issue.explanation,
            diffPatch: issue.diffPatch,
        }]
    }));

    return {
        issues,
        modelUsed: aiResult.modelUsed,
        tokensUsed: aiResult.tokensUsed,
        durationMs: aiResult.durationMs,
    };
};

export const getScanReport = async (userId: number, scanId: number) => {
    const scan = await prisma.scan.findFirst({
        where: {
            id: scanId,
            project: { members: { some: { userId } } },
        },
        include: {
            project: {
                select: {
                    id: true,
                    name: true,
                    owner: true,
                    repoName: true,
                    repoUrl: true,
                    provider: true,
                },
            },
            analytics: true,
            issues: {
                include: { suggestions: true },
                orderBy: [
                    { severity: 'desc' },
                    { category: 'asc' },
                    { filePath: 'asc' },
                    { lineNumber: 'asc' },
                ],
            },
            initiator: { select: { username: true } },
        },
    });

    if (!scan) throw new ApiError('Scan not found or access denied', 404);

    if (scan.status !== 'COMPLETED') {
        throw new ApiError('Report is only available for completed scans', 400);
    }

    if (scan.analytics.length === 0) {
        throw new ApiError('Internal server error', 500);
    }

    const analytics = scan.analytics[0];
    const buffer = await buildScanReportPdf({ scan, analytics });

    return {
        buffer,
        filename: `codepilot-scan-${scanId}-report.pdf`,
    };
}
