import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../lib/ApiError';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', err.message || err);

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      status: 'error',
      message: 'Record not found',
    });
  }

  return res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
};
