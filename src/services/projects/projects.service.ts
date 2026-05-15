import prisma from '../../lib/prisma';
import { ApiError } from '../../lib/ApiError';
import { githubApp, getUserOctokit, getInstallationOctokit, searchGithubRepos } from '../github/github.service';
import { getValidGithubToken } from '../users/users.service';
import { Role, Provider } from '@prisma/client';

export const getProjects = async (userId: number, page: number = 1, limit: number = 30) => {
  const skip = (page - 1) * limit;

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where: {
        members: { some: { userId } }
      },
      skip,
      take: limit,
      include: {
        _count: { select: { members: true, scans: true } }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.project.count({
      where: {
        members: { some: { userId } }
      }
    })
  ]);

  return {
    data: projects,
    pagination: { page, limit, total }
  };
};

export const connectProject = async (userId: number, owner: string, repoName: string) => {
  const repoUrl = `https://github.com/${owner}/${repoName}`;
  const userToken = await getValidGithubToken(userId);
  const userOctokit = await getUserOctokit(userToken);

  const [repoResult, installationResult] = await Promise.allSettled([
    userOctokit.request('GET /repos/{owner}/{repo}', {
      owner,
      repo: repoName,
      request: { signal: AbortSignal.timeout(15000) },
    }),
    githubApp.octokit.request('GET /repos/{owner}/{repo}/installation', {
      owner,
      repo: repoName,
      request: { signal: AbortSignal.timeout(15000) },
    })
  ]);

  if (repoResult.status === 'rejected') {
    if (repoResult.reason.status === 404)
      throw new ApiError('Repository not found or you do not have access', 404);
    throw new ApiError('Failed to verify repository permissions with GitHub', 500);
  }

  if (installationResult.status === 'rejected') {
    if (installationResult.reason.status === 404)
      throw new ApiError('CodePilot is not installed on this repository. Please install the GitHub App first.', 404);
    throw new ApiError('Failed to verify GitHub App installation', 500);
  }

  const role: Role = repoResult.value.data.permissions?.admin ? Role.ADMIN : Role.MEMBER;
  const installationId = installationResult.value.data.id;
  const githubRepoId = BigInt(repoResult.value.data.id);

  if (role !== Role.ADMIN) {
    const existingProject = await prisma.project.findUnique({
      where: { provider_githubRepoId: { provider: Provider.GITHUB, githubRepoId } }
    });
    if (!existingProject)
      throw new ApiError('Only repository administrators can import new projects. Ask a repo admin to import it first.', 403);
  }

  const { isNewMember, project } = await upsertProjectWithMember({
    githubRepoId,
    owner,
    repoName,
    repoUrl,
    installationId,
    userId,
    role
  });

  if (!isNewMember) throw new ApiError('You are already connected to this project', 400);

  return project;
};

export const getProjectById = async (userId: number, projectId: number) => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      members: {
        some: { userId }
      }
    },
    include: {
      _count: {
        select: { members: true, scans: true }
      }
    }
  });

  if (!project) throw new ApiError('Project not found or access denied', 404);

  return project;
};

export const updateProject = async (userId: number, projectId: number, updateData: { name?: string }) => {
  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId, userId }
    }
  });

  if (!member) throw new ApiError('Project not found or access denied', 404);

  if (member.role !== Role.ADMIN)
    throw new ApiError('Only project administrators can update the project', 403);

  return await prisma.project.update({
    where: { id: projectId },
    data: {
      name: updateData.name
    }
  });
};

export const deleteProject = async (userId: number, projectId: number) => {
  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId, userId }
    }
  });

  if (!member) throw new ApiError('Project not found or access denied', 404);

  if (member.role !== Role.ADMIN)
    throw new ApiError('Only project administrators can delete the project', 403);

  await prisma.project.delete({
    where: { id: projectId }
  });

  return true;
};

export const leaveProject = async (userId: number, projectId: number) => {
  return await prisma.$transaction(async (tx) => {
    const members = await tx.projectMember.findMany({
      where: { projectId },
      select: { userId: true, role: true }
    });

    const membership = members.find(m => m.userId === userId);
    if (!membership) throw new ApiError('You are not a member of this project', 404);

    if (members.length === 1) {
      await tx.project.delete({ where: { id: projectId } });
      return { deleted: true };
    }

    const admins = members.filter(m => m.role === Role.ADMIN);
    if (membership.role === Role.ADMIN && admins.length <= 1)
      throw new ApiError('Cannot leave: you are the last admin. Delete the project or have another admin join first.', 400);

    await tx.projectMember.delete({
      where: { projectId_userId: { projectId, userId } }
    });

    return { deleted: false };
  });
};

export const upsertProjectWithMember = async (params: {
  githubRepoId: bigint;
  owner: string;
  repoName: string;
  repoUrl: string;
  installationId: number;
  userId: number;
  role: Role;
}) => {
  const { githubRepoId, owner, repoName, repoUrl, installationId, userId, role } = params;

  return await prisma.$transaction(async (tx) => {
    const project = await tx.project.upsert({
      where: {
        provider_githubRepoId: {
          provider: Provider.GITHUB,
          githubRepoId
        }
      },
      create: {
        name: repoName,
        repoUrl,
        provider: Provider.GITHUB,
        githubRepoId,
        owner,
        repoName,
        installationId
      },
      update: {
        installationId,
        owner,
        repoName,
        repoUrl,
      }
    });

    const existingMember = await tx.projectMember.findUnique({
      where: {
        projectId_userId: { projectId: project.id, userId }
      }
    });

    if (!existingMember) {
      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId,
          role
        }
      });
      return { isNewMember: true, project };
    }
    return { isNewMember: false, project };
  });
};

export const discoverProjects = async (userId: number, page: number = 1, limit: number = 30, search?: string) => {
  const userToken = await getValidGithubToken(userId);
  const octokit = await getUserOctokit(userToken);

  let githubRepos: any[] = [];
  let total: number | null = null;

  if (search) {
    const searchResults = await searchGithubRepos(octokit, search, page, limit);
    githubRepos = searchResults.githubRepos;
    total = searchResults.totalCount;
  } else {
    const { data: repos } = await octokit.request('GET /user/repos', {
      per_page: limit,
      page,
      sort: 'updated',
      affiliation: 'owner,collaborator,organization_member',
      request: { signal: AbortSignal.timeout(15000) },
    });
    githubRepos = repos;
    total = repos.length < limit ? (page - 1) * limit + repos.length : null;
  }

  if (githubRepos.length === 0)
    return { data: [], pagination: { page, limit, total } };

  const githubRepoIds = githubRepos.map((repo) => BigInt(repo.id));
  const existingProjects = await prisma.project.findMany({
    where: {
      provider: Provider.GITHUB,
      githubRepoId: { in: githubRepoIds }
    },
    include: {
      members: { where: { userId } }
    }
  });

  const mappedRepos = githubRepos.map(repo => {
    const githubRepoId = BigInt(repo.id);
    const existingProject = existingProjects.find(p => p.githubRepoId === githubRepoId);

    let status = 'IMPORT';
    let projectId = null;
    if (existingProject) {
      projectId = existingProject.id;
      if (existingProject.members.length > 0) status = 'JOINED';
      else status = 'JOIN';
    }

    return {
      githubId: repo.id,
      name: repo.name,
      owner: repo.owner.login,
      fullName: repo.full_name,
      url: repo.html_url,
      description: repo.description,
      private: repo.private,
      isAdmin: repo.permissions?.admin || false,
      status,
      projectId
    };
  });

  return { data: mappedRepos, pagination: { page, limit, total } };
};

export const getProjectMembers = async (userId: number, projectId: number) => {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: {
      user: {
        select: { id: true, username: true, avatarUrl: true }
      }
    }
  });

  const isMember = members.some(m => m.userId === userId);
  if (!isMember) throw new ApiError('Project not found or access denied', 404);

  return members;
}

export const syncProjectRole = async (userId: number, projectId: number) => {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    include: { project: { select: { owner: true, repoName: true, installationId: true } }, user: { select: { username: true } } }
  });

  if (!membership) throw new ApiError('Project not found or you are not a member', 404);
  if (!membership.project.installationId) throw new ApiError('GitHub App is not installed on this repository', 400);

  try {
    const appOctokit = await getInstallationOctokit(membership.project.installationId);
    const { data: permission } = await appOctokit.request('GET /repos/{owner}/{repo}/collaborators/{username}/permission', {
      owner: membership.project.owner,
      repo: membership.project.repoName,
      username: membership.user.username,
      request: { signal: AbortSignal.timeout(10000) },
    });

    const newRole = permission.permission === 'admin' ? Role.ADMIN : Role.MEMBER;

    if (membership.role !== newRole) {
      await prisma.projectMember.update({
        where: { projectId_userId: { projectId, userId } },
        data: { role: newRole }
      });
    }

    return newRole;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Failed to sync project permissions with GitHub', 500);
  }
};

export const syncProject = async (userId: number, projectId: number) => {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    include: {
      project: { select: { owner: true, repoName: true, installationId: true } },
      user: { select: { username: true } }
    }
  });

  if (!membership) throw new ApiError('Project not found or you are not a member', 404);
  if (!membership.project.installationId) throw new ApiError('GitHub App is not installed on this repository', 400);

  try {
    const appOctokit = await getInstallationOctokit(membership.project.installationId);

    const [{ data: repo }, { data: permission }] = await Promise.all([
      appOctokit.request('GET /repos/{owner}/{repo}', {
        owner: membership.project.owner,
        repo: membership.project.repoName,
        request: { signal: AbortSignal.timeout(10000) },
      }),
      appOctokit.request('GET /repos/{owner}/{repo}/collaborators/{username}/permission', {
        owner: membership.project.owner,
        repo: membership.project.repoName,
        username: membership.user.username,
        request: { signal: AbortSignal.timeout(10000) },
      }).catch(err => {
        if (err.status === 404) return { data: { permission: 'none' } };
        throw err;
      }),
    ]);

    const githubPermission = permission.permission;

    if (githubPermission === 'none') {
      await prisma.$transaction(async (tx) => {
        await tx.projectMember.delete({
          where: { projectId_userId: { projectId, userId } }
        });
        const remainingMembers = await tx.projectMember.count({ where: { projectId } });
        if (remainingMembers === 0) {
          await tx.project.delete({ where: { id: projectId } });
        }
      });
      throw new ApiError('You are no longer a member of this repository on GitHub. Access revoked.', 403);
    }

    const newRole: Role = githubPermission === 'admin' ? Role.ADMIN : Role.MEMBER;

    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { owner: repo.owner.login, repoName: repo.name, repoUrl: repo.html_url, name: repo.name },
      });

      if (membership.role !== newRole) {
        await tx.projectMember.update({
          where: { projectId_userId: { projectId, userId } },
          data: { role: newRole },
        });
      }
    });

    return { role: newRole, project: { name: repo.name, owner: repo.owner.login, repoUrl: repo.html_url } };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Failed to sync project with GitHub', 500);
  }
};
