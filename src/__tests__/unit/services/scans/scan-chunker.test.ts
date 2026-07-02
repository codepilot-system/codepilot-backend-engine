import { analyzeRepoInChunks } from '../../../../services/scans/scan-chunker';
import { analyzeRepoScan } from '../../../../services/ai/ai.service';

jest.mock('../../../../services/ai/ai.service');

describe('Scan Chunker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('analyzeRepoInChunks', () => {
        const mockFiles = [
            { filePath: 'file1.ts', content: 'a'.repeat(200000) },
            { filePath: 'file2.ts', content: 'b'.repeat(200000) },
            { filePath: 'file3.ts', content: 'c'.repeat(200000) },
        ];

        it('should split files into chunks and analyze each', async () => {
            (analyzeRepoScan as jest.Mock).mockResolvedValue({
                issues: [
                    {
                        filePath: 'file1.ts',
                        lineNumber: 1,
                        severity: 'HIGH',
                        category: 'CODE_SMELL',
                        summary: 'Test issue',
                    },
                ],
                tokensUsed: 1000,
                durationMs: 500,
                modelUsed: 'test-model',
            });

            const result = await analyzeRepoInChunks(
                mockFiles,
                '1',
                'Test project summary',
                'folder tree',
                'dependencies',
                'test-model',
            );

            expect(analyzeRepoScan).toHaveBeenCalled();
            expect(result.chunkCount).toBeGreaterThan(0);
            expect(result.issues.length).toBeGreaterThan(0);
            expect(result.tokensUsed).toBeGreaterThan(0);
            expect(result.durationMs).toBeGreaterThan(0);
            expect(result.modelUsed).toContain('test-model');
        });

        it('should continue processing when some chunks fail', async () => {
            (analyzeRepoScan as jest.Mock)
                .mockResolvedValueOnce({
                    issues: [
                        {
                            filePath: 'file1.ts',
                            lineNumber: 1,
                            severity: 'HIGH',
                            category: 'CODE_SMELL',
                            summary: 'Issue',
                        },
                    ],
                    tokensUsed: 100,
                    durationMs: 50,
                    modelUsed: 'test-model',
                })
                .mockRejectedValueOnce(new Error('Chunk failed'))
                .mockResolvedValue({
                    issues: [
                        {
                            filePath: 'file3.ts',
                            lineNumber: 1,
                            severity: 'LOW',
                            category: 'CODE_SMELL',
                            summary: 'Issue',
                        },
                    ],
                    tokensUsed: 100,
                    durationMs: 50,
                    modelUsed: 'test-model',
                });

            const result = await analyzeRepoInChunks(
                mockFiles,
                '1',
                undefined,
                undefined,
                undefined,
            );

            expect(result.failedChunks).toBeGreaterThan(0);
            expect(result.issues.length).toBeGreaterThan(0);
            expect(analyzeRepoScan).toHaveBeenCalled();
        });

        it('should throw when every chunk fails', async () => {
            (analyzeRepoScan as jest.Mock).mockRejectedValue(
                new Error('Chunk failed'),
            );

            await expect(
                analyzeRepoInChunks(mockFiles, '1', undefined, undefined, undefined),
            ).rejects.toThrow();
        });

        it('should reject an empty repository', async () => {
            await expect(
                analyzeRepoInChunks([], '1', undefined, undefined, undefined),
            ).rejects.toThrow();
        });

        it('should aggregate metrics from all successful chunks', async () => {
            (analyzeRepoScan as jest.Mock).mockImplementation(async () => ({
                issues: [],
                tokensUsed: 100,
                durationMs: 50,
                modelUsed: 'test-model',
            }));

            const result = await analyzeRepoInChunks(
                mockFiles,
                '1',
                undefined,
                undefined,
                undefined,
            );

            expect(analyzeRepoScan).toHaveBeenCalled();
            expect(result.tokensUsed).toBeGreaterThan(0);
            expect(result.durationMs).toBeGreaterThan(0);
            expect(result.chunkCount).toBeGreaterThan(0);
            expect(result.failedChunks).toBe(0);
            expect(result.modelUsed).toContain('test-model');
        });

        it('should pass project context to AI analysis', async () => {
            (analyzeRepoScan as jest.Mock).mockResolvedValue({
                issues: [],
                tokensUsed: 500,
                durationMs: 200,
                modelUsed: 'test-model',
            });

            await analyzeRepoInChunks(
                mockFiles,
                '1',
                'Project summary',
                'Folder tree',
                'Dependencies',
                'preferred-model',
            );

            expect(analyzeRepoScan).toHaveBeenCalledWith(
                expect.any(Array),
                '1',
                'preferred-model',
                'Project summary',
                undefined,
                'Folder tree',
                'Dependencies',
            );
        });
    });

    describe('chunking logic', () => {
        beforeEach(() => {
            (analyzeRepoScan as jest.Mock).mockResolvedValue({
                issues: [],
                tokensUsed: 100,
                durationMs: 50,
                modelUsed: 'test-model',
            });
        });

        it('should split oversized files into multiple chunks', async () => {
            const largeFile = {
                filePath: 'large.ts',
                content: 'x'.repeat(400000),
            };

            const smallFile = {
                filePath: 'small.ts',
                content: 'y'.repeat(50000),
            };

            const result = await analyzeRepoInChunks(
                [largeFile, smallFile],
                '1',
                undefined,
                undefined,
                undefined,
            );

            expect(result.chunkCount).toBeGreaterThan(1);
            expect(analyzeRepoScan).toHaveBeenCalledTimes(result.chunkCount);
        });

        it('should split repositories with many files into multiple chunks', async () => {
            const manyFiles = Array.from({ length: 15 }, (_, i) => ({
                filePath: `file${i}.ts`,
                content: 'x'.repeat(10000),
            }));

            const result = await analyzeRepoInChunks(
                manyFiles,
                '1',
                undefined,
                undefined,
                undefined,
            );

            expect(result.chunkCount).toBeGreaterThan(1);
            expect(analyzeRepoScan).toHaveBeenCalledTimes(result.chunkCount);
        });
    });
});
