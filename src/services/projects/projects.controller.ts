import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import * as projectsService from './projects.service';
import { ApiError } from '../../lib/ApiError';

export const getProjects = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 30));

  const result = await projectsService.getProjects(userId, page, limit);

  res.status(200).json({
    status: 'success',
    data: result.data,
    pagination: result.pagination,
  });
};

export const connectProject = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const { owner, repoName } = req.body;
  if (!owner || !repoName) throw new ApiError('Owner and repository name are required', 400);

  const project = await projectsService.connectProject(userId, owner, repoName);

  res.status(201).json({
    status: 'success',
    data: project,
  });
};

export const getProjectById = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const projectId = parseInt(req.params.projectId as string, 10);
  if (isNaN(projectId)) throw new ApiError('Invalid project ID', 400);

  const project = await projectsService.getProjectById(userId, projectId);

  res.status(200).json({
    status: 'success',
    data: project,
  });
};

export const updateProject = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const projectId = parseInt(req.params.projectId as string, 10);
  if (isNaN(projectId)) throw new ApiError('Invalid project ID', 400);

  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0)
    throw new ApiError('Project name is required', 400);

  const project = await projectsService.updateProject(userId, projectId, { name: name.trim() });

  res.status(200).json({
    status: 'success',
    data: project,
  });
};

export const deleteProject = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const projectId = parseInt(req.params.projectId as string, 10);
  if (isNaN(projectId)) throw new ApiError('Invalid project ID', 400);

  await projectsService.deleteProject(userId, projectId);

  res.status(200).json({
    status: 'success',
    message: 'Project deleted successfully',
  });
};

export const leaveProject = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const projectId = parseInt(req.params.projectId as string, 10);
  if (isNaN(projectId)) throw new ApiError('Invalid project ID', 400);

  const result = await projectsService.leaveProject(userId, projectId);

  res.status(200).json({
    status: 'success',
    message: result.deleted
      ? 'Successfully left and deleted the project (you were the only member)'
      : 'Successfully left the project',
  });
};

export const getProjectMembers = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const projectId = parseInt(req.params.projectId as string, 10);
  if (isNaN(projectId)) throw new ApiError('Invalid project ID', 400);

  const members = await projectsService.getProjectMembers(userId, projectId);

  res.status(200).json({
    status: 'success',
    data: members.map((m) => ({
      userId: m.userId,
      username: m.user.username,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
    })),
  });
};

export const discoverProjects = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 30));
  const search = req.query.search as string | undefined;

  const result = await projectsService.discoverProjects(userId, page, limit, search);

  res.status(200).json({
    status: 'success',
    data: result.data,
    pagination: result.pagination,
  });
};

export const syncProject = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const projectId = parseInt(req.params.projectId as string, 10);
  if (isNaN(projectId)) throw new ApiError('Invalid project ID', 400);

  const result = await projectsService.syncProject(userId, projectId);

  res.status(200).json({
    status: 'success',
    data: result,
  });
};
