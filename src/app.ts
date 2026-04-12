import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import yaml from 'yamljs';
import path from 'path';

import authRoutes from './services/auth/auth.routes';
import usersRoutes from './services/users/users.routes';
import projectsRoutes from './services/projects/projects.routes';
import scansRoutes from './services/scans/scans.routes';
import issuesRoutes from './services/issues/issues.routes';
import aiRoutes from './services/ai/ai.routes';
import analyticsRoutes from './services/analytics/analytics.routes';
import { authenticate } from './middlewares/auth.middleware';

const app = express();
const swaggerDocument = yaml.load(path.join(__dirname, '../swagger.yaml'));

app.use(cors());
app.use(express.json());

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

export default app;
