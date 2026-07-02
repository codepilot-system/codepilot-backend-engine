import {
  getUserById,
  getGithubUser,
  upsertUser,
  getValidGithubToken,
  syncProfile,
  deleteUser,
} from '../../../../services/users/users.service';
import prisma from '../../../../lib/prisma';
import { encrypt, decrypt } from '../../../../lib/encryption';
import { ApiError } from '../../../../lib/ApiError';
import { getUserOctokit, refreshGithubToken } from '../../../../services/github/github.service';
import { RequestError } from '@octokit/request-error';
import { Role } from '@prisma/client';

jest.mock('../../../../lib/prisma');
jest.mock('../../../../lib/encryption');
jest.mock('../../../../services/github/github.service', () => ({
  getUserOctokit: jest.fn(),
  refreshGithubToken: jest.fn(),
}));
jest.mock('@octokit/request-error', () => {
  return {
    RequestError: class RequestError extends Error {
      status: number;
      request: any;
      response: any;
      constructor(message: string, statusCode: number, options: any) {
        super(message);
        this.status = statusCode;
        this.request = options.request;
        this.response = options.response;
      }
    }
  };
});

describe('Users Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  describe('getUserById', () => {
    it('should retrieve user by ID with selected fields', async () => {
      const mockUser = {
        id: 1,
        githubId: BigInt(123),
        username: 'testuser',
        email: 'test@example.com',
        avatarUrl: 'https://example.com/avatar.png',
        createdAt: new Date(),
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await getUserById(1);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: {
          id: true,
          githubId: true,
          username: true,
          email: true,
          avatarUrl: true,
          createdAt: true,
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null for non-existent user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await getUserById(999);

      expect(result).toBeNull();
    });
  });

  describe('getGithubUser', () => {
    it('should fetch GitHub user data', async () => {
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({
          data: {
            id: 123,
            login: 'testuser',
            name: 'Test User',
            email: 'test@example.com',
            avatar_url: 'https://example.com/avatar.png',
          },
        }),
      };

      (getUserOctokit as jest.Mock).mockResolvedValue(mockOctokit);

      const result = await getGithubUser('access-token');

      expect(getUserOctokit).toHaveBeenCalledWith('access-token');
      expect(mockOctokit.request).toHaveBeenCalledWith('GET /user', {
        request: { signal: expect.any(AbortSignal) },
      });
      expect(result).toEqual({
        id: 123,
        login: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        avatar_url: 'https://example.com/avatar.png',
      });
    });

    it('should fetch emails if user has no email', async () => {
      const mockOctokit = {
        request: jest.fn()
          .mockResolvedValueOnce({
            data: {
              id: 123,
              login: 'testuser',
              name: 'Test User',
              email: null,
              avatar_url: 'https://example.com/avatar.png',
            },
          })
          .mockResolvedValueOnce({
            data: [
              { email: 'primary@example.com', primary: true, verified: true },
              { email: 'secondary@example.com', primary: false, verified: true },
            ],
          }),
      };

      (getUserOctokit as jest.Mock).mockResolvedValue(mockOctokit);

      const result = await getGithubUser('access-token');

      expect(mockOctokit.request).toHaveBeenCalledTimes(2);
      expect(result.email).toBe('primary@example.com');
    });

    it('should throw ApiError on 401 response', async () => {
      const mockOctokit = {
        request: jest.fn().mockRejectedValue(
          new RequestError('Unauthorized', 401, {
            request: { method: 'GET', url: '/user', headers: {} },
            response: { url: '/user', status: 401, headers: {}, data: {} },
          }),
        ),
      };

      (getUserOctokit as jest.Mock).mockResolvedValue(mockOctokit);

      await expect(getGithubUser('invalid-token')).rejects.toThrow(ApiError);
      await expect(getGithubUser('invalid-token')).rejects.toThrow('GitHub token expired or invalid');
    });

    it('should throw original error on non-401 failures', async () => {
      const mockOctokit = {
        request: jest.fn().mockRejectedValue(new Error('Network error')),
      };

      (getUserOctokit as jest.Mock).mockResolvedValue(mockOctokit);

      await expect(getGithubUser('token')).rejects.toThrow('Network error');
    });
  });

  describe('upsertUser', () => {
    const mockGithubUser = {
      id: 123,
      login: 'testuser',
      name: 'Test User',
      email: 'test@example.com',
      avatar_url: 'https://example.com/avatar.png',
    };

    const mockTokenData = {
      access_token: 'gho_token',
      refresh_token: 'ghr_refresh',
      expires_in: 7200,
    };

    it('should create new user if not exists', async () => {
      (encrypt as jest.Mock).mockReturnValue('encrypted-token');
      (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 1 });

      await upsertUser(mockGithubUser, mockTokenData);

      expect(encrypt).toHaveBeenCalledWith('gho_token');
      expect(encrypt).toHaveBeenCalledWith('ghr_refresh');
      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { githubId: BigInt(123) },
        update: expect.objectContaining({
          username: 'testuser',
          email: 'test@example.com',
        }),
        create: expect.objectContaining({
          githubId: BigInt(123),
          username: 'testuser',
        }),
      });
    });

    it('should update existing user', async () => {
      (encrypt as jest.Mock).mockReturnValue('encrypted-token');
      (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 1 });

      await upsertUser(mockGithubUser, mockTokenData);

      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            username: 'testuser',
            avatarUrl: 'https://example.com/avatar.png',
          }),
        }),
      );
    });

    it('should handle missing refresh token', async () => {
      const tokenDataWithoutRefresh = {
        access_token: 'gho_token',
        refresh_token: undefined,
        expires_in: 7200,
      };

      (encrypt as jest.Mock).mockReturnValue('encrypted-token');
      (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 1 });

      await upsertUser(mockGithubUser, tokenDataWithoutRefresh);

      expect(encrypt).toHaveBeenCalledTimes(1);
    });
  });

  describe('getValidGithubToken', () => {
    it('should return decrypted token if not expired', async () => {
      const mockUser = {
        githubId: BigInt(123),
        githubAccessToken: 'encrypted-token',
        githubRefreshToken: 'encrypted-refresh',
        githubTokenExpiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (decrypt as jest.Mock).mockReturnValue('decrypted-token');

      const result = await getValidGithubToken(1);

      expect(decrypt).toHaveBeenCalledWith('encrypted-token');
      expect(result).toBe('decrypted-token');
    });

    it('should refresh token if expired', async () => {
      const mockUser = {
        githubId: BigInt(123),
        githubAccessToken: 'encrypted-token',
        githubRefreshToken: 'encrypted-refresh',
        githubTokenExpiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (decrypt as jest.Mock).mockReturnValue('decrypted-refresh-token');
      (refreshGithubToken as jest.Mock).mockResolvedValue({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 7200,
      });
      (encrypt as jest.Mock).mockReturnValue('new-encrypted-token');
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      const result = await getValidGithubToken(1);

      expect(refreshGithubToken).toHaveBeenCalledWith('decrypted-refresh-token');
      expect(prisma.user.update).toHaveBeenCalled();
      expect(result).toBe('new-access-token');
    });

    it('should throw error if user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getValidGithubToken(1)).rejects.toThrow(ApiError);
      await expect(getValidGithubToken(1)).rejects.toThrow('GitHub connection not found');
    });

    it('should throw error if no access token', async () => {
      const mockUser = {
        githubId: BigInt(123),
        githubAccessToken: null,
        githubRefreshToken: 'encrypted-refresh',
        githubTokenExpiresAt: null,
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(getValidGithubToken(1)).rejects.toThrow(ApiError);
    });

    it('should throw error if refresh fails', async () => {
      const mockUser = {
        githubId: BigInt(123),
        githubAccessToken: 'encrypted-token',
        githubRefreshToken: 'encrypted-refresh',
        githubTokenExpiresAt: new Date(Date.now() - 3600000),
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (decrypt as jest.Mock).mockReturnValue('decrypted-refresh-token');
      (refreshGithubToken as jest.Mock).mockRejectedValue(new Error('Refresh failed'));

      await expect(getValidGithubToken(1)).rejects.toThrow(ApiError);
    });
  });

  describe('syncProfile', () => {
    it('should sync user profile with GitHub', async () => {
      // Setup for getValidGithubToken
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        githubId: BigInt(123),
        githubAccessToken: 'encrypted-token',
        githubTokenExpiresAt: new Date(Date.now() + 3600000), // valid token
      });
      (decrypt as jest.Mock).mockReturnValue('valid-token');

      // Setup for getGithubUser
      const mockOctokit = {
        request: jest.fn().mockResolvedValue({
          data: {
            id: 123,
            login: 'newusername',
            name: 'New Username',
            email: 'newemail@example.com',
            avatar_url: 'https://example.com/new-avatar.png',
          },
        }),
      };
      (getUserOctokit as jest.Mock).mockResolvedValue(mockOctokit);

      const mockUpdatedUser = {
        id: 1,
        githubId: BigInt(123),
        username: 'newusername',
        email: 'newemail@example.com',
        avatarUrl: 'https://example.com/new-avatar.png',
        createdAt: new Date(),
      };
      
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUpdatedUser);

      const result = await syncProfile(1);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: expect.any(Object),
      });
      expect(getUserOctokit).toHaveBeenCalledWith('valid-token');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          username: 'newusername',
          avatarUrl: 'https://example.com/new-avatar.png',
          email: 'newemail@example.com',
        },
        select: expect.any(Object),
      });
      expect(result).toEqual(mockUpdatedUser);
    });
  });

  describe('deleteUser', () => {
    it('should delete user and their solo projects', async () => {
      const mockProjects = [
        {
          id: 1,
          _count: { members: 1 },
          members: [{ userId: 1, role: Role.ADMIN }],
        },
      ];

      (prisma.project.findMany as jest.Mock).mockResolvedValue(mockProjects);
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          project: { deleteMany: jest.fn().mockResolvedValue({}) },
          user: { delete: jest.fn().mockResolvedValue({ id: 1 }) },
        };
        return await callback(tx);
      });

      const result = await deleteUser(1);

      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { members: { some: { userId: 1, role: Role.ADMIN } } },
        select: expect.any(Object),
      });
      expect(result).toBeDefined();
    });

    it('should throw error if user is last admin of shared project', async () => {
      const mockProjects = [
        {
          id: 1,
          _count: { members: 2 },
          members: [{ userId: 1, role: Role.ADMIN }],
        },
      ];

      (prisma.project.findMany as jest.Mock).mockResolvedValue(mockProjects);

      await expect(deleteUser(1)).rejects.toThrow(ApiError);
      await expect(deleteUser(1)).rejects.toThrow('Cannot delete account');
    });

    it('should handle user with no projects', async () => {
      (prisma.project.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.$transaction as jest.Mock).mockResolvedValue({ id: 1 });

      const result = await deleteUser(1);

      expect(result).toBeDefined();
    });
  });
});
