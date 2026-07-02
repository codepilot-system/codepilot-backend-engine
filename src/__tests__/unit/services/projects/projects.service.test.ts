import {
  getProjects,
  connectProject,
  getProjectById,
  updateProject,
  deleteProject,
  leaveProject,
  upsertProjectWithMember,
  discoverProjects,
  getProjectMembers,
  syncProjectRole,
  syncProject,
  getProjectBranches,
} from '../../../../services/projects/projects.service';
import prisma from '../../../../lib/prisma';
import { ApiError } from '../../../../lib/ApiError';
import {
  githubApp,
  getUserOctokit,
  getInstallationOctokit,
  searchGithubRepos,
} from '../../../../services/github/github.service';
import { getValidGithubToken } from '../../../../services/users/users.service';
import { Role, Provider } from '@prisma/client';

// --- Mocks ---
jest.mock('../../../../lib/prisma');
jest.mock('../../../../lib/encryption');
jest.mock('../../../../services/github/github.service', () => ({
  parseGithubUrl: jest.fn(),
  getInstallationOctokit: jest.fn(),
  getUserOctokit: jest.fn(),
  searchGithubRepos: jest.fn(),
  getInstallationToken: jest.fn(),
  githubApp: {
    octokit: {
      request: jest.fn(),
    },
  },
}));
jest.mock('../../../../services/users/users.service', () => ({
  getValidGithubToken: jest.fn(),
}));
jest.mock('../../../../config/env.config', () => ({
  ENV: {
    GITHUB_APP_ID: 'test',
    GITHUB_CLIENT_ID: 'test',
    GITHUB_CLIENT_SECRET: 'test',
    GITHUB_REDIRECT_URI: 'test',
    GITHUB_WEBHOOK_SECRET: 'test',
    GITHUB_PRIVATE_KEY: 'test-key',
    GITHUB_APP_BOT_LOGIN: 'test-bot',
  },
}));

// ---- Helpers ----
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const makeProject = (overrides: Record<string, any> = {}) => ({
  id: 1,
  name: 'test-repo',
  repoUrl: 'https://github.com/owner/test-repo',
  provider: Provider.GITHUB,
  githubRepoId: BigInt(100),
  owner: 'owner',
  repoName: 'test-repo',
  installationId: BigInt(500),
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  _count: { members: 2, scans: 5 },
  ...overrides,
});

const makeMember = (overrides: Record<string, any> = {}) => ({
  id: 1,
  projectId: 1,
  userId: 1,
  role: Role.ADMIN,
  createdAt: new Date('2025-01-01'),
  ...overrides,
});

describe('Projects Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // getProjects
  // ============================================================
  describe('getProjects', () => {
    it('should return paginated projects for user', async () => {
      const projects = [makeProject(), makeProject({ id: 2, name: 'repo-2' })];
      (mockPrisma.project.findMany as jest.Mock).mockResolvedValue(projects);
      (mockPrisma.project.count as jest.Mock).mockResolvedValue(2);

      const result = await getProjects(1, 1, 30);

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { members: { some: { userId: 1 } } },
          skip: 0,
          take: 30,
          include: { _count: { select: { members: true, scans: true } } },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(mockPrisma.project.count).toHaveBeenCalledWith({
        where: { members: { some: { userId: 1 } } },
      });
      expect(result).toEqual({
        data: projects,
        pagination: { page: 1, limit: 30, total: 2 },
      });
    });

    it('should calculate correct skip for page 3', async () => {
      (mockPrisma.project.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.project.count as jest.Mock).mockResolvedValue(0);

      await getProjects(1, 3, 10);

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('should use default page and limit', async () => {
      (mockPrisma.project.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.project.count as jest.Mock).mockResolvedValue(0);

      await getProjects(1);

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 30 }),
      );
    });

    it('should return empty data for user with no projects', async () => {
      (mockPrisma.project.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.project.count as jest.Mock).mockResolvedValue(0);

      const result = await getProjects(99);

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });
  });

  // ============================================================
  // getProjectById
  // ============================================================
  describe('getProjectById', () => {
    it('should return the project when user is a member', async () => {
      const project = makeProject();
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue(project);

      const result = await getProjectById(1, 1);

      expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: 1, members: { some: { userId: 1 } } },
        include: { _count: { select: { members: true, scans: true } } },
      });
      expect(result).toEqual(project);
    });

    it('should throw 404 when project not found', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(getProjectById(1, 999)).rejects.toThrow(ApiError);
      await expect(getProjectById(1, 999)).rejects.toThrow('Project not found or access denied');
    });

    it('should throw 404 when user is not a member', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(getProjectById(99, 1)).rejects.toThrow(ApiError);
    });
  });

  // ============================================================
  // updateProject
  // ============================================================
  describe('updateProject', () => {
    it('should update project name when user is admin', async () => {
      const member = makeMember({ role: Role.ADMIN });
      const updated = makeProject({ name: 'new-name' });

      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(member);
      (mockPrisma.project.update as jest.Mock).mockResolvedValue(updated);

      const result = await updateProject(1, 1, { name: 'new-name' });

      expect(mockPrisma.projectMember.findUnique).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: 1, userId: 1 } },
      });
      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { name: 'new-name' },
      });
      expect(result).toEqual(updated);
    });

    it('should throw 404 when member not found', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(updateProject(1, 999, { name: 'x' })).rejects.toThrow(ApiError);
      await expect(updateProject(1, 999, { name: 'x' })).rejects.toThrow(
        'Project not found or access denied',
      );
    });

    it('should throw 403 when user is not admin', async () => {
      const member = makeMember({ role: Role.MEMBER });
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(member);

      await expect(updateProject(1, 1, { name: 'x' })).rejects.toThrow(ApiError);
      await expect(updateProject(1, 1, { name: 'x' })).rejects.toThrow(
        'Only project administrators can update the project',
      );
    });
  });

  // ============================================================
  // deleteProject
  // ============================================================
  describe('deleteProject', () => {
    it('should delete project when user is admin', async () => {
      const member = makeMember({ role: Role.ADMIN });
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(member);
      (mockPrisma.project.delete as jest.Mock).mockResolvedValue({});

      const result = await deleteProject(1, 1);

      expect(mockPrisma.project.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toBe(true);
    });

    it('should throw 404 when member not found', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(deleteProject(1, 999)).rejects.toThrow(ApiError);
      await expect(deleteProject(1, 999)).rejects.toThrow('Project not found or access denied');
    });

    it('should throw 403 when user is not admin', async () => {
      const member = makeMember({ role: Role.MEMBER });
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(member);

      await expect(deleteProject(1, 1)).rejects.toThrow(ApiError);
      await expect(deleteProject(1, 1)).rejects.toThrow(
        'Only project administrators can delete the project',
      );
    });
  });

  // ============================================================
  // leaveProject
  // ============================================================
  describe('leaveProject', () => {
    it('should delete project when user is the only member', async () => {
      const members = [{ userId: 1, role: Role.ADMIN }];
      const tx = {
        projectMember: { findMany: jest.fn().mockResolvedValue(members), delete: jest.fn() },
        project: { delete: jest.fn().mockResolvedValue({}) },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      const result = await leaveProject(1, 1);

      expect(tx.project.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({ deleted: true });
    });

    it('should remove member when other members exist', async () => {
      const members = [
        { userId: 1, role: Role.MEMBER },
        { userId: 2, role: Role.ADMIN },
      ];
      const tx = {
        projectMember: {
          findMany: jest.fn().mockResolvedValue(members),
          delete: jest.fn().mockResolvedValue({}),
        },
        project: { delete: jest.fn() },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      const result = await leaveProject(1, 1);

      expect(tx.projectMember.delete).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: 1, userId: 1 } },
      });
      expect(tx.project.delete).not.toHaveBeenCalled();
      expect(result).toEqual({ deleted: false });
    });

    it('should throw 404 if user is not a member', async () => {
      const members = [{ userId: 2, role: Role.ADMIN }];
      const tx = {
        projectMember: { findMany: jest.fn().mockResolvedValue(members) },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      await expect(leaveProject(1, 1)).rejects.toThrow(ApiError);
      await expect(leaveProject(1, 1)).rejects.toThrow('Project not found or access denied');
    });

    it('should throw 400 if user is the last admin with other members', async () => {
      const members = [
        { userId: 1, role: Role.ADMIN },
        { userId: 2, role: Role.MEMBER },
      ];
      const tx = {
        projectMember: { findMany: jest.fn().mockResolvedValue(members) },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      await expect(leaveProject(1, 1)).rejects.toThrow(ApiError);
      await expect(leaveProject(1, 1)).rejects.toThrow('Cannot leave: you are the last admin');
    });

    it('should allow admin to leave when another admin exists', async () => {
      const members = [
        { userId: 1, role: Role.ADMIN },
        { userId: 2, role: Role.ADMIN },
      ];
      const tx = {
        projectMember: {
          findMany: jest.fn().mockResolvedValue(members),
          delete: jest.fn().mockResolvedValue({}),
        },
        project: { delete: jest.fn() },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      const result = await leaveProject(1, 1);

      expect(tx.projectMember.delete).toHaveBeenCalled();
      expect(result).toEqual({ deleted: false });
    });
  });

  // ============================================================
  // upsertProjectWithMember
  // ============================================================
  describe('upsertProjectWithMember', () => {
    const params = {
      githubRepoId: BigInt(100),
      owner: 'owner',
      repoName: 'repo',
      repoUrl: 'https://github.com/owner/repo',
      installationId: 500,
      userId: 1,
      role: Role.ADMIN,
    };

    it('should create project and member when both are new', async () => {
      const project = makeProject();
      const tx = {
        project: { upsert: jest.fn().mockResolvedValue(project) },
        projectMember: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      const result = await upsertProjectWithMember(params);

      expect(tx.project.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_githubRepoId: { provider: Provider.GITHUB, githubRepoId: BigInt(100) },
          },
          create: expect.objectContaining({ name: 'repo', provider: Provider.GITHUB }),
          update: expect.objectContaining({ installationId: 500 }),
        }),
      );
      expect(tx.projectMember.create).toHaveBeenCalledWith({
        data: { projectId: 1, userId: 1, role: Role.ADMIN },
      });
      expect(result).toEqual({ isNewMember: true, project });
    });

    it('should return isNewMember false when member already exists', async () => {
      const project = makeProject();
      const tx = {
        project: { upsert: jest.fn().mockResolvedValue(project) },
        projectMember: {
          findUnique: jest.fn().mockResolvedValue(makeMember()),
          create: jest.fn(),
        },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      const result = await upsertProjectWithMember(params);

      expect(tx.projectMember.create).not.toHaveBeenCalled();
      expect(result).toEqual({ isNewMember: false, project });
    });
  });

  // ============================================================
  // connectProject
  // ============================================================
  describe('connectProject', () => {
    const setupConnect = (overrides: {
      repoResult?: any;
      installResult?: any;
      repoReject?: any;
      installReject?: any;
    } = {}) => {
      const mockUserOctokit = { request: jest.fn() };
      (getValidGithubToken as jest.Mock).mockResolvedValue('valid-token');
      (getUserOctokit as jest.Mock).mockResolvedValue(mockUserOctokit);

      const repoPromise = overrides.repoReject
        ? Promise.reject(overrides.repoReject)
        : Promise.resolve(
            overrides.repoResult || {
              data: { id: 100, permissions: { admin: true } },
            },
          );

      const installPromise = overrides.installReject
        ? Promise.reject(overrides.installReject)
        : Promise.resolve(overrides.installResult || { data: { id: 500 } });

      mockUserOctokit.request.mockImplementation((url: string) => {
        if (url.startsWith('GET /repos/')) return repoPromise;
        return Promise.resolve({});
      });

      ((githubApp.octokit.request as unknown) as jest.Mock).mockReturnValue(installPromise);

      return mockUserOctokit;
    };

    it('should connect an admin user to a new project', async () => {
      setupConnect();
      const project = makeProject();
      const tx = {
        project: { upsert: jest.fn().mockResolvedValue(project) },
        projectMember: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      const result = await connectProject(1, 'owner', 'test-repo');

      expect(getValidGithubToken).toHaveBeenCalledWith(1);
      expect(getUserOctokit).toHaveBeenCalledWith('valid-token');
      expect(result).toEqual(project);
    });

    it('should throw 404 when repo not found (user octokit 404)', async () => {
      setupConnect({ repoReject: { status: 404 } });

      await expect(connectProject(1, 'owner', 'missing')).rejects.toThrow(
        'Repository not found or you do not have access',
      );
    });

    it('should throw 500 when repo check fails with non-404', async () => {
      setupConnect({ repoReject: { status: 500 } });

      await expect(connectProject(1, 'owner', 'repo')).rejects.toThrow(
        'Failed to verify repository permissions with GitHub',
      );
    });

    it('should throw 404 when app not installed on repo', async () => {
      setupConnect({ installReject: { status: 404 } });

      await expect(connectProject(1, 'owner', 'repo')).rejects.toThrow(
        'CodePilot is not installed on this repository',
      );
    });

    it('should throw 500 when app installation check fails with non-404', async () => {
      setupConnect({ installReject: { status: 500 } });

      await expect(connectProject(1, 'owner', 'repo')).rejects.toThrow(
        'Failed to verify GitHub App installation',
      );
    });

    it('should throw 403 for non-admin when project does not exist yet', async () => {
      setupConnect({
        repoResult: { data: { id: 100, permissions: { admin: false } } },
      });
      (mockPrisma.project.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(connectProject(1, 'owner', 'repo')).rejects.toThrow(
        'Only repository administrators can import new projects',
      );
    });

    it('should allow non-admin when project already exists', async () => {
      setupConnect({
        repoResult: { data: { id: 100, permissions: { admin: false } } },
      });
      (mockPrisma.project.findUnique as jest.Mock).mockResolvedValue(makeProject());

      const project = makeProject();
      const tx = {
        project: { upsert: jest.fn().mockResolvedValue(project) },
        projectMember: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      const result = await connectProject(1, 'owner', 'repo');
      expect(result).toEqual(project);
    });

    it('should throw 400 when user is already connected', async () => {
      setupConnect();
      const project = makeProject();
      const tx = {
        project: { upsert: jest.fn().mockResolvedValue(project) },
        projectMember: {
          findUnique: jest.fn().mockResolvedValue(makeMember()),
          create: jest.fn(),
        },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

      await expect(connectProject(1, 'owner', 'repo')).rejects.toThrow(
        'You are already connected to this project',
      );
    });
  });

  // ============================================================
  // discoverProjects
  // ============================================================
  describe('discoverProjects', () => {
    const setupDiscover = () => {
      const mockOctokit = { request: jest.fn() };
      (getValidGithubToken as jest.Mock).mockResolvedValue('valid-token');
      (getUserOctokit as jest.Mock).mockResolvedValue(mockOctokit);
      return mockOctokit;
    };

    it('should discover repos using search when search param provided', async () => {
      const mockOctokit = setupDiscover();
      const repos = [
        { id: 100, name: 'repo1', owner: { login: 'owner' }, full_name: 'owner/repo1', html_url: 'https://github.com/owner/repo1', description: 'desc', private: false, permissions: { admin: true } },
      ];
      (searchGithubRepos as jest.Mock).mockResolvedValue({ githubRepos: repos, totalCount: 1 });
      (mockPrisma.project.findMany as jest.Mock).mockResolvedValue([]);

      const result = await discoverProjects(1, 1, 30, 'repo1');

      expect(searchGithubRepos).toHaveBeenCalledWith(mockOctokit, 'repo1', 1, 30);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({ name: 'repo1', status: 'IMPORT' }),
      );
    });

    it('should discover repos from user repos when no search', async () => {
      const mockOctokit = setupDiscover();
      const repos = [
        { id: 200, name: 'myrepo', owner: { login: 'me' }, full_name: 'me/myrepo', html_url: 'https://github.com/me/myrepo', description: null, private: true, permissions: { admin: false } },
      ];
      mockOctokit.request.mockResolvedValue({ data: repos });
      (mockPrisma.project.findMany as jest.Mock).mockResolvedValue([]);

      const result = await discoverProjects(1, 1, 30);

      expect(mockOctokit.request).toHaveBeenCalledWith('GET /user/repos', expect.objectContaining({
        per_page: 30,
        page: 1,
        sort: 'updated',
      }));
      expect(result.data[0]).toEqual(
        expect.objectContaining({ name: 'myrepo', isAdmin: false, status: 'IMPORT' }),
      );
    });

    it('should return empty data when no repos found', async () => {
      const mockOctokit = setupDiscover();
      mockOctokit.request.mockResolvedValue({ data: [] });

      const result = await discoverProjects(1, 1, 30);

      expect(result).toEqual({ data: [], pagination: { page: 1, limit: 30, total: 0 } });
    });

    it('should mark repos as JOINED when user is a member', async () => {
      const mockOctokit = setupDiscover();
      const repos = [
        { id: 100, name: 'repo1', owner: { login: 'owner' }, full_name: 'owner/repo1', html_url: 'https://github.com/owner/repo1', description: null, private: false, permissions: {} },
      ];
      mockOctokit.request.mockResolvedValue({ data: repos });

      const existingProjects = [
        { id: 1, githubRepoId: BigInt(100), members: [{ userId: 1 }] },
      ];
      (mockPrisma.project.findMany as jest.Mock).mockResolvedValue(existingProjects);

      const result = await discoverProjects(1, 1, 30);

      expect(result.data[0]).toEqual(
        expect.objectContaining({ status: 'JOINED', projectId: 1 }),
      );
    });

    it('should mark repos as JOIN when project exists but user is not a member', async () => {
      const mockOctokit = setupDiscover();
      const repos = [
        { id: 100, name: 'repo1', owner: { login: 'owner' }, full_name: 'owner/repo1', html_url: 'https://github.com/owner/repo1', description: null, private: false, permissions: {} },
      ];
      mockOctokit.request.mockResolvedValue({ data: repos });

      const existingProjects = [
        { id: 1, githubRepoId: BigInt(100), members: [] },
      ];
      (mockPrisma.project.findMany as jest.Mock).mockResolvedValue(existingProjects);

      const result = await discoverProjects(1, 1, 30);

      expect(result.data[0]).toEqual(
        expect.objectContaining({ status: 'JOIN', projectId: 1 }),
      );
    });

    it('should set total to null when results fill the page (no search)', async () => {
      const mockOctokit = setupDiscover();
      // 30 repos = full page → can't determine total
      const repos = Array.from({ length: 30 }, (_, i) => ({
        id: i + 1, name: `repo${i}`, owner: { login: 'o' }, full_name: `o/repo${i}`, html_url: `u`, description: null, private: false, permissions: {},
      }));
      mockOctokit.request.mockResolvedValue({ data: repos });
      (mockPrisma.project.findMany as jest.Mock).mockResolvedValue([]);

      const result = await discoverProjects(1, 1, 30);

      expect(result.pagination.total).toBeNull();
    });
  });

  // ============================================================
  // getProjectMembers
  // ============================================================
  describe('getProjectMembers', () => {
    it('should return members when user is a member', async () => {
      const members = [
        { userId: 1, user: { id: 1, username: 'user1', avatarUrl: null }, role: Role.ADMIN },
        { userId: 2, user: { id: 2, username: 'user2', avatarUrl: null }, role: Role.MEMBER },
      ];
      (mockPrisma.projectMember.findMany as jest.Mock).mockResolvedValue(members);

      const result = await getProjectMembers(1, 1);

      expect(mockPrisma.projectMember.findMany).toHaveBeenCalledWith({
        where: { projectId: 1 },
        include: { user: { select: { id: true, username: true, avatarUrl: true } } },
      });
      expect(result).toEqual(members);
    });

    it('should throw 404 when user is not a member', async () => {
      const members = [
        { userId: 2, user: { id: 2, username: 'user2', avatarUrl: null } },
      ];
      (mockPrisma.projectMember.findMany as jest.Mock).mockResolvedValue(members);

      await expect(getProjectMembers(1, 1)).rejects.toThrow(ApiError);
      await expect(getProjectMembers(1, 1)).rejects.toThrow('Project not found or access denied');
    });

    it('should throw 404 when project has no members (empty)', async () => {
      (mockPrisma.projectMember.findMany as jest.Mock).mockResolvedValue([]);

      await expect(getProjectMembers(1, 999)).rejects.toThrow(ApiError);
    });
  });

  // ============================================================
  // syncProjectRole
  // ============================================================
  describe('syncProjectRole', () => {
    const setupSync = (permission: string = 'admin') => {
      const mockAppOctokit = {
        request: jest.fn().mockResolvedValue({ data: { permission } }),
      };
      (getInstallationOctokit as jest.Mock).mockResolvedValue(mockAppOctokit);
      return mockAppOctokit;
    };

    it('should sync role to ADMIN when github permission is admin', async () => {
      const membership = {
        ...makeMember({ role: Role.MEMBER }),
        project: { owner: 'owner', repoName: 'repo', installationId: BigInt(500) },
        user: { username: 'testuser' },
      };
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(membership);
      setupSync('admin');
      (mockPrisma.projectMember.update as jest.Mock).mockResolvedValue({});

      const result = await syncProjectRole(1, 1);

      expect(mockPrisma.projectMember.update).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: 1, userId: 1 } },
        data: { role: Role.ADMIN },
      });
      expect(result).toBe(Role.ADMIN);
    });

    it('should sync role to MEMBER when github permission is write', async () => {
      const membership = {
        ...makeMember({ role: Role.ADMIN }),
        project: { owner: 'owner', repoName: 'repo', installationId: BigInt(500) },
        user: { username: 'testuser' },
      };
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(membership);
      setupSync('write');
      (mockPrisma.projectMember.update as jest.Mock).mockResolvedValue({});

      const result = await syncProjectRole(1, 1);

      expect(mockPrisma.projectMember.update).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: 1, userId: 1 } },
        data: { role: Role.MEMBER },
      });
      expect(result).toBe(Role.MEMBER);
    });

    it('should skip update when role has not changed', async () => {
      const membership = {
        ...makeMember({ role: Role.ADMIN }),
        project: { owner: 'owner', repoName: 'repo', installationId: BigInt(500) },
        user: { username: 'testuser' },
      };
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(membership);
      setupSync('admin');

      const result = await syncProjectRole(1, 1);

      expect(mockPrisma.projectMember.update).not.toHaveBeenCalled();
      expect(result).toBe(Role.ADMIN);
    });

    it('should throw 404 when membership not found', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(syncProjectRole(1, 1)).rejects.toThrow(ApiError);
      await expect(syncProjectRole(1, 1)).rejects.toThrow('Project not found or access denied');
    });

    it('should throw 400 when installation id is missing', async () => {
      const membership = {
        ...makeMember(),
        project: { owner: 'owner', repoName: 'repo', installationId: null },
        user: { username: 'testuser' },
      };
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(membership);

      await expect(syncProjectRole(1, 1)).rejects.toThrow(ApiError);
      await expect(syncProjectRole(1, 1)).rejects.toThrow(
        'GitHub App is not installed on this repository',
      );
    });

    it('should throw 500 on unexpected github error', async () => {
      const membership = {
        ...makeMember(),
        project: { owner: 'owner', repoName: 'repo', installationId: BigInt(500) },
        user: { username: 'testuser' },
      };
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(membership);
      (getInstallationOctokit as jest.Mock).mockResolvedValue({
        request: jest.fn().mockRejectedValue(new Error('Network error')),
      });

      await expect(syncProjectRole(1, 1)).rejects.toThrow(ApiError);
      await expect(syncProjectRole(1, 1)).rejects.toThrow(
        'Failed to sync project permissions with GitHub',
      );
    });

    it('should re-throw ApiError as-is', async () => {
      const membership = {
        ...makeMember(),
        project: { owner: 'owner', repoName: 'repo', installationId: BigInt(500) },
        user: { username: 'testuser' },
      };
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(membership);
      (getInstallationOctokit as jest.Mock).mockRejectedValue(
        new ApiError('Custom error', 422),
      );

      await expect(syncProjectRole(1, 1)).rejects.toThrow('Custom error');
    });
  });

  // ============================================================
  // syncProject
  // ============================================================
  describe('syncProject', () => {
    const setupSyncProject = (opts: {
      permission?: string;
      repoData?: Record<string, any>;
      permissionCatch?: boolean;
    } = {}) => {
      const permission = opts.permission ?? 'admin';
      const repoData = opts.repoData ?? {
        name: 'repo',
        owner: { login: 'owner' },
        html_url: 'https://github.com/owner/repo',
      };

      const mockAppOctokit = {
        request: jest.fn().mockImplementation((url: string) => {
          if (url.includes('collaborators')) {
            if (opts.permissionCatch) {
              return Promise.reject({ status: 404 });
            }
            return Promise.resolve({ data: { permission } });
          }
          return Promise.resolve({ data: repoData });
        }),
      };
      (getInstallationOctokit as jest.Mock).mockResolvedValue(mockAppOctokit);
      return mockAppOctokit;
    };

    const baseMembership = {
      ...makeMember({ role: Role.ADMIN }),
      project: { owner: 'owner', repoName: 'repo', installationId: BigInt(500) },
      user: { username: 'testuser' },
    };

    it('should sync project data and role', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(baseMembership);
      setupSyncProject({ permission: 'admin' });
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb({
        project: { update: jest.fn().mockResolvedValue({}) },
        projectMember: { update: jest.fn().mockResolvedValue({}) },
      }));

      const result = await syncProject(1, 1);

      expect(result).toEqual({
        role: Role.ADMIN,
        project: { name: 'repo', owner: 'owner', repoUrl: 'https://github.com/owner/repo' },
      });
    });

    it('should update role when it differs from current', async () => {
      const membership = {
        ...makeMember({ role: Role.ADMIN }),
        project: { owner: 'owner', repoName: 'repo', installationId: BigInt(500) },
        user: { username: 'testuser' },
      };
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(membership);
      setupSyncProject({ permission: 'write' });

      const txProject = { update: jest.fn().mockResolvedValue({}) };
      const txMember = { update: jest.fn().mockResolvedValue({}) };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) =>
        cb({ project: txProject, projectMember: txMember }),
      );

      const result = await syncProject(1, 1);

      expect(txMember.update).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: 1, userId: 1 } },
        data: { role: Role.MEMBER },
      });
      expect(result.role).toBe(Role.MEMBER);
    });

    it('should skip member role update when role has not changed', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(baseMembership);
      setupSyncProject({ permission: 'admin' });

      const txMember = { update: jest.fn() };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) =>
        cb({ project: { update: jest.fn().mockResolvedValue({}) }, projectMember: txMember }),
      );

      await syncProject(1, 1);

      expect(txMember.update).not.toHaveBeenCalled();
    });

    it('should revoke access when user has no github permission', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(baseMembership);

      // Return 'none' permission via the catch path mock
      const mockAppOctokit = {
        request: jest.fn().mockImplementation((url: string) => {
          if (url.includes('collaborators')) {
            const p = Promise.reject({ status: 404 });
            // Simulate the .catch in the source code
            return p.catch((err: any) => {
              if (err.status === 404) return { data: { permission: 'none' } };
              throw err;
            });
          }
          return Promise.resolve({ data: { name: 'repo', owner: { login: 'owner' }, html_url: 'u' } });
        }),
      };
      (getInstallationOctokit as jest.Mock).mockResolvedValue(mockAppOctokit);

      const txMember = { delete: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) };
      const txProject = { delete: jest.fn().mockResolvedValue({}) };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) =>
        cb({ projectMember: txMember, project: txProject }),
      );

      await expect(syncProject(1, 1)).rejects.toThrow(
        'You are no longer a member of this repository on GitHub. Access revoked.',
      );
      expect(txMember.delete).toHaveBeenCalled();
    });

    it('should delete project when last member is removed', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(baseMembership);

      const mockAppOctokit = {
        request: jest.fn().mockImplementation((url: string) => {
          if (url.includes('collaborators')) {
            return Promise.reject({ status: 404 }).catch(() => ({ data: { permission: 'none' } }));
          }
          return Promise.resolve({ data: { name: 'repo', owner: { login: 'owner' }, html_url: 'u' } });
        }),
      };
      (getInstallationOctokit as jest.Mock).mockResolvedValue(mockAppOctokit);

      const txMember = { delete: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) };
      const txProject = { delete: jest.fn().mockResolvedValue({}) };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) =>
        cb({ projectMember: txMember, project: txProject }),
      );

      await expect(syncProject(1, 1)).rejects.toThrow(ApiError);

      expect(txProject.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should not delete project when other members remain', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(baseMembership);

      const mockAppOctokit = {
        request: jest.fn().mockImplementation((url: string) => {
          if (url.includes('collaborators')) {
            return Promise.reject({ status: 404 }).catch(() => ({ data: { permission: 'none' } }));
          }
          return Promise.resolve({ data: { name: 'repo', owner: { login: 'owner' }, html_url: 'u' } });
        }),
      };
      (getInstallationOctokit as jest.Mock).mockResolvedValue(mockAppOctokit);

      const txMember = { delete: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(2) };
      const txProject = { delete: jest.fn() };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: any) =>
        cb({ projectMember: txMember, project: txProject }),
      );

      await expect(syncProject(1, 1)).rejects.toThrow(ApiError);
      expect(txProject.delete).not.toHaveBeenCalled();
    });

    it('should throw 404 when membership not found', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(syncProject(1, 1)).rejects.toThrow('Project not found or access denied');
    });

    it('should throw 400 when installation id is missing', async () => {
      const membership = {
        ...makeMember(),
        project: { owner: 'owner', repoName: 'repo', installationId: null },
        user: { username: 'testuser' },
      };
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(membership);

      await expect(syncProject(1, 1)).rejects.toThrow(
        'GitHub App is not installed on this repository',
      );
    });

    it('should throw 500 on unexpected github error', async () => {
      (mockPrisma.projectMember.findUnique as jest.Mock).mockResolvedValue(baseMembership);
      (getInstallationOctokit as jest.Mock).mockResolvedValue({
        request: jest.fn().mockRejectedValue(new Error('timeout')),
      });

      await expect(syncProject(1, 1)).rejects.toThrow('Failed to sync project with GitHub');
    });
  });

  // ============================================================
  // getProjectBranches
  // ============================================================
  describe('getProjectBranches', () => {
    it('should return branches with default branch marked', async () => {
      const project = { owner: 'owner', repoName: 'repo', installationId: BigInt(500) };
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue(project);

      const mockAppOctokit = {
        request: jest.fn().mockImplementation((url: string) => {
          if (url.includes('/branches')) {
            return Promise.resolve({
              data: [{ name: 'main' }, { name: 'develop' }, { name: 'feature/x' }],
            });
          }
          return Promise.resolve({ data: { default_branch: 'main' } });
        }),
      };
      (getInstallationOctokit as jest.Mock).mockResolvedValue(mockAppOctokit);

      const result = await getProjectBranches(1, 1);

      expect(result).toEqual([
        { name: 'main', isDefault: true },
        { name: 'develop', isDefault: false },
        { name: 'feature/x', isDefault: false },
      ]);
    });

    it('should throw 404 when project not found', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(getProjectBranches(1, 999)).rejects.toThrow(ApiError);
      await expect(getProjectBranches(1, 999)).rejects.toThrow(
        'Project not found or access denied',
      );
    });

    it('should throw 400 when installation id is missing', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue({
        owner: 'owner',
        repoName: 'repo',
        installationId: null,
      });

      await expect(getProjectBranches(1, 1)).rejects.toThrow(ApiError);
      await expect(getProjectBranches(1, 1)).rejects.toThrow(
        'GitHub App is not installed on this repository',
      );
    });

    it('should throw 500 on unexpected github error', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue({
        owner: 'owner',
        repoName: 'repo',
        installationId: BigInt(500),
      });
      (getInstallationOctokit as jest.Mock).mockResolvedValue({
        request: jest.fn().mockRejectedValue(new Error('timeout')),
      });

      await expect(getProjectBranches(1, 1)).rejects.toThrow(
        'Failed to fetch project branches from GitHub',
      );
    });

    it('should re-throw ApiError from within try-catch', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue({
        owner: 'owner',
        repoName: 'repo',
        installationId: BigInt(500),
      });
      (getInstallationOctokit as jest.Mock).mockRejectedValue(
        new ApiError('Custom API error', 422),
      );

      await expect(getProjectBranches(1, 1)).rejects.toThrow('Custom API error');
    });
  });
});
