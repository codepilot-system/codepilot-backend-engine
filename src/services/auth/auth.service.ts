import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../../lib/prisma';
import { ENV } from '../../config/env.config';

interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export const getGithubAuthUrl = (state: string) => {
  const rootUrl = 'https://github.com/login/oauth/authorize';
  const params = new URLSearchParams({
    client_id: ENV.GITHUB_CLIENT_ID as string,
    redirect_uri: ENV.GITHUB_REDIRECT_URI as string,
    scope: 'user:email repo',
    state,
  });

  return `${rootUrl}?${params.toString()}`;
};

export const exchangeCodeForToken = async (code: string): Promise<string> => {
  const response = await axios.post<GitHubTokenResponse>('https://github.com/login/oauth/access_token', {
    client_id: ENV.GITHUB_CLIENT_ID,
    client_secret: ENV.GITHUB_CLIENT_SECRET,
    code,
  }, {
    headers: { Accept: 'application/json' },
    timeout: 10000,
  });

  if (response.data.error || !response.data.access_token)
    throw new Error(`GitHub OAuth error: ${response.data.error_description || response.data.error || 'Failed to get access token'}`);

  return response.data.access_token;
};

export const generateTokens = async (userId: number) => {
  const accessToken = jwt.sign(
    { userId },
    ENV.JWT_ACCESS_SECRET as jwt.Secret,
    { expiresIn: (ENV.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn']) || '15m' }
  );
  const refreshToken = jwt.sign(
    { userId },
    ENV.JWT_REFRESH_SECRET as jwt.Secret,
    { expiresIn: (ENV.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn']) || '30d' }
  );

  return { accessToken, refreshToken };
};

export const createSession = async (userId: number, refreshToken: string) => {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await prisma.session.create({ data: { userId, refreshTokenHash: hash } });
};

export const updateSession = async (oldToken: string, newToken: string) => {
  const oldHash = crypto.createHash('sha256').update(oldToken).digest('hex');
  const newHash = crypto.createHash('sha256').update(newToken).digest('hex');

  await prisma.session.update({
    where: { refreshTokenHash: oldHash },
    data: {
      refreshTokenHash: newHash,
      createdAt: new Date()
    }
  });
};

export const verifyRefreshToken = async (token: string) => {
  try {
    const decoded = jwt.verify(token, ENV.JWT_REFRESH_SECRET as jwt.Secret) as { userId: number };

    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash } });

    if (!session || session.userId !== decoded.userId) return null;

    return session.userId;
  } catch {
    return null;
  }
};

export const deleteRefreshToken = async (token: string) => {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await prisma.session.deleteMany({ where: { refreshTokenHash: hash } });
};
