import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env.config';
import { ApiError } from '../lib/ApiError';

export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  if (ENV.NODE_ENV !== 'production')
    return next();

  const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

  if (stateChangingMethods.includes(req.method)) {
    const customHeader = req.headers['x-requested-with'];

    if (customHeader !== 'XMLHttpRequest') {
      throw new ApiError('Missing required X-Requested-With header', 403);
    }
  }

  next();
};
