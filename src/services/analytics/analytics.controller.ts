import { Request, Response } from 'express';
import { getAnalytics as getAnalyticsService } from './analytics.service';

export const getAnalytics = async (req: Request, res: Response) => {
    const { projectId, scanId, page, limit } = req.query;

    if (!projectId) {
        return res.status(400).json({ status: "error", message: "projectId is required" });
    }

    try {
        const currentPage = parseInt(page as string) || 1;
        const currentLimit = parseInt(limit as string) || 20;

        const { analytics, total } = await getAnalyticsService(
            parseInt(projectId as string),
            scanId ? parseInt(scanId as string) : undefined,
            currentPage,
            currentLimit
        );

        return res.status(200).json({
            status: "success",
            data: analytics,
            pagination: {
                page: currentPage,
                limit: currentLimit,
                total,
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Failed to fetch analytics" });
    }
};
