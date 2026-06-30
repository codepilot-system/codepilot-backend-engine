import prisma from '../../lib/prisma';
import { ApiError } from '../../lib/ApiError';
import { createIssues, createSuggestions } from '../issues/issues.service';
import { calculateAndSaveAnalytics } from '../analytics/analytics.service';
import { analyzeFileContents } from './analysis/analyzer';
import { fetchRepoFiles, getLatestCommitSha, fetchPackageJson, FetchedFile } from './scan-github';
import { analyzeRepoInChunks } from './scan-chunker';
import { FunctionAnalysis, AnalyzerOutput } from './analysis/types';
import { Category, Severity, IssueSource } from '@prisma/client';

export async function runRepoScanPipeline(scanId: number): Promise<void> {
    try {
        const scan = await prisma.scan.findUnique({
            where: { id: scanId },
            include: { project: true }
        });

        if (!scan) {
            console.error(`[ScanPipeline] runRepoScanPipeline called with unknown scanId ${scanId}`);
            return;
        }

        const { project, branchName } = scan;

        if (!project.installationId) {
            await markScanFailed(scanId, 'GitHub App is not installed on this repository');
            return;
        }


        const commitSha = await getLatestCommitSha(
            project.installationId,
            project.owner,
            project.repoName,
            branchName
        );

        const files = await fetchRepoFiles(
            project.installationId,
            project.owner,
            project.repoName,
            commitSha
        );

        if (files.length === 0) {
            console.warn(`[ScanPipeline] No files fetched for scan ${scanId}. Marking FAILED.`);
            await markScanFailed(scanId, 'No files were fetched from the repository');
            return;
        }

        const packageJson = await fetchPackageJson(
            project.installationId,
            project.owner,
            project.repoName,
            commitSha
        );

        const folderTree = buildFolderTree(files);
        const dependencies = packageJson ? extractDependencies([packageJson]) : undefined;
        const projectSummary = project.projectSummary ?? undefined;

        const analyzerOutput = analyzeFileContents(
            files.map((f) => ({ filePath: f.filePath, content: f.content })),
            'repo'
        );

        console.log(
            `[ScanPipeline] Analyzer found ${analyzerOutput.findings.length} finding(s) across ${analyzerOutput.summary.totalFilesAnalyzed} file(s)`
        );


        if (analyzerOutput.findings.length > 0) {
            const analyzerIssueInputs = mapAnalyzerFindingsToIssueInputs(analyzerOutput);
            await createIssues(analyzerIssueInputs, scanId, project.id);
            console.log(`[ScanPipeline] Persisted ${analyzerIssueInputs.length} ANALYZER issue(s)`);
        }

        const codeFiles = files.map((f) => ({
            filePath: f.filePath,
            content: f.content,
        }));

        const aiResult = await analyzeRepoInChunks(
            codeFiles,
            String(project.id),
            projectSummary,
            folderTree,
            dependencies,
        );

        console.log(
            `[ScanPipeline] AI analysis complete: ${aiResult.issues.length} issue(s) from ${aiResult.chunkCount - aiResult.failedChunks}/${aiResult.chunkCount} chunk(s), ` +
            `${aiResult.tokensUsed} tokens, ${aiResult.durationMs}ms, model: ${aiResult.modelUsed}`
        );

        if (aiResult.issues.length > 0) {
            await createIssues(
                aiResult.issues.map((issue) => ({
                    filePath: issue.filePath,
                    lineNumber: issue.lineNumber ?? 0,
                    severity: sanitizeSeverity(issue.severity),
                    category: sanitizeCategory(issue.category),
                    summary: issue.summary,
                    explanation: issue.explanation,
                    codeSnippet: issue.codeSnippet,
                    source: IssueSource.AI,
                })),
                scanId,
                project.id
            );
            console.log(`[ScanPipeline] Persisted ${aiResult.issues.length} AI issue(s)`);
        }


        const savedAiIssues = await prisma.issue.findMany({
            where: { scanId, source: IssueSource.AI },
            orderBy: { id: 'asc' },
        });

        const suggestionsToCreate = aiResult.issues
            .map((issue, idx) => {
                const matchingIssue = savedAiIssues[idx];
                if (!matchingIssue || !issue.diffPatch) return null;
                return {
                    issueId: matchingIssue.id,
                    scanId,
                    projectId: project.id,
                    summary: issue.suggestedFixSummary,
                    explanation: issue.explanation,
                    diffPatch: issue.diffPatch,
                };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);

        if (suggestionsToCreate.length > 0) {
            await createSuggestions(suggestionsToCreate);
            console.log(`[ScanPipeline] Persisted ${suggestionsToCreate.length} suggestion(s)`);
        }


        const totalIssueCount = analyzerOutput.findings.length + aiResult.issues.length;
        if (totalIssueCount > 0) {
            await calculateAndSaveAnalytics(scanId, project.id);
        } else {
            await calculateAndSaveAnalyticsForEmptyScan(scanId, project.id);
        }


        await prisma.scan.update({
            where: { id: scanId },
            data: {
                status: 'COMPLETED',
                commitSha,
                modelUsed: aiResult.modelUsed,
                tokensUsed: aiResult.tokensUsed,
                durationMs: aiResult.durationMs,
            }
        });

        await prisma.project.update({
            where: { id: project.id },
            data: { lastScanDate: new Date(), lastScannedCommitSha: commitSha }
        });

        console.log(`[ScanPipeline] Scan ${scanId} completed successfully`);

    } catch (error) {
        console.error(`[ScanPipeline] Pipeline failed for scan ${scanId}:`, error);
        await markScanFailed(
            scanId,
            error instanceof ApiError ? error.message : 'Unexpected error during scan'
        );
    }
}

function mapAnalyzerFindingsToIssueInputs(
    analyzerOutput: AnalyzerOutput
): Parameters<typeof createIssues>[0] {
    const rows: Parameters<typeof createIssues>[0] = [];

    for (const fn of analyzerOutput.findings) {
        for (const finding of fn.findings) {
            rows.push({
                filePath: fn.filePath,
                lineNumber: fn.startLine,
                severity: mapAnalyzerSeverity(finding.severity),
                category: mapAnalyzerIssueType(finding.issueType),
                summary: buildAnalyzerSummary(fn, finding.issueType),
                explanation: buildAnalyzerExplanation(fn, finding),
                codeSnippet: undefined,
                source: IssueSource.ANALYZER,
            });
        }
    }

    return rows;
}

function mapAnalyzerSeverity(severity: string): Severity {
    const map: Record<string, Severity> = {
        LOW: 'LOW',
        MEDIUM: 'MEDIUM',
        HIGH: 'HIGH',
        CRITICAL: 'CRITICAL',
    };
    return map[severity] ?? 'MEDIUM';
}

/**
 * Clamps an AI-returned severity string to a valid Severity enum value.
 * Falls back to MEDIUM if the model returns an unknown value.
 */
function sanitizeSeverity(value: string): Severity {
    const valid = new Set<Severity>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    const upper = value?.toUpperCase() as Severity;
    if (valid.has(upper)) return upper;
    console.warn(`[ScanPipeline] Unknown severity from AI: "${value}" — defaulting to MEDIUM`);
    return 'MEDIUM';
}

/**
 * Clamps an AI-returned category string to a valid Category enum value.
 * Maps common AI hallucinations to the closest valid value,
 * then falls back to OTHER for anything unrecognised.
 */
function sanitizeCategory(value: string): Category {
    const valid = new Set<Category>([
        'CODE_SMELL', 'DEAD_CODE', 'DUPLICATE', 'COMPLEXITY',
        'SRP_VIOLATION', 'SECURITY', 'PERFORMANCE', 'FUNCTIONALITY', 'OTHER',
    ]);
    const upper = value?.toUpperCase() as Category;
    if (valid.has(upper)) return upper;

    const fallbackMap: Record<string, Category> = {
        NAMING: 'CODE_SMELL',
        MAINTAINABILITY: 'CODE_SMELL',
        READABILITY: 'CODE_SMELL',
        STYLE: 'CODE_SMELL',
        BUG: 'FUNCTIONALITY',
        ERROR_HANDLING: 'FUNCTIONALITY',
        NULL_CHECK: 'FUNCTIONALITY',
        MEMORY: 'PERFORMANCE',
        CONCURRENCY: 'SECURITY',
        INJECTION: 'SECURITY',
    };

    const mapped = fallbackMap[upper];
    if (mapped) {
        console.warn(`[ScanPipeline] Unknown category from AI: "${value}" — mapped to ${mapped}`);
        return mapped;
    }

    console.warn(`[ScanPipeline] Unknown category from AI: "${value}" — defaulting to OTHER`);
    return 'OTHER';
}

function mapAnalyzerIssueType(issueType: string): Category {
    const map: Record<string, Category> = {
        LONG_FUNCTION: 'COMPLEXITY',
        DEEP_NESTING: 'COMPLEXITY',
        SRP_VIOLATION: 'SRP_VIOLATION',
        DUPLICATE: 'DUPLICATE',
        HIGH_COMPLEXITY: 'COMPLEXITY',
    };
    return map[issueType] ?? 'OTHER';
}

function buildAnalyzerSummary(fn: FunctionAnalysis, issueType: string): string {
    const labels: Record<string, string> = {
        LONG_FUNCTION: 'Long function',
        DEEP_NESTING: 'Deep nesting',
        SRP_VIOLATION: 'SRP violation',
        DUPLICATE: 'Duplicate code',
        HIGH_COMPLEXITY: 'High cyclomatic complexity',
    };
    const label = labels[issueType] ?? issueType;
    return `${label} in \`${fn.functionName}\``;
}

function buildAnalyzerExplanation(fn: FunctionAnalysis, finding: FunctionAnalysis['findings'][number]): string {
    const signals = finding.signals;
    const parts: string[] = [
        `Function \`${fn.functionName}\` (lines ${fn.startLine}–${fn.endLine}).`,
    ];

    if ('lineCount' in signals) parts.push(`Function is ${signals.lineCount} lines long.`);
    if ('nestingDepth' in signals) parts.push(`Maximum nesting depth: ${signals.nestingDepth}.`);
    if ('concerns' in signals && Array.isArray(signals.concerns))
        parts.push(`Concerns: ${signals.concerns.join(', ')}.`);
    if ('duplicateGroupId' in signals)
        parts.push(`Duplicate group ID: ${signals.duplicateGroupId}.`);
    if ('cc' in signals) parts.push(`Cyclomatic complexity: ${signals.cc}${signals.ccBoost ? ` (confidence boosted +${signals.ccBoost} due to high CC)` : ''}.`);

    parts.push(`Confidence: ${finding.confidence}.`);
    return parts.join(' ');
}

async function markScanFailed(scanId: number, reason: string): Promise<void> {
    console.error(`[ScanPipeline] Marking scan ${scanId} as FAILED: ${reason}`);
    await prisma.scan.update({
        where: { id: scanId },
        data: { status: 'FAILED' }
    }).catch((err) => {
        console.error(`[ScanPipeline] Failed to even mark scan ${scanId} as FAILED:`, err);
    });
}

async function calculateAndSaveAnalyticsForEmptyScan(
    scanId: number,
    projectId: number
): Promise<void> {
    await prisma.analytics.create({
        data: {
            scanId,
            projectId,
            avgComplexity: 0,
            technicalDebtScore: 0,
            severityDistribution: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
        }
    });
}

function buildFolderTree(files: FetchedFile[]): string {
    return files.map((f) => f.filePath).sort().join('\n');
}

function extractDependencies(files: FetchedFile[]): string | undefined {
    const pkgFile = files.find((f) => f.filePath === 'package.json');
    if (!pkgFile) return undefined;
    try {
        const pkg = JSON.parse(pkgFile.content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const depNames = Object.keys(deps);
        return depNames.length > 0 ? depNames.join(', ') : undefined;
    } catch {
        return undefined;
    }
}
