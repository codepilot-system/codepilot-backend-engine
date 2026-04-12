import { Request, Response } from 'express';

export const getIssues = async (req: Request, res: Response) => {
  const { projectId, scanId, status, severity, category, page, limit } = req.query;
  if (!projectId) {
    return res.status(400).json({ status: "error", message: "projectId is required" });
  }

  const currentPage = parseInt(page as string) || 1;
  const currentLimit = parseInt(limit as string) || 20;

  res.status(200).json({
    status: "success",
    data: [{
      id: 901,
      projectId: parseInt(projectId as string),
      scanId: scanId ? parseInt(scanId as string) : 501,
      severity: severity ? (severity as string) : "HIGH",
      category: category ? (category as string) : "SECURITY",
      summary: "SQL Injection found in login endpoint",
      status: status ? (status as string) : "OPEN",
      detectedAt: "2026-04-10T12:00:00Z"
    }],
    pagination: {
      page: currentPage,
      limit: currentLimit,
      total: 1
    }
  });
};

export const getIssueById = async (req: Request, res: Response) => {
  const { issueId } = req.params;
  res.status(200).json({
    status: "success",
    data: {
      id: parseInt(issueId as string),
      projectId: 101,
      scanId: 501,
      severity: "HIGH",
      category: "SECURITY",
      summary: "SQL Injection found in login endpoint",
      description: "Sample detailed description of the detected issue.",
      filePath: "src/auth.ts",
      codeSnippet: "db.query('SELECT * FROM users WHERE id = ' + id)",
      lineNumber: 42,
      status: "OPEN",
      detectedAt: "2026-04-10T12:00:00Z"
    }
  });
};

export const patchIssue = async (req: Request, res: Response) => {
  const { issueId } = req.params;
  const { status } = req.body;

  res.status(200).json({
    status: "success",
    data: {
      id: parseInt(issueId as string),
      projectId: 101,
      scanId: 501,
      severity: "HIGH",
      category: "SECURITY",
      summary: "SQL Injection found in login endpoint",
      description: "Sample detailed description of the detected issue.",
      filePath: "src/auth.ts",
      codeSnippet: "db.query('SELECT * FROM users WHERE id = ' + id)",
      lineNumber: 42,
      status: status || "FIXED",
      detectedAt: "2026-04-10T12:00:00Z"
    }
  });
};
