import { Request, Response } from 'express';
import crypto from 'crypto';
import * as authService from './auth.service';
import { COOKIE_OPTIONS } from '../../config/auth.config';

export const getGithubUrl = async (req: Request, res: Response) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('auth_state', state, { ...COOKIE_OPTIONS, maxAge: 10 * 60 * 1000 });

    res.status(200).json({
      status: "success",
      data: { url: authService.getGithubAuthUrl(state) }
    });
  } catch (error) {
    console.error('getGithubUrl error:', error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const webLogin = async (req: Request, res: Response) => {
  try {
    const { code, state } = req.body;
    const cookieState = req.cookies.auth_state;

    if (!code)
      return res.status(400).json({ status: "error", message: "Code is required" });

    if (!state || !cookieState || state !== cookieState)
      return res.status(403).json({ status: "error", message: "Invalid state. Possible CSRF attack." });
    res.clearCookie('auth_state', COOKIE_OPTIONS);

    const githubAccessToken = await authService.exchangeCodeForToken(code);
    const githubUser = await authService.getGithubUser(githubAccessToken);
    const user = await authService.upsertUser(githubUser, githubAccessToken);
    const tokens = await authService.generateTokens(user.id);
    await authService.createSession(user.id, tokens.refreshToken);

    res.cookie('refreshToken', tokens.refreshToken, { ...COOKIE_OPTIONS, maxAge: 30 * 24 * 60 * 60 * 1000 });

    res.status(200).json({
      status: "success",
      data: {
        accessToken: tokens.accessToken,
        user: {
          id: user.id,
          githubId: user.githubId,
          username: user.username,
          avatarUrl: user.avatarUrl
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ status: "error", message: "Authentication failed" });
  }
};

export const extensionLogin = async (req: Request, res: Response) => {
  try {
    const { githubAccessToken } = req.body;

    if (!githubAccessToken)
      return res.status(400).json({ status: "error", message: "githubAccessToken is required" });

    const githubUser = await authService.getGithubUser(githubAccessToken);
    const user = await authService.upsertUser(githubUser, githubAccessToken);
    const tokens = await authService.generateTokens(user.id);
    await authService.createSession(user.id, tokens.refreshToken);

    res.status(200).json({
      status: "success",
      data: {
        ...tokens,
        user: {
          id: user.id,
          githubId: user.githubId,
          username: user.username,
          avatarUrl: user.avatarUrl
        }
      }
    });
  } catch (error) {
    console.error('Extension login error:', error);
    res.status(500).json({ status: "error", message: "Extension authentication failed" });
  }
};

export const webRefresh = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken)
      return res.status(401).json({ status: "error", message: "Refresh token cookie is missing" });

    const userId = await authService.verifyRefreshToken(refreshToken);
    if (!userId)
      return res.status(401).json({ status: "error", message: "Invalid or expired refresh token" });

    const tokens = await authService.generateTokens(userId);
    await authService.updateSession(refreshToken, tokens.refreshToken);

    res.cookie('refreshToken', tokens.refreshToken, { ...COOKIE_OPTIONS, maxAge: 30 * 24 * 60 * 60 * 1000 });

    res.status(200).json({ status: "success", data: { accessToken: tokens.accessToken } });
  } catch (error: any) {
    if (error.code === 'P2025')
      return res.status(401).json({ status: "error", message: "Invalid or expired refresh token" });

    console.error('webRefresh error:', error);
    res.status(500).json({ status: "error", message: "Refresh failed" });
  }
};

export const extensionRefresh = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ status: "error", message: "refreshToken is required" });

    const userId = await authService.verifyRefreshToken(refreshToken);
    if (!userId)
      return res.status(401).json({ status: "error", message: "Invalid or expired refresh token" });

    const tokens = await authService.generateTokens(userId);
    await authService.updateSession(refreshToken, tokens.refreshToken);

    res.status(200).json({ status: "success", data: tokens });
  } catch (error: any) {
    if (error.code === 'P2025')
      return res.status(401).json({ status: "error", message: "Invalid or expired refresh token" });

    console.error('extensionRefresh error:', error);
    res.status(500).json({ status: "error", message: "Refresh failed" });
  }
};

export const webLogout = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken)
      return res.status(400).json({ status: "error", message: "Refresh token cookie is missing" });

    await authService.deleteRefreshToken(refreshToken);
    res.clearCookie('refreshToken', COOKIE_OPTIONS);

    res.status(200).json({ status: "success", message: "Logged out successfully" });
  } catch (error) {
    console.error('webLogout error:', error);
    res.status(500).json({ status: "error", message: "Logout failed" });
  }
};

export const extensionLogout = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ status: "error", message: "refreshToken is required" });

    await authService.deleteRefreshToken(refreshToken);

    res.status(200).json({ status: "success", message: "Logged out successfully" });
  } catch (error) {
    console.error('extensionLogout error:', error);
    res.status(500).json({ status: "error", message: "Logout failed" });
  }
};
