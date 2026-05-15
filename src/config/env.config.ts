import dotenv from 'dotenv';

dotenv.config();

const requiredEnvs = [
  'DATABASE_URL',
  'GITHUB_APP_ID',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_REDIRECT_URI',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_PRIVATE_KEY',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY'
];

const missingEnvVars = requiredEnvs.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  throw new Error(`CRITICAL: Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 5000,
  DATABASE_URL: process.env.DATABASE_URL!,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  GITHUB_APP_ID: process.env.GITHUB_APP_ID!,
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID!,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET!,
  GITHUB_REDIRECT_URI: process.env.GITHUB_REDIRECT_URI!,
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET!,
  GITHUB_PRIVATE_KEY: process.env.GITHUB_PRIVATE_KEY!,

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET!,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',

  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
};
