import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/codepilot_test';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-key';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-key';
process.env.JWT_ACCESS_EXPIRES_IN ??= '15m';
process.env.JWT_REFRESH_EXPIRES_IN ??= '7d';
process.env.GITHUB_APP_ID ??= '123456';
process.env.GITHUB_APP_BOT_LOGIN ??= 'test-bot[bot]';
process.env.GITHUB_APP_PRIVATE_KEY ??= 'test-private-key';
process.env.GITHUB_CLIENT_ID ??= 'test-client-id';
process.env.GITHUB_CLIENT_SECRET ??= 'test-client-secret';
process.env.GITHUB_REDIRECT_URI ??= 'http://localhost:3000/callback';
process.env.GITHUB_WEBHOOK_SECRET ??= 'test-webhook-secret';
process.env.GITHUB_PRIVATE_KEY ??= 'test-private-key';
process.env.GROQ_API_KEY ??= 'test-groq-key';
process.env.FRONTEND_URL ??= 'http://localhost:3000';
process.env.ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.REDIS_URL ??= 'redis://localhost:6379';
