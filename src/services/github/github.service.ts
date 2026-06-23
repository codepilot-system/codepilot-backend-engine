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

export const getInstallationOctokit = async (installationId: number) => {
    try {
        return await githubApp.getInstallationOctokit(installationId);
    } catch {
        throw new ApiError(`Failed to authenticate as GitHub App installation ${installationId}`, 500);
    }
};

export const getInstallationToken = async (installationId: number): Promise<string> => {
    try {
        const auth = await githubApp.octokit.auth({
            type: 'installation',
            installationId,
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
