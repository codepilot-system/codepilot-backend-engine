import { fetchRepoFiles, fetchPackageJson, getLatestCommitSha, fetchFileContent } from '../../../../services/scans/scan-github';
import { getInstallationOctokit } from '../../../../services/github/github.service';
import { ApiError } from '../../../../lib/ApiError';

jest.mock('p-limit', () => jest.fn().mockImplementation(() => jest.fn().mockImplementation((fn) => fn())));

jest.mock('../../../../services/github/github.service', () => ({
    getInstallationOctokit: jest.fn(),
}));

describe('scan-github service', () => {
    let mockOctokit: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockOctokit = {
            request: jest.fn(),
        };
        (getInstallationOctokit as jest.Mock).mockResolvedValue(mockOctokit);
    });

    describe('getLatestCommitSha', () => {
        it('should return commit sha', async () => {
            mockOctokit.request.mockResolvedValueOnce({ data: { sha: 'sha123' } });
            const sha = await getLatestCommitSha(123, 'owner', 'repo', 'main');
            expect(sha).toBe('sha123');
            expect(mockOctokit.request).toHaveBeenCalledWith(
                'GET /repos/{owner}/{repo}/commits/{ref}',
                expect.objectContaining({ owner: 'owner', repo: 'repo', ref: 'main' })
            );
        });
    });

    describe('fetchFileContent', () => {
        it('should return decoded file content', async () => {
            mockOctokit.request.mockResolvedValueOnce({
                data: { type: 'file', content: Buffer.from('hello').toString('base64') }
            });
            const content = await fetchFileContent(123, 'owner', 'repo', 'path/file.ts', 'main');
            expect(content).toBe('hello');
        });

        it('should return null for directory or non-file', async () => {
            mockOctokit.request.mockResolvedValueOnce({
                data: { type: 'dir' }
            });
            const content = await fetchFileContent(123, 'owner', 'repo', 'path', 'main');
            expect(content).toBeNull();
        });

        it('should return null on request failure', async () => {
            mockOctokit.request.mockRejectedValueOnce(new Error('Not found'));
            const content = await fetchFileContent(123, 'owner', 'repo', 'path', 'main');
            expect(content).toBeNull();
        });
    });

    describe('fetchPackageJson', () => {
        it('should fetch package.json', async () => {
            mockOctokit.request.mockResolvedValueOnce({
                data: { type: 'file', content: Buffer.from('{}').toString('base64') }
            });
            const result = await fetchPackageJson(123, 'owner', 'repo', 'main');
            expect(result).toEqual({ filePath: 'package.json', content: '{}' });
        });

        it('should return null if not found', async () => {
            mockOctokit.request.mockRejectedValueOnce(new Error('Not found'));
            const result = await fetchPackageJson(123, 'owner', 'repo', 'main');
            expect(result).toBeNull();
        });
    });

    describe('fetchRepoFiles', () => {
        it('should fetch scannable files successfully', async () => {
            mockOctokit.request
                .mockResolvedValueOnce({ data: { commit: { tree: { sha: 'tree123' } } } }) // commit tree
                .mockResolvedValueOnce({
                    data: {
                        truncated: false,
                        tree: [
                            { type: 'blob', path: 'index.ts', size: 100 },
                            { type: 'blob', path: 'node_modules/index.ts', size: 100 }, // Ignored
                            { type: 'blob', path: 'large.ts', size: 300000 }, // Ignored size
                            { type: 'blob', path: 'image.png', size: 100 }, // Ignored ext
                        ]
                    }
                }) // git tree
                .mockResolvedValueOnce({
                    data: { type: 'file', content: Buffer.from('content').toString('base64') }
                }); // content

            const files = await fetchRepoFiles(123, 'owner', 'repo', 'main');
            expect(files).toHaveLength(1);
            expect(files[0].filePath).toBe('index.ts');
            expect(files[0].content).toBe('content');
        });

        it('should throw ApiError if no scannable files found', async () => {
            mockOctokit.request
                .mockResolvedValueOnce({ data: { commit: { tree: { sha: 'tree123' } } } })
                .mockResolvedValueOnce({ data: { tree: [] } });

            await expect(fetchRepoFiles(123, 'owner', 'repo', 'main'))
                .rejects.toThrow(ApiError);
        });
        
        it('should throw ApiError if unable to fetch any file contents', async () => {
            mockOctokit.request
                .mockResolvedValueOnce({ data: { commit: { tree: { sha: 'tree123' } } } })
                .mockResolvedValueOnce({
                    data: {
                        tree: [
                            { type: 'blob', path: 'index.ts', size: 100 }
                        ]
                    }
                })
                .mockRejectedValueOnce(new Error('Fetch failed'));
            
            await expect(fetchRepoFiles(123, 'owner', 'repo', 'main'))
                .rejects.toThrow(ApiError);
        });
    });
});
