import { Response } from 'express';
import {
    getSuggestions as serviceGetSuggestions,
    getAIFixSuggestion as serviceGetAIFixSuggestion,
    applyAISuggestion,
    dismissAISuggestion,
    bulkApplyAISuggestions,
    bulkDismissAISuggestions,
    getSuggestionsApplies,
    getSuggestionsApplyById
} from './suggestions.service';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../lib/ApiError';
import { SuggestionStatus } from '@prisma/client';

const VALID_SUGGESTION_STATUSES = new Set<string>(Object.values(SuggestionStatus));
const MAX_BULK_SUGGESTIONS = 50;

export const getSuggestions = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const { projectId, scanId, issueId, status, page, limit } = req.query;
    if (!projectId) throw new ApiError('projectId is required', 400);

    const parsedProjectId = parseInt(projectId as string, 10);
    if (isNaN(parsedProjectId)) throw new ApiError('Invalid projectId', 400);

    const parsedScanId = scanId ? parseInt(scanId as string, 10) : undefined;
    if (scanId && isNaN(parsedScanId!)) throw new ApiError('Invalid scanId', 400);

    const parsedIssueId = issueId ? parseInt(issueId as string, 10) : undefined;
    if (issueId && isNaN(parsedIssueId!)) throw new ApiError('Invalid issueId', 400);

    let parsedStatus: SuggestionStatus | undefined;
    if (status) {
        if (!VALID_SUGGESTION_STATUSES.has(status as string))
            throw new ApiError('Invalid status. Must be one of: PENDING, APPLIED, DISMISSED', 400);
        parsedStatus = status as SuggestionStatus;
    }

    const currentPage = Math.max(1, parseInt(page as string) || 1);
    const currentLimit = Math.min(50, Math.max(1, parseInt(limit as string) || 20));

    const result = await serviceGetSuggestions(userId, parsedProjectId, parsedScanId, parsedIssueId, parsedStatus, currentPage, currentLimit);

    res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: result.pagination
    });
};

export const getAIFixSuggestion = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const suggestionId = parseInt(req.params.suggestionId as string, 10);
    if (isNaN(suggestionId)) throw new ApiError('Invalid suggestion ID', 400);

    const suggestion = await serviceGetAIFixSuggestion(userId, suggestionId);

    res.status(200).json({
        status: 'success',
        data: suggestion
    });
};

export const applySuggestion = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const suggestionId = parseInt(req.params.suggestionId as string, 10);
    if (isNaN(suggestionId)) throw new ApiError('Invalid suggestion ID', 400);

    const result = await applyAISuggestion(userId, suggestionId);
    res.status(202).json({ status: 'success', data: result });
};

export const dismissSuggestion = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const suggestionId = parseInt(req.params.suggestionId as string, 10);
    if (isNaN(suggestionId)) throw new ApiError('Invalid suggestion ID', 400);

    const result = await dismissAISuggestion(userId, suggestionId);
    res.status(200).json({ status: 'success', data: result });
};

export const bulkApplySuggestions = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const { suggestionIds } = req.body;
    if (!Array.isArray(suggestionIds)) throw new ApiError('suggestionIds array is required', 400);
    if (suggestionIds.length === 0) throw new ApiError('At least one suggestion ID is required', 400);
    if (suggestionIds.length > MAX_BULK_SUGGESTIONS)
        throw new ApiError(`Cannot process more than ${MAX_BULK_SUGGESTIONS} suggestions at once`, 400);

    const ids = suggestionIds.map(id => parseInt(id as string, 10)).filter(id => !isNaN(id));
    if (ids.length !== suggestionIds.length) throw new ApiError('Invalid suggestion IDs in list', 400);

    const result = await bulkApplyAISuggestions(userId, ids);
    res.status(202).json({ status: 'success', data: result });
};

export const bulkDismissSuggestions = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const { suggestionIds } = req.body;
    if (!Array.isArray(suggestionIds)) throw new ApiError('suggestionIds array is required', 400);
    if (suggestionIds.length === 0) throw new ApiError('At least one suggestion ID is required', 400);
    if (suggestionIds.length > MAX_BULK_SUGGESTIONS)
        throw new ApiError(`Cannot process more than ${MAX_BULK_SUGGESTIONS} suggestions at once`, 400);

    const ids = suggestionIds.map(id => parseInt(id as string, 10)).filter(id => !isNaN(id));
    if (ids.length !== suggestionIds.length) throw new ApiError('Invalid suggestion IDs in list', 400);

    const result = await bulkDismissAISuggestions(userId, ids);
    res.status(200).json({ status: 'success', data: result });
};

export const listSuggestionApplies = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const { projectId, scanId, page, limit } = req.query;
    if (!projectId) throw new ApiError('projectId is required', 400);

    const parsedProjectId = parseInt(projectId as string, 10);
    if (isNaN(parsedProjectId)) throw new ApiError('Invalid projectId', 400);

    const parsedScanId = scanId ? parseInt(scanId as string, 10) : undefined;
    if (scanId && isNaN(parsedScanId!)) throw new ApiError('Invalid scanId', 400);

    const currentPage = Math.max(1, parseInt(page as string) || 1);
    const currentLimit = Math.min(50, Math.max(1, parseInt(limit as string) || 20));

    const result = await getSuggestionsApplies(userId, parsedProjectId, parsedScanId, currentPage, currentLimit);

    res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: result.pagination
    });
};

export const getSuggestionApply = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError('Unauthorized', 401);

    const applyId = parseInt(req.params.applyId as string, 10);
    if (isNaN(applyId)) throw new ApiError('Invalid apply ID', 400);

    const apply = await getSuggestionsApplyById(userId, applyId);

    res.status(200).json({
        status: 'success',
        data: apply
    });
};
