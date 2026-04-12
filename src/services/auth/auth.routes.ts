import { Router } from 'express';
import { getGithubUrl, loginWithGithub, refreshToken, logout } from './auth.controller';

const router = Router();

router.get('/github-url', getGithubUrl);
router.post('/login', loginWithGithub);
router.post('/refresh', refreshToken);
router.post('/logout', logout);

export default router;
