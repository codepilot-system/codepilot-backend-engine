import axios, { isAxiosError } from 'axios';
import prisma from '../../lib/prisma';
import { encrypt, decrypt } from '../../lib/encryption';
import { ApiError } from '../../lib/ApiError';

export interface GitHubUserResponse {
  id: number;
  login: string;
  email: string | null;
  avatar_url: string;
}

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
    const userResponse = await axios.get<GitHubUserResponse>('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });

    const githubUser = userResponse.data;

    if (!githubUser.email) {
      const emailResponse = await axios.get<any[]>('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });

      const primaryEmail = emailResponse.data.find((e: any) => e.primary && e.verified) || emailResponse.data[0];
      if (primaryEmail) githubUser.email = primaryEmail.email;
    }

    return githubUser;
  } catch (e) {
    if (isAxiosError(e) && e.response?.status === 401)
      throw new ApiError('GitHub token expired or invalid. Please sign in again.', 401);

    throw e;
  }
};

export const upsertUser = async (githubUser: GitHubUserResponse, accessToken: string) => {
  const encryptedToken = encrypt(accessToken);

  return await prisma.user.upsert({
    where: { githubId: githubUser.id.toString() },
    update: {
      username: githubUser.login,
      avatarUrl: githubUser.avatar_url,
      email: githubUser.email,
      githubAccessToken: encryptedToken,
    },
    create: {
      githubId: githubUser.id.toString(),
      username: githubUser.login,
      avatarUrl: githubUser.avatar_url,
      email: githubUser.email,
      githubAccessToken: encryptedToken,
    },
  });
};

export const syncProfile = async (id: number) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError('User not found', 404);
  if (!user.githubAccessToken) {
    throw new ApiError('No GitHub token on file. Please sign in again.', 401);
  }

  const githubToken = decrypt(user.githubAccessToken);
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
  return await prisma.$transaction(async (transaction) => {
    const individualProjects = await transaction.project.findMany({
      where: { members: { every: { userId: id } } },
      select: { id: true },
    });

    if (individualProjects.length > 0) {
      await transaction.project.deleteMany({
        where: { id: { in: individualProjects.map((p) => p.id) } },
      });
    }

    return await transaction.user.delete({ where: { id } });
  });
};
