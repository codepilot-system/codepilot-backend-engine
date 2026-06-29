import { ApiError } from '../../lib/ApiError';
import { getInstallationOctokit } from '../github/github.service';

const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.java']);
const MAX_FILE_SIZE_BYTES = 200_000;
const MAX_FILES_PER_SCAN = 150;


export interface FetchedFile {
    filePath: string;
    content: string;
}

async function listScannableFilePaths(
    installationId: number | bigint,
    owner: string,
    repo: string,
    ref: string
): Promise<string[]> {
    const octokit = await getInstallationOctokit(installationId);

    const { data: refData } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
        owner, repo, ref,
        request: { signal: AbortSignal.timeout(15000) },
    });
    const treeSha = refData.commit.tree.sha;

    const { data: tree } = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
        owner, repo, tree_sha: treeSha, recursive: '1',
        request: { signal: AbortSignal.timeout(20000) },
    });

    if (tree.truncated) {
        console.warn(`[ScanService] Git tree truncated for ${owner}/${repo}@${ref} - some files may be skipped`);
    }

    const paths = (tree.tree ?? [])
        .filter((entry) => entry.type === 'blob' && entry.path)
        .filter((entry) => {
            const ext = '.' + (entry.path!.split('.').pop() ?? '');
            return SCANNABLE_EXTENSIONS.has(ext);
        })
        .filter((entry) => !entry.size || entry.size <= MAX_FILE_SIZE_BYTES)
        .map((entry) => entry.path!)
        .filter((p) => !p.includes('node_modules/') && !p.includes('dist/') && !p.includes('build/') && !p.includes('.venv/'));

    return paths.slice(0, MAX_FILES_PER_SCAN);
}

export async function fetchFileContent(
    installationId: number | bigint,
    owner: string,
    repo: string,
    path: string,
    ref: string
): Promise<string | null> {
    const octokit = await getInstallationOctokit(installationId);

    try {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner, repo, path, ref,
            request: { signal: AbortSignal.timeout(60000) },
        });

        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
            return null; // path was a directory or symlink, not a regular file
        }

        return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
        console.error(`[ScanService] Failed to fetch ${path} in ${owner}/${repo}@${ref}:`, error);
        return null;
    }
}

export async function fetchRepoFiles(
    installationId: number | bigint,
    owner: string,
    repo: string,
    ref: string = 'HEAD'
): Promise<FetchedFile[]> {
    const paths = await listScannableFilePaths(installationId, owner, repo, ref);

    if (paths.length === 0)
        throw new ApiError('No scannable files found in this repository', 404);

    const results = await Promise.allSettled(
        paths.map(async (filePath) => {
            const content = await fetchFileContent(installationId, owner, repo, filePath, ref);
            return content !== null ? { filePath, content } : null;
        })
    );

    const files: FetchedFile[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
            files.push(result.value);
        }
    }

    if (files.length === 0)
        throw new ApiError('Failed to fetch any file contents from this repository', 502);

    return files;
}

export async function fetchPackageJson(
    installationId: number | bigint,
    owner: string,
    repo: string,
    ref: string
): Promise<FetchedFile | null> {
    const content = await fetchFileContent(installationId, owner, repo, 'package.json', ref);
    return content !== null ? { filePath: 'package.json', content } : null;
}
export async function getLatestCommitSha(
    installationId: number | bigint,
    owner: string,
    repo: string,
    branch: string
): Promise<string> {
    const octokit = await getInstallationOctokit(installationId);

    const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
        owner, repo, ref: branch,
        request: { signal: AbortSignal.timeout(15000) },
    });

    return data.sha;
}
