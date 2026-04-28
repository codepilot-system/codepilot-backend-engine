import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import YAML from 'yaml';
import path from 'path';

import authRoutes from './services/auth/auth.routes';
import usersRoutes from './services/users/users.routes';
import projectsRoutes from './services/projects/projects.routes';
import scansRoutes from './services/scans/scans.routes';
import issuesRoutes from './services/issues/issues.routes';
import aiRoutes from './services/ai/ai.routes';
import analyticsRoutes from './services/analytics/analytics.routes';
import { ENV } from './config/env.config';
import { authenticate } from './middlewares/auth.middleware';
import { csrfProtection } from './middlewares/csrf.middleware';
import { errorHandler } from './middlewares/error.middleware';

const app = express();
const swaggerDocument = YAML.parse(fs.readFileSync(path.join(__dirname, '../swagger.yaml'), 'utf8'));

app.use(cors({
  origin: ENV.FRONTEND_URL,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(csrfProtection);

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'CodePilot Backend Engine is live!' });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use('/api/auth', authRoutes);

app.use(authenticate);

app.use('/api/users', usersRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/scans', scansRoutes);
app.use('/api/issues', issuesRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/analytics', analyticsRoutes);

app.use(errorHandler);

export default app;
