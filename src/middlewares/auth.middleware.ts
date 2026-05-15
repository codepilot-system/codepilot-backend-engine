import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.config';
import { ApiError } from '../lib/ApiError';

export interface AuthRequest extends Request {
  user?: {
    userId: number;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError('Authentication required', 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, ENV.JWT_ACCESS_SECRET as string) as { userId: number };
    req.user = decoded;
    next();
  } catch (error) {
    throw new ApiError('Invalid or expired token', 401);
  }
};
