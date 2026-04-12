import { Request, Response } from 'express';

export const getGithubUrl = async (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    data: { url: "https://github.com/login/oauth/authorize?client_id=sample-id" }
  });
};

export const loginWithGithub = async (req: Request, res: Response) => {
  const { code } = req.body;
  res.status(200).json({
    status: "success",
    data: {
      accessToken: "access-token-sample",
      refreshToken: "refresh-token-sample",
      user: { id: 1, githubId: 10001, username: "sample-user", avatarUrl: "https://avatars.githubusercontent.com/u/1" }
    }
  });
};

export const refreshToken = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ status: "error", message: "refreshToken is required" });
  }

  res.status(200).json({
    status: "success",
    data: { accessToken: "new-access-token-sample" }
  });
};

export const logout = async (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "Logged out successfully"
  });
};
