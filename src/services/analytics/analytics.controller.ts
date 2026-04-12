import { Request, Response } from 'express';

export const getAnalytics = async (req: Request, res: Response) => {
  const { projectId, scanId, page, limit } = req.query;

  if (!projectId) {
    return res.status(400).json({ status: "error", message: "projectId is required" });
  }

  const currentPage = parseInt(page as string) || 1;
  const currentLimit = parseInt(limit as string) || 20;

  res.status(200).json({
    status: "success",
    data: [
      {
        projectId: parseInt(projectId as string),
        scanId: scanId ? parseInt(scanId as string) : 501,
        avgComplexity: 12.5,
        technicalDebtScore: 85,
        severityDistribution: { high: 2, medium: 5, low: 10 },
        generatedAt: "2026-04-10T12:00:00Z"
      }
    ],
    pagination: {
      page: currentPage,
      limit: currentLimit,
      total: 1
    }
  });
};
