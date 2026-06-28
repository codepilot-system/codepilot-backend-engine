import { Router } from 'express';
import { getModelStatuses } from './ai.controller';

const router = Router();

router.get('/statuses', getModelStatuses);

export default router;
