import { Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ScanStatus } from '@prisma/client';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../lib/ApiError';
import * as scansService from './scans.service';

export const localScanRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => String((req as AuthRequest).user?.userId),
    message: {
        status: 'error',
        message: 'You are scanning too fast! Please wait a minute before analyzing more code.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

export const repoScanRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 2,
    keyGenerator: (req) => req.body?.projectId ? String(req.body.projectId) : ipKeyGenerator(req.ip ?? 'unknown'),
    message: {
        status: 'error',
        message: 'This project has already been scanned recently. Please wait an hour before running another repository scan.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

export const getProjectScans = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const { projectId, status, page, limit } = req.query;
    if (!projectId) throw new ApiError('projectId is required', 400);

    const currentPage = parseInt(page as string) || 1;
    const currentLimit = parseInt(limit as string) || 20;

    let parsedStatus: ScanStatus | undefined;
    if (status) {
        if (!Object.values(ScanStatus).includes(status as ScanStatus))
            throw new ApiError(`Invalid status. Must be one of: ${Object.values(ScanStatus).join(', ')}`, 400);
        parsedStatus = status as ScanStatus;
    }

    const { scans, total } = await scansService.getProjectScans(
        userId,
        parseInt(projectId as string),
        parsedStatus,
        currentPage,
        currentLimit
    );

    res.status(200).json({
        status: 'success',
        data: scans,
        pagination: { page: currentPage, limit: currentLimit, total }
    });
};

export const getScanById = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const scanId = parseInt(req.params.scanId as string, 10);
    if (isNaN(scanId)) throw new ApiError('Invalid scan ID', 400);

    const scan = await scansService.getScanById(userId, scanId);

    res.status(200).json({ status: 'success', data: scan });
};

export const startScan = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const { projectId, branchName } = req.body;
    if (!projectId || !branchName)
        throw new ApiError('projectId and branchName are required', 400);

    const scan = await scansService.startScan(userId, parseInt(projectId, 10), branchName);

    res.status(202).json({ status: 'success', data: scan });
};

export const analyzeLocalCode = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const { projectId, files, preferredModel } = req.body;

    const result = await scansService.analyzeLocalCode(userId, files, projectId, preferredModel);

    res.status(201).json({ status: 'success', data: result });
};


export const getScanReport = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const scanId = parseInt(req.params.scanId as string, 10);
    if (isNaN(scanId)) throw new ApiError('Invalid scan ID', 400);

    const { buffer, filename } = await scansService.getScanReport(userId, scanId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
};

export const deleteScan = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const scanId = parseInt(req.params.scanId as string, 10);
    if (isNaN(scanId)) throw new ApiError('Invalid scan ID', 400);

    await scansService.deleteScan(userId, scanId);

    res.status(200).json({ status: 'success', message: 'Scan deleted successfully' });
};
