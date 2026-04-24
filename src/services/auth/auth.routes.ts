import { Router } from 'express';
import { getGithubUrl, webLogin, extensionLogin, webRefresh, extensionRefresh, webLogout, extensionLogout } from './auth.controller';

const router = Router();

router.get('/github-url', getGithubUrl);
router.post('/web/login', webLogin);
router.post('/web/refresh', webRefresh);
router.post('/web/logout', webLogout);

router.post('/extension/login', extensionLogin);
router.post('/extension/refresh', extensionRefresh);
router.post('/extension/logout', extensionLogout);

export default router;
