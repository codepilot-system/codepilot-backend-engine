import { App } from 'octokit';
import axios from 'axios';
import { ApiError } from '../../lib/ApiError';
import { ENV } from '../../config/env.config';

export interface GitHubTokenResponse {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
}

export interface GitHubUserResponse {
    id: number;
    login: string;
    avatar_url: string;
    email: string | null;
    name: string | null;
}

const privateKey = ENV.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');

export const githubApp = new App({
    appId: ENV.GITHUB_APP_ID,
    privateKey,
    oauth: {
        clientId: ENV.GITHUB_CLIENT_ID,
        clientSecret: ENV.GITHUB_CLIENT_SECRET,
    },
    webhooks: {
        secret: ENV.GITHUB_WEBHOOK_SECRET,
    },
});

export const exchangeCodeForToken = async (code: string) => {
    const response = await axios.post<GitHubTokenResponse>('https://github.com/login/oauth/access_token', {
        client_id: ENV.GITHUB_CLIENT_ID,
        client_secret: ENV.GITHUB_CLIENT_SECRET,
        code,
    }, {
        headers: { Accept: 'application/json' },
        timeout: 10000,
    });

    if (response.data.error || !response.data.access_token) {
        console.error('GitHub OAuth error:', response.data.error_description || response.data.error);
        throw new ApiError('GitHub authentication failed', 401);
    }

    return response.data;
};

export const refreshGithubToken = async (refreshToken: string) => {
    const response = await axios.post<GitHubTokenResponse>('https://github.com/login/oauth/access_token', {
        client_id: ENV.GITHUB_CLIENT_ID,
        client_secret: ENV.GITHUB_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    }, {
        headers: { Accept: 'application/json' },
        timeout: 10000,
    });

    if (response.data.error || !response.data.access_token) {
        console.error('GitHub token refresh error:', response.data.error_description || response.data.error);
        throw new ApiError('GitHub token refresh failed', 401);
    }

    return response.data;
};

export const parseGithubUrl = (repoUrl: string): { owner: string; repoName: string } | null => {
    let path = repoUrl.trim();

    if (path.startsWith('git@github.com:'))
        path = path.replace('git@github.com:', '');
    else if (path.includes('github.com/'))
        path = path.substring(path.indexOf('github.com/') + 11);
    else if (/^[\w.-]+\/[\w.-]+$/.test(path))
        path = path;
    else return null;

    path = path.split(/[?#]/)[0].replace(/\.git$/, '');

    const parts = path.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    return {
        owner: parts[0],
        repoName: parts[1]
    };
};

export const getInstallationOctokit = async (installationId: number | bigint) => {
    try {
        return await githubApp.getInstallationOctokit(Number(installationId));
    } catch {
        throw new ApiError(`Failed to authenticate as GitHub App installation ${installationId}`, 500);
    }
};

export const getInstallationToken = async (installationId: number | bigint): Promise<string> => {
    try {
        const auth = await githubApp.octokit.auth({
            type: 'installation',
            installationId: Number(installationId),
        }) as { token: string };
        return auth.token;
    } catch {
        throw new ApiError(`Failed to generate GitHub installation token for installation ${installationId}`, 500);
    }
};

export const getUserOctokit = async (accessToken: string) => {
    const { Octokit } = await import('octokit');
    return new Octokit({ auth: accessToken });
}

export const searchGithubRepos = async (octokit: any, search: string, page: number, limit: number) => {
    const parsed = parseGithubUrl(search);

    if (parsed) {
        try {
            const { data: repo } = await octokit.request('GET /repos/{owner}/{repo}', {
                owner: parsed.owner,
                repo: parsed.repoName,
                request: { signal: AbortSignal.timeout(15000) },
            });
            return { githubRepos: [repo], totalCount: 1 };
        } catch {
            return { githubRepos: [], totalCount: 0 };
        }
    }

    const { data: allRepos } = await octokit.request('GET /user/repos', {
        per_page: 100,
        page: 1,
        sort: 'updated',
        affiliation: 'owner,collaborator,organization_member',
        request: { signal: AbortSignal.timeout(10000) },
    });

    const searchLower = search.toLowerCase();
    const filteredRepos = allRepos.filter((repo: any) =>
        repo.full_name.toLowerCase().includes(searchLower)
    );

    return {
        githubRepos: filteredRepos.slice((page - 1) * limit, page * limit),
        totalCount: filteredRepos.length
    };
};

const getGithubTimeout = () => ({ signal: AbortSignal.timeout(120000) });


export async function ensureBranch(
    octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
    owner: string,
    repo: string,
    branchName: string,
    baseSha: string
): Promise<string> {
    const createBranch = async (name: string) => {
        await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
            owner,
            repo,
            ref: `refs/heads/${name}`,
            sha: baseSha,
            request: getGithubTimeout(),
        });
    };

    try {
        await createBranch(branchName);
        return branchName;
    } catch (error) {
        const isBranchExists = typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 422;
        if (!isBranchExists) throw error;
    }

    for (let attempt = 2; attempt <= 10; attempt++) {
        const candidateName = `${branchName}-v${attempt}`;
        try {
            await createBranch(candidateName);
            return candidateName;
        } catch (error) {
            const isBranchExists = typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 422;
            if (!isBranchExists) throw error;
        }
    }

    throw new ApiError(`Failed to create unique branch name after 10 attempts for ${branchName}. Please delete unneeded branches first.`, 400);
}

export async function findOpenPrUrl(
    octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
    owner: string,
    repo: string,
    headBranch: string,
    baseBranch: string
): Promise<string | null> {
    const { data: prs } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        state: 'open',
        head: `${owner}:${headBranch}`,
        base: baseBranch,
        request: getGithubTimeout(),
    });
    return prs[0]?.html_url ?? null;
}

export async function createPullRequest(
    octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
    owner: string,
    repo: string,
    title: string,
    body: string,
    headBranch: string,
    baseBranch: string
): Promise<string> {
    const { data: pr } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        title,
        body,
        head: headBranch,
        base: baseBranch,
        request: getGithubTimeout(),
    });
    return pr.html_url;
}

export async function isBranchCreatedByCodePilot(
    octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
    owner: string,
    repo: string,
    branchName: string
): Promise<boolean> {
    try {
        const { data: ref } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/heads/{branch}', {
            owner,
            repo,
            branch: branchName,
            request: getGithubTimeout(),
        });
        const { data: commit } = await octokit.request('GET /repos/{owner}/{repo}/commits/{sha}', {
            owner,
            repo,
            sha: ref.object.sha,
            request: getGithubTimeout(),
        });
        return commit.author?.login === ENV.GITHUB_APP_BOT_LOGIN;
    } catch (error) {
        const isNotFound = typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 404;
        return !isNotFound ? false : false;
    }
}

export async function createCommit(
    octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
    owner: string,
    repo: string,
    branchName: string,
    baseSha: string,
    fileContents: Record<string, string>,
    commitMessage: string
): Promise<void> {
    const { data: baseCommit } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
        owner,
        repo,
        ref: baseSha,
        request: getGithubTimeout(),
    });
    const baseTreeSha = baseCommit.commit.tree.sha;

    const treeEntries: Array<{
        path: string;
        mode: '100644' | '100755' | '040000' | '160000' | '120000';
        type: 'blob' | 'tree' | 'commit';
        sha?: string;
        content?: string;
    }> = [];

    for (const [filePath, content] of Object.entries(fileContents)) {
        const { data: blob } = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
            owner,
            repo,
            content: Buffer.from(content).toString('base64'),
            encoding: 'base64',
            request: getGithubTimeout(),
        });
        treeEntries.push({
            path: filePath,
            mode: '100644',
            type: 'blob',
            sha: blob.sha,
        });
    }

    const { data: newTree } = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
        owner,
        repo,
        base_tree: baseTreeSha,
        tree: treeEntries,
        request: getGithubTimeout(),
    });

    const { data: newCommit } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
        owner,
        repo,
        message: commitMessage,
        tree: newTree.sha,
        parents: [baseSha],
        request: getGithubTimeout(),
    });

    await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
        owner,
        repo,
        ref: `heads/${branchName}`,
        sha: newCommit.sha,
        request: getGithubTimeout(),
    });
}
