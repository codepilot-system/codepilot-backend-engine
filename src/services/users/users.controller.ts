import { Response } from 'express';
import * as usersService from './users.service';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../lib/ApiError';

export const getMe = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const user = await usersService.getUserById(userId);
  if (!user) throw new ApiError('User not found', 404);

  res.status(200).json({
    status: 'success',
    data: user,
  });
};

export const syncProfile = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  const updatedUser = await usersService.syncProfile(userId);

  res.status(200).json({
    status: 'success',
    message: 'Profile synced with GitHub successfully',
    data: updatedUser,
  });
};

export const deleteAccount = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError('Unauthorized', 401);

  await usersService.deleteUser(userId);

  res.status(200).json({
    status: 'success',
    message: 'User account deleted successfully',
  });
};
