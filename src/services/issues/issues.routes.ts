import { Router } from 'express';
import { getIssues, getIssueById, patchIssue, applyIssuePatch } from './issues.controller';

const router = Router();




router.get('/', getIssues);
router.get('/:issueId', getIssueById);
router.patch('/:issueId', patchIssue);
router.post('/:issueId/apply', applyIssuePatch);

export default router;

