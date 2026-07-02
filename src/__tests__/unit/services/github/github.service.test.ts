import axios from 'axios';
import { ApiError } from '../../../../lib/ApiError';


jest.mock('axios');

jest.mock('octokit', () => ({
  App: jest.fn().mockImplementation(() => ({
    getInstallationOctokit: jest.fn(),
    octokit: { auth: jest.fn() },
  })),
  Octokit: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
  })),
}));

jest.mock('../../../../config/env.config', () => ({
  ENV: {
    GITHUB_APP_ID: '123',
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-secret',
    GITHUB_REDIRECT_URI: 'http://localhost:3000/callback',
    GITHUB_WEBHOOK_SECRET: 'webhook-secret',
    GITHUB_PRIVATE_KEY: 'test-key',
    GITHUB_APP_BOT_LOGIN: 'test-bot[bot]',
  },
}));

import {
  exchangeCodeForToken,
  refreshGithubToken,
  parseGithubUrl,
  getInstallationOctokit,
  getInstallationToken,
  getUserOctokit,
  searchGithubRepos,
  ensureBranch,
  findOpenPrUrl,
  createPullRequest,
  isBranchCreatedByCodePilot,
  createCommit,
  githubApp,
} from '../../../../services/github/github.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GitHub Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exchangeCodeForToken', () => {
    it('should exchange code for access token', async () => {
      const mockData = {
        access_token: 'gho_abc123',
        token_type: 'bearer',
        scope: 'repo,user',
        refresh_token: 'ghr_refresh',
        expires_in: 7200,
      };
      mockedAxios.post.mockResolvedValue({ data: mockData });

      const result = await exchangeCodeForToken('auth-code-123');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://github.com/login/oauth/access_token',
        {
          client_id: 'test-client-id',
          client_secret: 'test-secret',
          code: 'auth-code-123',
        },
        { headers: { Accept: 'application/json' }, timeout: 10000 },
      );
      expect(result).toEqual(mockData);
    });

    it('should throw ApiError when response contains error field', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or expired.',
        },
      });

      await expect(exchangeCodeForToken('bad-code')).rejects.toThrow(ApiError);
      await expect(exchangeCodeForToken('bad-code')).rejects.toThrow(
        'GitHub authentication failed',
      );
    });

    it('should throw ApiError when access_token is missing', async () => {
      mockedAxios.post.mockResolvedValue({ data: {} });

      await expect(exchangeCodeForToken('code')).rejects.toThrow(ApiError);
    });

    it('should propagate network errors from axios', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network Error'));

      await expect(exchangeCodeForToken('code')).rejects.toThrow('Network Error');
    });
  });

  describe('refreshGithubToken', () => {
    it('should refresh GitHub token successfully', async () => {
      const mockData = {
        access_token: 'gho_new_token',
        refresh_token: 'ghr_new_refresh',
        expires_in: 7200,
        token_type: 'bearer',
      };
      mockedAxios.post.mockResolvedValue({ data: mockData });

      const result = await refreshGithubToken('old-refresh-token');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://github.com/login/oauth/access_token',
        {
          client_id: 'test-client-id',
          client_secret: 'test-secret',
          grant_type: 'refresh_token',
          refresh_token: 'old-refresh-token',
        },
        { headers: { Accept: 'application/json' }, timeout: 10000 },
      );
      expect(result).toEqual(mockData);
    });

    it('should throw ApiError when refresh response contains error', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          error: 'bad_refresh_token',
          error_description: 'The refresh token is invalid.',
        },
      });

      await expect(refreshGithubToken('bad-refresh')).rejects.toThrow(ApiError);
      await expect(refreshGithubToken('bad-refresh')).rejects.toThrow(
        'GitHub token refresh failed',
      );
    });

    it('should throw ApiError when access_token is missing in refresh response', async () => {
      mockedAxios.post.mockResolvedValue({ data: { token_type: 'bearer' } });

      await expect(refreshGithubToken('token')).rejects.toThrow(ApiError);
    });

    it('should propagate network errors on refresh', async () => {
      mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(refreshGithubToken('token')).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('parseGithubUrl', () => {
    it('should parse HTTPS URL', () => {
      const result = parseGithubUrl('https://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });

    it('should parse HTTPS URL with .git suffix', () => {
      const result = parseGithubUrl('https://github.com/owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });

    it('should parse SSH URL', () => {
      const result = parseGithubUrl('git@github.com:owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });

    it('should parse SSH URL without .git suffix', () => {
      const result = parseGithubUrl('git@github.com:owner/repo');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });

    it('should parse short form (owner/repo)', () => {
      const result = parseGithubUrl('owner/repo');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });

    it('should parse URL with query parameters', () => {
      const result = parseGithubUrl('https://github.com/owner/repo?tab=about');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });

    it('should parse URL with hash fragment', () => {
      const result = parseGithubUrl('https://github.com/owner/repo#readme');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });

    it('should parse URL with trailing slash and extra path segments', () => {
      const result = parseGithubUrl('https://github.com/owner/repo/tree/main/src');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });

    it('should handle whitespace around URL', () => {
      const result = parseGithubUrl('  https://github.com/owner/repo  ');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });

    it('should handle owners and repos with dots and hyphens', () => {
      const result = parseGithubUrl('my-org.io/my-repo.js');
      expect(result).toEqual({ owner: 'my-org.io', repoName: 'my-repo.js' });
    });

    it('should return null for invalid URL with only owner', () => {
      const result = parseGithubUrl('https://github.com/owner');
      expect(result).toBeNull();
    });

    it('should return null for completely invalid input', () => {
      const result = parseGithubUrl('not-a-url-at-all');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseGithubUrl('');
      expect(result).toBeNull();
    });

    it('should return null for non-github URL', () => {
      const result = parseGithubUrl('https://gitlab.com/owner/repo');
      expect(result).toBeNull();
    });

    it('should parse URL with http (no TLS)', () => {
      const result = parseGithubUrl('http://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repoName: 'repo' });
    });
  });

  describe('getInstallationOctokit', () => {
    it('should return an octokit instance for a valid installation', async () => {
      const mockOctokit = { request: jest.fn() };
      (githubApp.getInstallationOctokit as jest.Mock).mockResolvedValue(mockOctokit);

      const result = await getInstallationOctokit(12345);

      expect(githubApp.getInstallationOctokit).toHaveBeenCalledWith(12345);
      expect(result).toBe(mockOctokit);
    });

    it('should accept bigint installation IDs', async () => {
      const mockOctokit = { request: jest.fn() };
      (githubApp.getInstallationOctokit as jest.Mock).mockResolvedValue(mockOctokit);

      const result = await getInstallationOctokit(BigInt(99999));

      expect(githubApp.getInstallationOctokit).toHaveBeenCalledWith(99999);
      expect(result).toBe(mockOctokit);
    });

    it('should throw ApiError when authentication fails', async () => {
      (githubApp.getInstallationOctokit as jest.Mock).mockRejectedValue(
        new Error('Bad credentials'),
      );

      await expect(getInstallationOctokit(999)).rejects.toThrow(ApiError);
      await expect(getInstallationOctokit(999)).rejects.toThrow(
        'Failed to authenticate as GitHub App installation 999',
      );
    });
  });


  describe('getInstallationToken', () => {
    it('should generate an installation token', async () => {
      (githubApp.octokit.auth as jest.Mock).mockResolvedValue({
        token: 'ghs_installation_token',
      });

      const result = await getInstallationToken(12345);

      expect(githubApp.octokit.auth).toHaveBeenCalledWith({
        type: 'installation',
        installationId: 12345,
      });
      expect(result).toBe('ghs_installation_token');
    });

    it('should accept bigint installation IDs', async () => {
      (githubApp.octokit.auth as jest.Mock).mockResolvedValue({
        token: 'ghs_token_bigint',
      });

      const result = await getInstallationToken(BigInt(54321));

      expect(githubApp.octokit.auth).toHaveBeenCalledWith({
        type: 'installation',
        installationId: 54321,
      });
      expect(result).toBe('ghs_token_bigint');
    });

    it('should throw ApiError when token generation fails', async () => {
      (githubApp.octokit.auth as jest.Mock).mockRejectedValue(
        new Error('Auth error'),
      );

      await expect(getInstallationToken(999)).rejects.toThrow(ApiError);
      await expect(getInstallationToken(999)).rejects.toThrow(
        'Failed to generate GitHub installation token for installation 999',
      );
    });
  });

  describe('getUserOctokit', () => {
    it('should create an Octokit instance with the provided access token', async () => {
      const { Octokit } = require('octokit');
      const mockInstance = { request: jest.fn() };
      Octokit.mockImplementation(() => mockInstance);

      const result = await getUserOctokit('gho_user_token');

      expect(Octokit).toHaveBeenCalledWith({ auth: 'gho_user_token' });
      expect(result).toBe(mockInstance);
    });
  });

  describe('searchGithubRepos', () => {
    it('should fetch exact repo when search is a valid GitHub URL', async () => {
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({
          data: { id: 1, full_name: 'owner/repo' },
        }),
      };

      const result = await searchGithubRepos(
        mockOctokit,
        'https://github.com/owner/repo',
        1,
        10,
      );

      expect(mockOctokit.request).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}',
        expect.objectContaining({ owner: 'owner', repo: 'repo' }),
      );
      expect(result).toEqual({
        githubRepos: [{ id: 1, full_name: 'owner/repo' }],
        totalCount: 1,
      });
    });

    it('should return empty results when exact repo lookup fails', async () => {
      const mockOctokit = {
        request: jest.fn().mockRejectedValue(new Error('Not Found')),
      };

      const result = await searchGithubRepos(
        mockOctokit,
        'https://github.com/owner/nonexistent',
        1,
        10,
      );

      expect(result).toEqual({ githubRepos: [], totalCount: 0 });
    });

    it('should search user repos by keyword with filtering and pagination', async () => {
      const allRepos = [
        { full_name: 'user/alpha-project' },
        { full_name: 'user/beta-project' },
        { full_name: 'user/alpha-utils' },
        { full_name: 'user/gamma-service' },
      ];
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({ data: allRepos }),
      };

      const result = await searchGithubRepos(mockOctokit, 'alpha', 1, 10);

      expect(mockOctokit.request).toHaveBeenCalledWith(
        'GET /user/repos',
        expect.objectContaining({ per_page: 100, sort: 'updated' }),
      );
      expect(result.totalCount).toBe(2);
      expect(result.githubRepos).toEqual([
        { full_name: 'user/alpha-project' },
        { full_name: 'user/alpha-utils' },
      ]);
    });

    it('should handle pagination correctly for keyword search', async () => {
      const repos = Array.from({ length: 5 }, (_, i) => ({
        full_name: `user/match-${i}`,
      }));
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({ data: repos }),
      };

      const result = await searchGithubRepos(mockOctokit, 'match', 2, 2);

      expect(result.totalCount).toBe(5);
      expect(result.githubRepos).toEqual([
        { full_name: 'user/match-2' },
        { full_name: 'user/match-3' },
      ]);
    });

    it('should return empty when no repos match the keyword', async () => {
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({
          data: [{ full_name: 'user/other' }],
        }),
      };

      const result = await searchGithubRepos(mockOctokit, 'zzz', 1, 10);

      expect(result).toEqual({ githubRepos: [], totalCount: 0 });
    });

    it('should perform case-insensitive keyword search', async () => {
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({
          data: [{ full_name: 'user/MyProject' }],
        }),
      };

      const result = await searchGithubRepos(mockOctokit, 'myproject', 1, 10);

      expect(result.totalCount).toBe(1);
      expect(result.githubRepos).toEqual([{ full_name: 'user/MyProject' }]);
    });
  });

  // ─── ensureBranch ──────────────────────────────────────────────────
  describe('ensureBranch', () => {
    it('should create branch on the first attempt', async () => {
      const mockOctokit = { request: jest.fn().mockResolvedValue({}) };

      const result = await ensureBranch(
        mockOctokit as any,
        'owner',
        'repo',
        'feature/new',
        'abc123',
      );

      expect(result).toBe('feature/new');
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/git/refs',
        expect.objectContaining({
          owner: 'owner',
          repo: 'repo',
          ref: 'refs/heads/feature/new',
          sha: 'abc123',
        }),
      );
    });

    it('should append version suffix when branch already exists', async () => {
      const mockOctokit = {
        request: jest
          .fn()
          .mockRejectedValueOnce({ status: 422 }) // first attempt fails
          .mockResolvedValueOnce({}), // -v2 succeeds
      };

      const result = await ensureBranch(
        mockOctokit as any,
        'owner',
        'repo',
        'feature/new',
        'abc123',
      );

      expect(result).toBe('feature/new-v2');
      expect(mockOctokit.request).toHaveBeenCalledTimes(2);
    });

    it('should keep incrementing version until a free name is found', async () => {
      const mockOctokit = {
        request: jest
          .fn()
          .mockRejectedValueOnce({ status: 422 }) // feature/new
          .mockRejectedValueOnce({ status: 422 }) // feature/new-v2
          .mockRejectedValueOnce({ status: 422 }) // feature/new-v3
          .mockResolvedValueOnce({}), // feature/new-v4 succeeds
      };

      const result = await ensureBranch(
        mockOctokit as any,
        'owner',
        'repo',
        'feature/new',
        'abc123',
      );

      expect(result).toBe('feature/new-v4');
      expect(mockOctokit.request).toHaveBeenCalledTimes(4);
    });

    it('should throw ApiError after 10 failed attempts', async () => {
      const mockOctokit = {
        request: jest.fn().mockRejectedValue({ status: 422 }),
      };

      await expect(
        ensureBranch(mockOctokit as any, 'owner', 'repo', 'feature/new', 'abc123'),
      ).rejects.toThrow(ApiError);
      await expect(
        ensureBranch(mockOctokit as any, 'owner', 'repo', 'feature/new', 'abc123'),
      ).rejects.toThrow('Failed to create unique branch name after 10 attempts');
    });

    it('should rethrow non-422 errors on the first attempt', async () => {
      const mockOctokit = {
        request: jest.fn().mockRejectedValue({ status: 500, message: 'Server error' }),
      };

      await expect(
        ensureBranch(mockOctokit as any, 'owner', 'repo', 'feature/new', 'abc123'),
      ).rejects.toEqual({ status: 500, message: 'Server error' });
    });

    it('should rethrow non-422 errors during versioned attempts', async () => {
      const mockOctokit = {
        request: jest
          .fn()
          .mockRejectedValueOnce({ status: 422 }) // first: branch exists
          .mockRejectedValueOnce({ status: 403, message: 'Forbidden' }), // v2: permissions error
      };

      await expect(
        ensureBranch(mockOctokit as any, 'owner', 'repo', 'feature/new', 'abc123'),
      ).rejects.toEqual({ status: 403, message: 'Forbidden' });
    });
  });

  // ─── findOpenPrUrl ─────────────────────────────────────────────────
  describe('findOpenPrUrl', () => {
    it('should return the PR URL when an open PR exists', async () => {
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({
          data: [{ html_url: 'https://github.com/owner/repo/pull/42' }],
        }),
      };

      const result = await findOpenPrUrl(
        mockOctokit as any,
        'owner',
        'repo',
        'feature/branch',
        'main',
      );

      expect(result).toBe('https://github.com/owner/repo/pull/42');
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/pulls',
        expect.objectContaining({
          state: 'open',
          head: 'owner:feature/branch',
          base: 'main',
        }),
      );
    });

    it('should return null when no open PR exists', async () => {
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({ data: [] }),
      };

      const result = await findOpenPrUrl(
        mockOctokit as any,
        'owner',
        'repo',
        'feature/branch',
        'main',
      );

      expect(result).toBeNull();
    });

    it('should return the first PR URL when multiple PRs match', async () => {
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({
          data: [
            { html_url: 'https://github.com/owner/repo/pull/42' },
            { html_url: 'https://github.com/owner/repo/pull/43' },
          ],
        }),
      };

      const result = await findOpenPrUrl(
        mockOctokit as any,
        'owner',
        'repo',
        'feature/branch',
        'main',
      );

      expect(result).toBe('https://github.com/owner/repo/pull/42');
    });
  });

  // ─── createPullRequest ─────────────────────────────────────────────
  describe('createPullRequest', () => {
    it('should create a pull request and return the HTML URL', async () => {
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({
          data: { html_url: 'https://github.com/owner/repo/pull/99' },
        }),
      };

      const result = await createPullRequest(
        mockOctokit as any,
        'owner',
        'repo',
        'Add feature',
        'This PR adds a great feature.',
        'feature/branch',
        'main',
      );

      expect(result).toBe('https://github.com/owner/repo/pull/99');
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/pulls',
        expect.objectContaining({
          owner: 'owner',
          repo: 'repo',
          title: 'Add feature',
          body: 'This PR adds a great feature.',
          head: 'feature/branch',
          base: 'main',
        }),
      );
    });

    it('should propagate errors from GitHub API', async () => {
      const mockOctokit = {
        request: jest.fn().mockRejectedValue(new Error('Validation Failed')),
      };

      await expect(
        createPullRequest(
          mockOctokit as any,
          'owner',
          'repo',
          'Title',
          'Body',
          'head',
          'base',
        ),
      ).rejects.toThrow('Validation Failed');
    });
  });

  // ─── isBranchCreatedByCodePilot ────────────────────────────────────
  describe('isBranchCreatedByCodePilot', () => {
    it('should return true if branch commit author is the bot login', async () => {
      const mockOctokit = {
        request: jest
          .fn()
          .mockResolvedValueOnce({
            data: { object: { sha: 'commit-sha-123' } },
          })
          .mockResolvedValueOnce({
            data: { author: { login: 'test-bot[bot]' } },
          }),
      };

      const result = await isBranchCreatedByCodePilot(
        mockOctokit as any,
        'owner',
        'repo',
        'codepilot/feature',
      );

      expect(result).toBe(true);
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/git/ref/heads/{branch}',
        expect.objectContaining({
          owner: 'owner',
          repo: 'repo',
          branch: 'codepilot/feature',
        }),
      );
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/commits/{sha}',
        expect.objectContaining({ sha: 'commit-sha-123' }),
      );
    });

    it('should return false if branch commit author differs from bot login', async () => {
      const mockOctokit = {
        request: jest
          .fn()
          .mockResolvedValueOnce({
            data: { object: { sha: 'commit-sha-456' } },
          })
          .mockResolvedValueOnce({
            data: { author: { login: 'human-user' } },
          }),
      };

      const result = await isBranchCreatedByCodePilot(
        mockOctokit as any,
        'owner',
        'repo',
        'feature/manual',
      );

      expect(result).toBe(false);
    });

    it('should return false if commit has no author', async () => {
      const mockOctokit = {
        request: jest
          .fn()
          .mockResolvedValueOnce({
            data: { object: { sha: 'commit-sha-789' } },
          })
          .mockResolvedValueOnce({
            data: { author: null },
          }),
      };

      const result = await isBranchCreatedByCodePilot(
        mockOctokit as any,
        'owner',
        'repo',
        'orphan-branch',
      );

      expect(result).toBe(false);
    });

    it('should return false on 404 error (branch not found)', async () => {
      const mockOctokit = {
        request: jest.fn().mockRejectedValue({ status: 404 }),
      };

      const result = await isBranchCreatedByCodePilot(
        mockOctokit as any,
        'owner',
        'repo',
        'deleted-branch',
      );

      expect(result).toBe(false);
    });

    it('should return false on any other error', async () => {
      const mockOctokit = {
        request: jest.fn().mockRejectedValue({ status: 500 }),
      };

      const result = await isBranchCreatedByCodePilot(
        mockOctokit as any,
        'owner',
        'repo',
        'error-branch',
      );

      expect(result).toBe(false);
    });
  });

  // ─── createCommit ──────────────────────────────────────────────────
  describe('createCommit', () => {
    const setupMockOctokit = () => {
      const request = jest
        .fn()
        // 1. GET base commit
        .mockResolvedValueOnce({
          data: { commit: { tree: { sha: 'base-tree-sha' } } },
        })
        // 2. POST blob for file1
        .mockResolvedValueOnce({ data: { sha: 'blob-sha-1' } })
        // 3. POST blob for file2
        .mockResolvedValueOnce({ data: { sha: 'blob-sha-2' } })
        // 4. POST tree
        .mockResolvedValueOnce({ data: { sha: 'new-tree-sha' } })
        // 5. POST commit
        .mockResolvedValueOnce({ data: { sha: 'new-commit-sha' } })
        // 6. PATCH ref
        .mockResolvedValueOnce({});
      return { request };
    };

    it('should create a commit with multiple files', async () => {
      const mockOctokit = setupMockOctokit();

      await createCommit(
        mockOctokit as any,
        'owner',
        'repo',
        'feature/branch',
        'base-sha',
        { 'src/index.ts': 'console.log("hello")', 'README.md': '# Hello' },
        'feat: initial commit',
      );

      // Verify GET base commit
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/commits/{ref}',
        expect.objectContaining({ ref: 'base-sha' }),
      );

      // Verify POST blobs (2 files)
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/git/blobs',
        expect.objectContaining({
          content: Buffer.from('console.log("hello")').toString('base64'),
          encoding: 'base64',
        }),
      );
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/git/blobs',
        expect.objectContaining({
          content: Buffer.from('# Hello').toString('base64'),
          encoding: 'base64',
        }),
      );

      // Verify POST tree
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/git/trees',
        expect.objectContaining({
          base_tree: 'base-tree-sha',
          tree: expect.arrayContaining([
            expect.objectContaining({
              path: 'src/index.ts',
              mode: '100644',
              type: 'blob',
              sha: 'blob-sha-1',
            }),
            expect.objectContaining({
              path: 'README.md',
              mode: '100644',
              type: 'blob',
              sha: 'blob-sha-2',
            }),
          ]),
        }),
      );

      // Verify POST commit
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/git/commits',
        expect.objectContaining({
          message: 'feat: initial commit',
          tree: 'new-tree-sha',
          parents: ['base-sha'],
        }),
      );

      // Verify PATCH ref
      expect(mockOctokit.request).toHaveBeenCalledWith(
        'PATCH /repos/{owner}/{repo}/git/refs/{ref}',
        expect.objectContaining({
          ref: 'heads/feature/branch',
          sha: 'new-commit-sha',
        }),
      );
    });

    it('should create a commit with a single file', async () => {
      const request = jest
        .fn()
        .mockResolvedValueOnce({
          data: { commit: { tree: { sha: 'base-tree-sha' } } },
        })
        .mockResolvedValueOnce({ data: { sha: 'blob-sha-1' } })
        .mockResolvedValueOnce({ data: { sha: 'new-tree-sha' } })
        .mockResolvedValueOnce({ data: { sha: 'new-commit-sha' } })
        .mockResolvedValueOnce({});
      const mockOctokit = { request };

      await createCommit(
        mockOctokit as any,
        'owner',
        'repo',
        'main',
        'parent-sha',
        { 'file.txt': 'content' },
        'chore: add file',
      );

      expect(request).toHaveBeenCalledTimes(5);
    });

    it('should propagate errors from any step', async () => {
      const mockOctokit = {
        request: jest
          .fn()
          .mockRejectedValueOnce(new Error('Failed to fetch commit')),
      };

      await expect(
        createCommit(
          mockOctokit as any,
          'owner',
          'repo',
          'branch',
          'sha',
          { 'a.txt': 'x' },
          'msg',
        ),
      ).rejects.toThrow('Failed to fetch commit');
    });

    it('should handle empty fileContents', async () => {
      const request = jest
        .fn()
        .mockResolvedValueOnce({
          data: { commit: { tree: { sha: 'base-tree-sha' } } },
        })
        // No blob calls for empty fileContents
        .mockResolvedValueOnce({ data: { sha: 'new-tree-sha' } })
        .mockResolvedValueOnce({ data: { sha: 'new-commit-sha' } })
        .mockResolvedValueOnce({});
      const mockOctokit = { request };

      await createCommit(
        mockOctokit as any,
        'owner',
        'repo',
        'branch',
        'sha',
        {},
        'empty commit',
      );

      // GET commit + POST tree + POST commit + PATCH ref = 4 calls (no blobs)
      expect(request).toHaveBeenCalledTimes(4);

      // POST tree should have empty tree array
      expect(request).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/git/trees',
        expect.objectContaining({ tree: [] }),
      );
    });
  });
});
