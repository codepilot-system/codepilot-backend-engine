import prisma from "../../lib/prisma";
import { ApiError } from "../../lib/ApiError";
import { Severity } from "@prisma/client";

const DEBT_WEIGHTS: Record<Severity, number> = {
  LOW: 10,
  MEDIUM: 30,
  HIGH: 60,
  CRITICAL: 120,
};

const COMPLEXITY_WEIGHTS: Record<Severity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const calculateAndSaveAnalytics = async (
  scanId: number,
  projectId: number
) => {
  const issues = await prisma.issue.findMany({
    where: { scanId }
  });

  if (issues.length === 0) {
    throw new ApiError('No issues found for this scan', 404);
  }

  const severityDistribution = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };

  let totalDebt = 0;
  let totalComplexity = 0;

  for (const issue of issues) {
    severityDistribution[issue.severity]++;
    totalDebt += DEBT_WEIGHTS[issue.severity];
    totalComplexity += COMPLEXITY_WEIGHTS[issue.severity];
  }

  const avgComplexity = totalComplexity / issues.length;
  const technicalDebtScore = totalDebt;

  const analytics = await prisma.analytics.create({
    data: {
      scanId,
      projectId,
      avgComplexity,
      technicalDebtScore,
      severityDistribution,
    }
  });

  
  return analytics;
};

export const getAnalytics = async (
  projectId: number,
  scanId?: number,
  page: number = 1,
  limit: number = 20
) => {
  const skip = (page - 1) * limit;

  const where = {
    projectId,
    ...(scanId && { scanId }),
  };

  const [analytics, total] = await prisma.$transaction([
    prisma.analytics.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.analytics.count({ where })
  ]);

  return { analytics, total };
};
