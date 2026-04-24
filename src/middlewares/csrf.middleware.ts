import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env.config';

export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  if (ENV.NODE_ENV !== 'production')
    return next();

  const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

  if (stateChangingMethods.includes(req.method)) {
    const customHeader = req.headers['x-requested-with'];

    if (customHeader !== 'XMLHttpRequest') {
      return res.status(403).json({
        status: 'error',
        message: 'Security alert: Missing security header (X-Requested-With). Request blocked to prevent potential CSRF.'
      });
    }
  }

  next();
};
