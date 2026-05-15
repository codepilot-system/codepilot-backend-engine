import { Request, Response } from 'express';
import crypto from 'crypto';
import * as authService from './auth.service';
import { GitHubTokenResponse, exchangeCodeForToken } from '../github/github.service';
import * as usersService from '../users/users.service';
import { COOKIE_OPTIONS } from '../../config/auth.config';
import { ApiError } from '../../lib/ApiError';

export const getGithubUrl = async (req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('auth_state', state, { ...COOKIE_OPTIONS, maxAge: 10 * 60 * 1000 });

  res.status(200).json({
    status: 'success',
    data: { url: authService.getGithubAuthUrl(state) }
  });
};

export const webLogin = async (req: Request, res: Response) => {
  const { code, state } = req.body;
  const cookieState = req.cookies.auth_state;

  if (!code) throw new ApiError('Code is required', 400);

  if (!state || !cookieState || state !== cookieState)
    throw new ApiError('Invalid state. Possible CSRF attack.', 403);

  res.clearCookie('auth_state', COOKIE_OPTIONS);

  const tokenData: GitHubTokenResponse = await exchangeCodeForToken(code);
  const githubUser = await usersService.getGithubUser(tokenData.access_token);
  const user = await usersService.upsertUser(githubUser, tokenData);
  const tokens = await authService.generateTokens(user.id);
  await authService.createSession(user.id, tokens.refreshToken);

  res.cookie('refreshToken', tokens.refreshToken, { ...COOKIE_OPTIONS, maxAge: 30 * 24 * 60 * 60 * 1000 });

  res.status(200).json({
    status: 'success',
    data: {
      accessToken: tokens.accessToken,
      user: {
        id: user.id,
        githubId: user.githubId,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
    }
  });
};

export const extensionLogin = async (req: Request, res: Response) => {
  const { githubAccessToken } = req.body;

  if (!githubAccessToken) throw new ApiError('githubAccessToken is required', 400);

  const githubUser = await usersService.getGithubUser(githubAccessToken);
  const user = await usersService.upsertUser(githubUser, { access_token: githubAccessToken });
  const tokens = await authService.generateTokens(user.id);
  await authService.createSession(user.id, tokens.refreshToken);

  res.status(200).json({
    status: 'success',
    data: {
      ...tokens,
      user: {
        id: user.id,
        githubId: user.githubId,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
    },
  });
};

export const webRefresh = async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) throw new ApiError('Refresh token cookie is missing', 401);

  const userId = await authService.verifyRefreshToken(refreshToken);
  if (!userId) throw new ApiError('Invalid or expired refresh token', 401);

  const tokens = await authService.generateTokens(userId);
  await authService.updateSession(refreshToken, tokens.refreshToken);

  res.cookie('refreshToken', tokens.refreshToken, { ...COOKIE_OPTIONS, maxAge: 30 * 24 * 60 * 60 * 1000 });

  res.status(200).json({ status: 'success', data: { accessToken: tokens.accessToken } });
};

export const extensionRefresh = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new ApiError('refreshToken is required', 400);

  const userId = await authService.verifyRefreshToken(refreshToken);
  if (!userId) throw new ApiError('Invalid or expired refresh token', 401);

  const tokens = await authService.generateTokens(userId);
  await authService.updateSession(refreshToken, tokens.refreshToken);

  res.status(200).json({ status: 'success', data: tokens });
};

export const webLogout = async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) throw new ApiError('Refresh token cookie is missing', 400);

  await authService.deleteRefreshToken(refreshToken);
  res.clearCookie('refreshToken', COOKIE_OPTIONS);

  res.status(200).json({ status: 'success', message: 'Logged out successfully' });
};

export const extensionLogout = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new ApiError('refreshToken is required', 400);

  await authService.deleteRefreshToken(refreshToken);

  res.status(200).json({ status: 'success', message: 'Logged out successfully' });
};
