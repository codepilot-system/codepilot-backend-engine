import prisma from '../../lib/prisma';
import { ApiError } from '../../lib/ApiError';
import { analyzeRepoScan } from '../ai/ai.service';
import { createIssues, createSuggestions } from '../issues/issues.service';
import { calculateAndSaveAnalytics } from '../analytics/analytics.service';
import { analyzeFileContents } from './analysis/analyzer';
import { fetchRepoFiles, getLatestCommitSha, fetchPackageJson, FetchedFile } from './scan-github';
import { buildCodeFilesFromFindings, buildFindingsSummaryText } from './scan-findings-bridge';


export async function runRepoScanPipeline(scanId: number): Promise<void> {
    try {
        const scan = await prisma.scan.findUnique({
            where: { id: scanId },
            include: { project: true }
        });

        if (!scan) {
            console.error(`[ScanService] runRepoScanPipeline called with unknown scanId ${scanId}`);
            return;
        }

        const { project, branchName } = scan;

        if (!project.installationId) {
            await markScanFailed(scanId, 'GitHub App is not installed on this repository');
            return;
        }

        const commitSha = await getLatestCommitSha(project.installationId, project.owner, project.repoName, branchName);
        const files = await fetchRepoFiles(project.installationId, project.owner, project.repoName, commitSha);
        const packageJson = await fetchPackageJson(project.installationId, project.owner, project.repoName, commitSha);



        const analyzerOutput = analyzeFileContents(
            files.map((f) => ({ filePath: f.filePath, content: f.content })),
            'repo'
        );


        if (analyzerOutput.findings.length === 0) {
            await prisma.scan.update({
                where: { id: scanId },
                data: { status: 'COMPLETED', commitSha }
            });
            await calculateAndSaveAnalyticsForEmptyScan(scanId, project.id);
            return;
        }

        const codeFiles = buildCodeFilesFromFindings(files, analyzerOutput);
        const findingsSummary = buildFindingsSummaryText(analyzerOutput);
        const folderTree = buildFolderTree(files);
        const dependencies = packageJson ? extractDependencies([packageJson]) : undefined;

        const aiResult = await analyzeRepoScan(
            codeFiles,
            String(project.id),
            undefined,
            project.projectSummary ?? undefined,
            undefined,
            folderTree,
            dependencies,
            findingsSummary
        );

        const createdIssues = await createIssues(
            aiResult.issues.map((issue) => ({
                filePath: issue.filePath,
                lineNumber: issue.lineNumber ?? 0,
                severity: issue.severity,
                category: issue.category,
                summary: issue.summary,
                explanation: issue.explanation,
                codeSnippet: issue.codeSnippet,
            })),
            scanId,
            project.id
        );


        const savedIssues = await prisma.issue.findMany({
            where: { scanId },
            orderBy: { id: 'asc' }
        });

        const suggestionsToCreate = aiResult.issues
            .map((issue, idx) => {
                const matchingIssue = savedIssues[idx];
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
        }

        await calculateAndSaveAnalytics(scanId, project.id);

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

    } catch (error) {
        console.error(`[ScanService] Pipeline failed for scan ${scanId}:`, error);
        await markScanFailed(scanId, error instanceof ApiError ? error.message : 'Unexpected error during scan');
    }
}

async function markScanFailed(scanId: number, reason: string): Promise<void> {
    console.error(`[ScanService] Marking scan ${scanId} as FAILED: ${reason}`);
    await prisma.scan.update({
        where: { id: scanId },
        data: { status: 'FAILED' }
    }).catch((err) => {
        console.error(`[ScanService] Failed to even mark scan ${scanId} as FAILED:`, err);
    });
}

async function calculateAndSaveAnalyticsForEmptyScan(scanId: number, projectId: number): Promise<void> {
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
    const paths = files.map((f) => f.filePath).sort();
    return paths.join('\n');
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

