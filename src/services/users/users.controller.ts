import { Request, Response } from 'express';

export const getMe = async (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    data: {
      id: 1,
      githubId: 10001,
      username: "sample-user",
      email: "user@sample.com",
      avatarUrl: "https://avatars.githubusercontent.com/u/1"
    }
  });
};

export const deleteAccount = async (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "User account deleted successfully"
  });
};
