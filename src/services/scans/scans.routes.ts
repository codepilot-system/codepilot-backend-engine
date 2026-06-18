import { Router } from 'express';
import { getProjectScans, startScan, getScanById, deleteScan, analyzeLocalCode, getScanReport, localScanRateLimiter, repoScanRateLimiter } from './scans.controller';

const router = Router();

router.get('/', getProjectScans);
router.get('/:scanId', getScanById);
router.get('/:scanId/report', getScanReport);
router.post('/', repoScanRateLimiter, startScan);
router.post('/local-analysis', localScanRateLimiter, analyzeLocalCode);
router.delete('/:scanId', deleteScan);

export default router;
