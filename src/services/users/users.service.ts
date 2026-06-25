import prisma from '../../lib/prisma';
import { encrypt, decrypt } from '../../lib/encryption';
import { ApiError } from '../../lib/ApiError';
import { GitHubTokenResponse, GitHubUserResponse, getUserOctokit, refreshGithubToken } from '../github/github.service';
import { RequestError } from '@octokit/request-error';
import { Role } from '@prisma/client';

export const getUserById = async (id: number) => {
  return await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      githubId: true,
      username: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
    },
  });
};

export const getGithubUser = async (accessToken: string): Promise<GitHubUserResponse> => {
  try {
    const octokit = await getUserOctokit(accessToken);

    const { data: githubUser } = await octokit.request('GET /user', {
      request: { signal: AbortSignal.timeout(10000) },
    });

    if (!githubUser.email) {
      const { data: emails } = await octokit.request('GET /user/emails', {
        request: { signal: AbortSignal.timeout(10000) },
      });

      const primaryEmail = emails.find((e: any) => e.primary && e.verified) || emails[0];
      if (primaryEmail) githubUser.email = primaryEmail.email;
    }

    return githubUser as GitHubUserResponse;
  } catch (e) {
    if (e instanceof RequestError && e.status === 401)
      throw new ApiError('GitHub token expired or invalid. Please sign in again.', 401);

    throw e;
  }
};

export const upsertUser = async (githubUser: GitHubUserResponse, tokenData: GitHubTokenResponse) => {
  const encryptedToken = encrypt(tokenData.access_token);
  const encryptedRefreshToken = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null;
  const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;

  return await prisma.user.upsert({
    where: { githubId: BigInt(githubUser.id) },
    update: {
      username: githubUser.login,
      avatarUrl: githubUser.avatar_url,
      email: githubUser.email,
      githubAccessToken: encryptedToken,
      githubRefreshToken: encryptedRefreshToken || undefined,
      githubTokenExpiresAt: expiresAt || undefined,
    },
    create: {
      githubId: BigInt(githubUser.id),
      username: githubUser.login,
      avatarUrl: githubUser.avatar_url,
      email: githubUser.email,
      githubAccessToken: encryptedToken,
      githubRefreshToken: encryptedRefreshToken,
      githubTokenExpiresAt: expiresAt,
    },
  });
};

export const getValidGithubToken = async (userId: number): Promise<string> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubId: true, githubAccessToken: true, githubRefreshToken: true, githubTokenExpiresAt: true }
  });

  if (!user || !user.githubAccessToken)
    throw new ApiError('GitHub connection not found. Please sign in again.', 401);

  const now = new Date();
  const buffer = 5 * 60 * 1000;

  if (!user.githubTokenExpiresAt || user.githubTokenExpiresAt.getTime() > now.getTime() + buffer)
    return decrypt(user.githubAccessToken);

  if (!user.githubRefreshToken)
    throw new ApiError('GitHub token expired and no refresh token available. Please sign in again.', 401);

  try {
    const refreshToken = decrypt(user.githubRefreshToken);
    const newTokenData = await refreshGithubToken(refreshToken);

    if (!newTokenData.access_token)
      throw new ApiError('GitHub token refresh returned an empty token. Please sign in again.', 401);

    const encryptedToken = encrypt(newTokenData.access_token);
    const encryptedRefreshToken = newTokenData.refresh_token ? encrypt(newTokenData.refresh_token) : null;
    const expiresAt = newTokenData.expires_in ? new Date(Date.now() + newTokenData.expires_in * 1000) : null;

    await prisma.user.update({
      where: { id: userId },
      data: {
        githubAccessToken: encryptedToken,
        githubRefreshToken: encryptedRefreshToken || undefined,
        githubTokenExpiresAt: expiresAt || undefined,
      }
    });

    return newTokenData.access_token;
  } catch {
    throw new ApiError('Your GitHub session has expired. Please sign in again.', 401);
  }
};

export const syncProfile = async (id: number) => {
  const githubToken = await getValidGithubToken(id);
  const githubUser = await getGithubUser(githubToken);

  return await prisma.user.update({
    where: { id },
    data: {
      username: githubUser.login,
      avatarUrl: githubUser.avatar_url,
      email: githubUser.email,
    },
    select: {
      id: true,
      githubId: true,
      username: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
    },
  });
};

export const deleteUser = async (id: number) => {
  const userProjects = await prisma.project.findMany({
    where: { members: { some: { userId: id, role: Role.ADMIN } } },
    select: {
      id: true,
      _count: { select: { members: true } },
      members: { where: { role: Role.ADMIN }, select: { userId: true } }
    }
  });

  for (const project of userProjects) {
    if (project.members.length <= 1 && project._count.members > 1)
      throw new ApiError(
        'Cannot delete account: you are the last admin of a shared project. Please delete the project or have another admin join first.',
        400
      );
  }

  const soloProjectIds = userProjects
    .filter(p => p._count.members === 1)
    .map(p => p.id);

  return await prisma.$transaction(async (tx) => {
    if (soloProjectIds.length > 0) {
      await tx.project.deleteMany({
        where: { id: { in: soloProjectIds } }
      });
    }

    return await tx.user.delete({ where: { id } });
  });
};
