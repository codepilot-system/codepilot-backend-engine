import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../../lib/prisma';
import { ENV } from '../../config/env.config';

export const getGithubAuthUrl = (state: string) => {
  const rootUrl = 'https://github.com/login/oauth/authorize';
  const params = new URLSearchParams({
    client_id: ENV.GITHUB_CLIENT_ID,
    redirect_uri: ENV.GITHUB_REDIRECT_URI,
    state,
  });

  return `${rootUrl}?${params.toString()}`;
};

export const generateTokens = async (userId: number) => {
  const accessToken = jwt.sign(
    { userId },
    ENV.JWT_ACCESS_SECRET as jwt.Secret,
    { expiresIn: ENV.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
  );
  const refreshToken = jwt.sign(
    { userId },
    ENV.JWT_REFRESH_SECRET as jwt.Secret,
    { expiresIn: ENV.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
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
