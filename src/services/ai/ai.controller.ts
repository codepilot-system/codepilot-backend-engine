import { Request, Response } from 'express';
import { getModelStatuses as getAIModelStatuses, applyAISuggestion, dismissAISuggestion } from './ai.service';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../lib/ApiError';


export const getSuggestions = async (req: Request, res: Response) => {
    const { projectId, scanId, issueId, status, page, limit } = req.query;
    if (!projectId) {
        return res.status(400).json({ status: "error", message: "projectId is required" });
    }

    const currentPage = parseInt(page as string) || 1;
    const currentLimit = parseInt(limit as string) || 20;

    res.status(200).json({
        status: "success",
        data: [{
            id: 2001,
            projectId: parseInt(projectId as string),
            scanId: scanId ? parseInt(scanId as string) : 501,
            issueId: issueId ? parseInt(issueId as string) : 901,
            status: status ? (status as string) : "PENDING",
            summary: "Apply Parameterized Queries",
            generatedAt: "2026-04-10T12:00:00Z"
        }],
        pagination: {
            page: currentPage,
            limit: currentLimit,
            total: 1
        }
    });
};

export const getModelStatuses = async (req: Request, res: Response) => {
    const scanType = req.query.scanType as string;
    if (!scanType || !['local', 'repo'].includes(scanType))
        throw new ApiError("scanType is required and must be 'local' or 'repo'", 400);

    const entityId = scanType === 'local'
        ? ((req as AuthRequest).user?.userId.toString() || req.query.userId as string)
        : req.query.projectId as string;

    const statuses = await getAIModelStatuses(scanType as 'local' | 'repo', entityId);
    res.status(200).json({ status: "success", data: statuses });
};

export const getAIFixSuggestion = async (req: Request, res: Response) => {
    const { suggestionId } = req.params;

    const unifiedDiff = `--- src/auth.ts\n+++ src/auth.ts\n@@ -10,1 +10,1 @@\n- db.query('SELECT * FROM users WHERE id = ' + id);\n+ db.query('SELECT * FROM users WHERE id = $1', [id]);`;

    res.status(200).json({
        status: "success",
        data: {
            id: parseInt(suggestionId as string),
            projectId: 101,
            scanId: 501,
            issueId: 901,
            status: "PENDING",
            summary: "Apply Parameterized Queries",
            explanation: "Sample detailed explanation of the AI suggestion.",
            diffPatch: unifiedDiff,
            generatedAt: "2026-04-10T12:00:00Z"
        }
    });
};
export const applySuggestion = async (req: Request, res: Response) => {
    const suggestionId = parseInt(req.params.suggestionId as string);
    if (isNaN(suggestionId)) throw new ApiError('Invalid suggestion ID', 400);
    const result = await applyAISuggestion(suggestionId);
    res.status(200).json({ status: "success", data: result });
};

export const dismissSuggestion = async (req: Request, res: Response) => {
    const suggestionId = parseInt(req.params.suggestionId as string);
    if (isNaN(suggestionId)) throw new ApiError('Invalid suggestion ID', 400);
    const result = await dismissAISuggestion(suggestionId);
    res.status(200).json({ status: "success", data: result });
};
