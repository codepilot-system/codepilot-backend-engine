import prisma from '../../../../lib/prisma';
import { runRepoScanPipeline } from '../../../../services/scans/scan-pipeline';
import { createIssues, createSuggestions } from '../../../../services/issues/issues.service';
import { calculateAndSaveAnalytics } from '../../../../services/analytics/analytics.service';
import { analyzeFileContents } from '../../../../services/scans/analysis/analyzer';
import { fetchRepoFiles, getLatestCommitSha, fetchPackageJson } from '../../../../services/scans/scan-github';
import { analyzeRepoInChunks } from '../../../../services/scans/scan-chunker';
import { IssueSource } from '@prisma/client';

jest.mock('../../../../lib/prisma');

jest.mock('../../../../services/issues/issues.service', () => ({
    createIssues: jest.fn(),
    createSuggestions: jest.fn(),
}));

jest.mock('../../../../services/analytics/analytics.service', () => ({
    calculateAndSaveAnalytics: jest.fn(),
}));

jest.mock('../../../../services/scans/analysis/analyzer', () => ({
    analyzeFileContents: jest.fn(),
}));

jest.mock('../../../../services/scans/scan-github', () => ({
    fetchRepoFiles: jest.fn(),
    getLatestCommitSha: jest.fn(),
    fetchPackageJson: jest.fn(),
}));

jest.mock('../../../../services/scans/scan-chunker', () => ({
    analyzeRepoInChunks: jest.fn(),
}));

describe('Scan Pipeline', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('runRepoScanPipeline', () => {
        it('should exit early if scan not found', async () => {
            (prisma.scan.findUnique as jest.Mock).mockResolvedValueOnce(null);

            await runRepoScanPipeline(1);
            expect(prisma.scan.findUnique).toHaveBeenCalledWith({ where: { id: 1 }, include: { project: true } });
            expect(getLatestCommitSha).not.toHaveBeenCalled();
        });

        it('should mark scan failed if github app not installed', async () => {
            (prisma.scan.findUnique as jest.Mock).mockResolvedValueOnce({
                id: 1,
                branchName: 'main',
                project: { installationId: null }
            });

            await runRepoScanPipeline(1);

            expect(prisma.scan.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { status: 'FAILED' }
            });
        });

        it('should mark scan failed if no files fetched', async () => {
            (prisma.scan.findUnique as jest.Mock).mockResolvedValueOnce({
                id: 1,
                branchName: 'main',
                project: { installationId: 123, owner: 'test', repoName: 'test', id: 10 }
            });
            (getLatestCommitSha as jest.Mock).mockResolvedValueOnce('sha123');
            (fetchRepoFiles as jest.Mock).mockResolvedValueOnce([]);

            await runRepoScanPipeline(1);

            expect(prisma.scan.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { status: 'FAILED' }
            });
        });

        it('should successfully run pipeline for a repository', async () => {
            (prisma.scan.findUnique as jest.Mock).mockResolvedValueOnce({
                id: 1,
                branchName: 'main',
                project: { installationId: 123, owner: 'test', repoName: 'test', id: 10, projectSummary: 'summary' }
            });
            (getLatestCommitSha as jest.Mock).mockResolvedValueOnce('sha123');
            (fetchRepoFiles as jest.Mock).mockResolvedValueOnce([
                { filePath: 'index.ts', content: 'console.log("hello");' },
                { filePath: 'package.json', content: '{"dependencies":{"react":"^18.0.0"}}' }
            ]);
            (fetchPackageJson as jest.Mock).mockResolvedValueOnce({
                filePath: 'package.json',
                content: '{"dependencies":{"react":"^18.0.0"}}'
            });

            (analyzeFileContents as jest.Mock).mockReturnValueOnce({
                findings: [
                    {
                        filePath: 'index.ts',
                        functionName: 'testFn',
                        startLine: 1,
                        endLine: 2,
                        findings: [{
                            issueType: 'LONG_FUNCTION',
                            severity: 'HIGH',
                            confidence: 0.9,
                            signals: { lineCount: 100 }
                        }]
                    }
                ],
                summary: { totalFilesAnalyzed: 2 }
            });

            (analyzeRepoInChunks as jest.Mock).mockResolvedValueOnce({
                issues: [
                    {
                        filePath: 'index.ts',
                        lineNumber: 1,
                        severity: 'LOW',
                        category: 'SECURITY',
                        summary: 'ai summary',
                        explanation: 'ai explanation',
                        codeSnippet: 'ai snippet',
                        diffPatch: 'patch123',
                        suggestedFixSummary: 'fix summary'
                    }
                ],
                chunkCount: 1,
                failedChunks: 0,
                tokensUsed: 100,
                durationMs: 50,
                modelUsed: 'gpt-4'
            });

            (prisma.issue.findMany as jest.Mock).mockResolvedValueOnce([
                { id: 100 }
            ]);

            await runRepoScanPipeline(1);

            expect(createIssues).toHaveBeenCalledTimes(2); // 1 for analyzer, 1 for AI
            expect(createSuggestions).toHaveBeenCalledTimes(1);
            expect(calculateAndSaveAnalytics).toHaveBeenCalledTimes(1);
            
            expect(prisma.scan.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: {
                    status: 'COMPLETED',
                    commitSha: 'sha123',
                    modelUsed: 'gpt-4',
                    tokensUsed: 100,
                    durationMs: 50,
                }
            });

            expect(prisma.project.update).toHaveBeenCalledWith({
                where: { id: 10 },
                data: { lastScanDate: expect.any(Date), lastScannedCommitSha: 'sha123' }
            });
        });

        it('should handle errors during pipeline execution', async () => {
            (prisma.scan.findUnique as jest.Mock).mockResolvedValueOnce({
                id: 1,
                branchName: 'main',
                project: { installationId: 123, owner: 'test', repoName: 'test', id: 10 }
            });
            (getLatestCommitSha as jest.Mock).mockRejectedValueOnce(new Error('GitHub error'));

            await runRepoScanPipeline(1);

            expect(prisma.scan.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { status: 'FAILED' }
            });
        });
        
        it('should fall back correctly with bad severities and categories', async () => {
            (prisma.scan.findUnique as jest.Mock).mockResolvedValueOnce({
                id: 1,
                branchName: 'main',
                project: { installationId: 123, owner: 'test', repoName: 'test', id: 10, projectSummary: 'summary' }
            });
            (getLatestCommitSha as jest.Mock).mockResolvedValueOnce('sha123');
            (fetchRepoFiles as jest.Mock).mockResolvedValueOnce([
                { filePath: 'index.ts', content: 'console.log("hello");' },
            ]);
            (fetchPackageJson as jest.Mock).mockResolvedValueOnce(null);

            (analyzeFileContents as jest.Mock).mockReturnValueOnce({
                findings: [],
                summary: { totalFilesAnalyzed: 1 }
            });

            (analyzeRepoInChunks as jest.Mock).mockResolvedValueOnce({
                issues: [
                    {
                        filePath: 'index.ts',
                        lineNumber: 1,
                        severity: 'BAD_SEVERITY',
                        category: 'BAD_CATEGORY',
                        summary: 'ai summary',
                        explanation: 'ai explanation',
                    }
                ],
                chunkCount: 1,
                failedChunks: 0,
                tokensUsed: 100,
                durationMs: 50,
                modelUsed: 'gpt-4'
            });

            (prisma.issue.findMany as jest.Mock).mockResolvedValueOnce([]);

            await runRepoScanPipeline(1);

            expect(createIssues).toHaveBeenCalledWith(
                [{
                    filePath: 'index.ts',
                    lineNumber: 1,
                    severity: 'MEDIUM',
                    category: 'OTHER',
                    summary: 'ai summary',
                    explanation: 'ai explanation',
                    codeSnippet: undefined,
                    source: IssueSource.AI,
                }],
                1,
                10
            );
        });
        
        it('should calculateAndSaveAnalyticsForEmptyScan if no issues', async () => {
            (prisma.scan.findUnique as jest.Mock).mockResolvedValueOnce({
                id: 1,
                branchName: 'main',
                project: { installationId: 123, owner: 'test', repoName: 'test', id: 10 }
            });
            (getLatestCommitSha as jest.Mock).mockResolvedValueOnce('sha123');
            (fetchRepoFiles as jest.Mock).mockResolvedValueOnce([
                { filePath: 'index.ts', content: 'console.log("hello");' },
            ]);
            (fetchPackageJson as jest.Mock).mockResolvedValueOnce(null);

            (analyzeFileContents as jest.Mock).mockReturnValueOnce({
                findings: [],
                summary: { totalFilesAnalyzed: 1 }
            });

            (analyzeRepoInChunks as jest.Mock).mockResolvedValueOnce({
                issues: [],
                chunkCount: 1,
                failedChunks: 0,
                tokensUsed: 100,
                durationMs: 50,
                modelUsed: 'gpt-4'
            });

            await runRepoScanPipeline(1);
            
            expect(prisma.analytics.create).toHaveBeenCalledWith({
                data: {
                    scanId: 1,
                    projectId: 10,
                    avgComplexity: 0,
                    technicalDebtScore: 0,
                    severityDistribution: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
                }
            });
        });
    });
});
