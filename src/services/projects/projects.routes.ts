import { Router } from 'express';
import { 
  getProjects, 
  getProjectById, 
  connectProject, 
  updateProject, 
  deleteProject,
  getProjectMembers
} from './projects.controller';

const router = Router();

router.get('/', getProjects);
router.post('/', connectProject);
router.get('/:projectId', getProjectById);
router.patch('/:projectId', updateProject);
router.delete('/:projectId', deleteProject);
router.get('/:projectId/members', getProjectMembers);

export default router;
