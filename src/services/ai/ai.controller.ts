import { Response } from 'express';
import { getModelStatuses as getAIModelStatuses } from './ai.service';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../lib/ApiError';
import prisma from '../../lib/prisma';

export const getModelStatuses = async (req: AuthRequest, res: Response) => {
    const scanType = req.query.scanType as string;
    if (!scanType || !['local', 'repo'].includes(scanType))
        throw new ApiError("scanType is required and must be 'local' or 'repo'", 400);

    if (scanType === 'repo') {
        const userId = req.user?.userId;
        if (!userId) throw new ApiError('Unauthorized', 401);

        const projectId = parseInt(req.query.projectId as string, 10);
        if (isNaN(projectId)) throw new ApiError('projectId is required and must be a valid integer for repo scans', 400);

        const member = await prisma.projectMember.findUnique({
            where: { projectId_userId: { projectId, userId } }
        });
        if (!member) throw new ApiError('Project not found or access denied', 404);

        const statuses = await getAIModelStatuses('repo', projectId.toString());
        res.status(200).json({ status: 'success', data: statuses });
        return;
    }

    const entityId = req.user?.userId.toString();
    if (!entityId) throw new ApiError('Unauthorized', 401);

    const statuses = await getAIModelStatuses('local', entityId);
    res.status(200).json({ status: 'success', data: statuses });
};
