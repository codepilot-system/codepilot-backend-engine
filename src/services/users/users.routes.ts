import { Router } from 'express';
import { getMe, deleteAccount, syncProfile } from './users.controller';

const router = Router();

router.get('/me', getMe);
router.post('/me/sync', syncProfile);
router.delete('/me', deleteAccount);

export default router;
