import { Router } from 'express';
import {
  getProjects,
  getProjectById,
  connectProject,
  updateProject,
  deleteProject,
  leaveProject,
  getProjectMembers,
  discoverProjects,
  syncProject
} from './projects.controller';

const router = Router();

router.get('/', getProjects);
router.post('/', connectProject);
router.get('/discover', discoverProjects);
router.get('/:projectId', getProjectById);
router.patch('/:projectId', updateProject);
router.delete('/:projectId', deleteProject);
router.delete('/:projectId/leave', leaveProject);
router.post('/:projectId/sync', syncProject);
router.get('/:projectId/members', getProjectMembers);

export default router;
