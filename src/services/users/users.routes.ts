import { Router } from 'express';
import { getMe, deleteAccount } from './users.controller';

const router = Router();

router.get('/me', getMe);
router.delete('/me', deleteAccount);

export default router;
