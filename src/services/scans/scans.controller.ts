import { Request, Response } from 'express';

export const getProjectScans = async (req: Request, res: Response) => {
  const { projectId, status, page, limit } = req.query;
  if (!projectId) {
    return res.status(400).json({ status: "error", message: "projectId is required" });
  }

  const currentPage = parseInt(page as string) || 1;
  const currentLimit = parseInt(limit as string) || 20;

  res.status(200).json({
    status: "success",
    data: [
      {
        id: 501,
        projectId: parseInt(projectId as string),
        initiatorId: 1,
        status: status ? (status as string) : "COMPLETED",
        branchName: "main",
        scanDate: "2026-04-10T12:00:00Z"
      }
    ],
    pagination: {
      page: currentPage,
      limit: currentLimit,
      total: 1
    }
  });
};

export const getScanById = async (req: Request, res: Response) => {
  const { scanId } = req.params;
  res.status(200).json({
    status: "success",
    data: {
      id: parseInt(scanId as string),
      projectId: 101,
      initiatorId: 1,
      status: "COMPLETED",
      branchName: "main",
      scanDate: "2026-04-10T12:00:00Z"
    }
  });
};

export const startScan = async (req: Request, res: Response) => {
  const { projectId, branchName } = req.body;
  if (!projectId || !branchName) {
    return res.status(400).json({ status: "error", message: "projectId and branchName are required" });
  }

  res.status(202).json({
    status: "success",
    data: {
      id: 501,
      projectId: projectId,
      initiatorId: 1,
      status: "IN_PROGRESS",
      branchName: branchName,
      scanDate: new Date().toISOString()
    }
  });
};

export const analyzeLocalCode = async (req: Request, res: Response) => {
  const { projectId, codeSnippet } = req.body;
  if (!projectId || !codeSnippet) {
    return res.status(400).json({ status: "error", message: "projectId and codeSnippet are required" });
  }

  const unifiedDiff = `--- src/auth.ts\n+++ src/auth.ts\n@@ -10,1 +10,1 @@\n- db.query('SELECT * FROM users WHERE id = ' + id);\n+ db.query('SELECT * FROM users WHERE id = $1', [id]);`;

  res.status(201).json({
    status: "success",
    data: {
      issues: [{
        id: 901,
        severity: "HIGH",
        category: "SECURITY",
        summary: "SQL Injection found in login endpoint",
        codeSnippet: "db.query('SELECT * FROM users WHERE id = ' + id)",
        status: "OPEN",
        detectedAt: "2026-04-10T12:00:00Z"
      }],
      suggestions: [{
        id: 2001,
        issueId: 901,
        status: "PENDING",
        summary: "Apply Parameterized Queries",
        explanation: "Sample detailed explanation of the AI suggestion.",
        diffPatch: unifiedDiff,
        generatedAt: "2026-04-10T12:00:00Z"
      }]
    }
  });
};

export const getScanReport = async (req: Request, res: Response) => {
  res.status(200).send("Simulated PDF Content");
};

export const deleteScan = async (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "Scan deleted successfully"
  });
};
