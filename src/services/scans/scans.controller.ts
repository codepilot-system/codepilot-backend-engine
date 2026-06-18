import { Request, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { analyzeLocalScan, CodeFile } from '../ai/ai.service';
import { ApiError } from '../../lib/ApiError';
import prisma from '../../lib/prisma';
import rateLimit from 'express-rate-limit';


export const localScanRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => String((req as AuthRequest).user?.userId),
  message: {
    status: "error",
    message: "You are scanning too fast! Please wait a minute before analyzing more code."
  },
  standardHeaders: true,
  legacyHeaders: false,
});


export const repoScanRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 2,
  keyGenerator: (req) => req.body?.projectId ? String(req.body.projectId) : (req.ip ?? 'unknown'),
  message: {
    status: "error",
    message: "This project has already been scanned recently. Please wait an hour before running another repository scan."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const getProjectScans = async (req: Request, res: Response) => {
  const { projectId, status, page, limit } = req.query;
  if (!projectId)
    throw new ApiError("projectId is required", 400);

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
  if (!projectId || !branchName)
    throw new ApiError("projectId and branchName are required", 400);

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

export const analyzeLocalCode = async (req: AuthRequest, res: Response) => {
  const { projectId, files, preferredModel } = req.body;

  if (!Array.isArray(files) || files.length === 0)
    throw new ApiError("At least one file is required for analysis", 400);

  const scanFiles: CodeFile[] = [];
  for (const file of files as { path: string; content: string; selectedLines?: { start: number; end: number }[] }[]) {
    if (!file.path)
      throw new ApiError("Each file must have a non-empty path", 400);
    if (typeof file.content !== 'string')
      throw new ApiError(`File "${file.path}" must have string content`, 400);

    // Skip files with empty content (e.g. accidentally selected in the extension)
    if (!file.content.trim()) continue;

    const totalLines = file.content.split('\n').length;
    let mappedLines = file.selectedLines?.map((line) => {
      const start = parseInt(String(line.start), 10);
      const end = parseInt(String(line.end), 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end < start)
        throw new ApiError(`Invalid selectedLines range in file "${file.path}": start and end must be positive integers with end >= start`, 400);

      if (end > totalLines)
        throw new ApiError(`Invalid selectedLines range in file "${file.path}": end line (${end}) exceeds total lines (${totalLines})`, 400);

      return { start, end };
    });

    // Merge overlapping or adjacent ranges to avoid duplicate snippet tags
    if (mappedLines && mappedLines.length > 1) {
      mappedLines.sort((a, b) => a.start - b.start);
      const merged: { start: number; end: number }[] = [mappedLines[0]];
      for (let i = 1; i < mappedLines.length; i++) {
        const prev = merged[merged.length - 1];
        if (mappedLines[i].start <= prev.end + 1) {
          prev.end = Math.max(prev.end, mappedLines[i].end);
        } else {
          merged.push(mappedLines[i]);
        }
      }
      mappedLines = merged;
    }

    scanFiles.push({
      filePath: file.path.trim(),
      content: file.content,
      selectedLines: mappedLines && mappedLines.length > 0 ? mappedLines : undefined,
    });
  }

  if (scanFiles.length === 0)
    throw new ApiError("All provided files are empty. At least one file with content is required.", 400);

  const userId = String(req.user?.userId);

  let projectBrief: string | undefined;
  if (projectId) {
    const parsedProjectId = parseInt(String(projectId), 10);
    if (isNaN(parsedProjectId))
      throw new ApiError("Invalid projectId format", 400);

    const project = await prisma.project.findUnique({
      where: { id: parsedProjectId },
      select: { projectBrief: true },
    });
    projectBrief = project?.projectBrief ?? undefined;
  }

  const aiResult = await analyzeLocalScan(scanFiles, userId, preferredModel, projectBrief);

  const issues = aiResult.issues.map((issue) => ({
    filePath: issue.filePath,
    lineNumber: issue.lineNumber,
    severity: issue.severity,
    category: issue.category,
    summary: issue.summary,
    codeSnippet: issue.codeSnippet,
    suggestions: [{
      summary: issue.suggestedFixSummary,
      explanation: issue.explanation,
      diffPatch: issue.diffPatch,
    }]
  }));

  res.status(201).json({
    status: "success",
    data: {
      issues,
      modelUsed: aiResult.modelUsed,
      tokensUsed: aiResult.tokensUsed,
      durationMs: aiResult.durationMs,
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
