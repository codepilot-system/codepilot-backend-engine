import { CookieOptions } from 'express';
import { ENV } from './env.config';

export const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: ENV.NODE_ENV === 'production',
  sameSite: ENV.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
};
