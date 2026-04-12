import { Router } from 'express';
import { getProjectScans, startScan, getScanById, deleteScan, analyzeLocalCode, getScanReport } from './scans.controller';

const router = Router();

router.get('/', getProjectScans);
router.get('/:scanId', getScanById);
router.get('/:scanId/report', getScanReport);
router.post('/', startScan);
router.post('/local-analysis', analyzeLocalCode);
router.delete('/:scanId', deleteScan);

export default router;
