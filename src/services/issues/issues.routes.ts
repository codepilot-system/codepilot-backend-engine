import { Router } from 'express';
import { getIssues, getIssueById, patchIssue } from './issues.controller';

const router = Router();

router.get('/', getIssues);
router.get('/:issueId', getIssueById);
router.patch('/:issueId', patchIssue);

export default router;
