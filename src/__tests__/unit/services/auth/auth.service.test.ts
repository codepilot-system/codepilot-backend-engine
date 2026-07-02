import {
  getGithubAuthUrl,
  generateTokens,
  createSession,
  updateSession,
  verifyRefreshToken,
  deleteRefreshToken,
} from '../../../../services/auth/auth.service';
import prisma from '../../../../lib/prisma';
import jwt from 'jsonwebtoken';

jest.mock('../../../../lib/prisma');
jest.mock('jsonwebtoken');

jest.mock('../../../../config/env.config', () => ({
  ENV: {
    JWT_ACCESS_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_REDIRECT_URI: 'http://localhost:3000/callback',
  }
}));

describe('Auth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getGithubAuthUrl', () => {
    it('should generate GitHub OAuth URL with state', () => {
      const state = 'random-state-123';
      const url = getGithubAuthUrl(state);

      expect(url).toContain('https://github.com/login/oauth/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain(`state=${state}`);
    });
  });

  describe('generateTokens', () => {
    it('should generate both access and refresh tokens', async () => {
      const userId = 1;
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce('mock-access-token')
        .mockReturnValueOnce('mock-refresh-token');

      const tokens = await generateTokens(userId);

      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(tokens.accessToken).toBe('mock-access-token');
      expect(tokens.refreshToken).toBe('mock-refresh-token');
    });

    it('should use correct secrets and expiration times', async () => {
      const userId = 1;
      (jwt.sign as jest.Mock).mockReturnValue('mock-token');

      await generateTokens(userId);

      expect(jwt.sign).toHaveBeenCalledWith(
        { userId },
        'test-secret',
        { expiresIn: '15m' },
      );
      expect(jwt.sign).toHaveBeenCalledWith(
        { userId },
        'test-refresh-secret',
        { expiresIn: '7d' },
      );
    });
  });

  describe('createSession', () => {
    it('should create a new session with hashed refresh token', async () => {
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 1 });

      await createSession(1, 'refresh-token');

      expect(prisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 1,
          refreshTokenHash: expect.any(String),
        }),
      });
    });

    it('should hash the refresh token before storing', async () => {
      const crypto = require('crypto');
      const createHashSpy = jest.spyOn(crypto, 'createHash');

      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 1 });

      await createSession(1, 'refresh-token');

      expect(createHashSpy).toHaveBeenCalledWith('sha256');
      createHashSpy.mockRestore();
    });
  });

  describe('updateSession', () => {
    it('should update session with new hashed refresh token', async () => {
      (prisma.session.update as jest.Mock).mockResolvedValue({ id: 1 });

      await updateSession('old-token', 'new-token');

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { refreshTokenHash: expect.any(String) },
        data: expect.objectContaining({
          refreshTokenHash: expect.any(String),
          createdAt: expect.any(Date),
        }),
      });
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify a valid refresh token and return userId', async () => {
      const mockSession = {
        id: 1,
        userId: 1,
        refreshTokenHash: 'hashed-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 1 });
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(mockSession);

      const result = await verifyRefreshToken('refresh-token');

      expect(result).toBe(1);
      expect(jwt.verify).toHaveBeenCalledWith('refresh-token', 'test-refresh-secret');
    });

    it('should return null for invalid JWT', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const result = await verifyRefreshToken('invalid-token');

      expect(result).toBeNull();
    });

    it('should return null if session not found', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 1 });
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await verifyRefreshToken('refresh-token');

      expect(result).toBeNull();
    });

    it('should return null if userId mismatch', async () => {
      const mockSession = {
        id: 1,
        userId: 2,
        refreshTokenHash: 'hashed-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 1 });
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(mockSession);

      const result = await verifyRefreshToken('refresh-token');

      expect(result).toBeNull();
    });
  });

  describe('deleteRefreshToken', () => {
    it('should delete session by refresh token hash', async () => {
      (prisma.session.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      await deleteRefreshToken('refresh-token');

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { refreshTokenHash: expect.any(String) },
      });
    });

    it('should handle deletion of non-existent token', async () => {
      (prisma.session.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await deleteRefreshToken('non-existent-token');

      expect(prisma.session.deleteMany).toHaveBeenCalled();
    });
  });
});
