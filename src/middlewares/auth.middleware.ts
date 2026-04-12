import { Request, Response, NextFunction } from 'express';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      status: "error",
      message: "Authentication is required. Provide a JWT token in the Authorization header."
    });
    return;
  }

  next();
};
