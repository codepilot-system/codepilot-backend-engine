import prisma from "../../lib/prisma";
import { ApiError } from '../../lib/ApiError';
import { Category, Severity, IssueStatus, SuggestionStatus } from "@prisma/client";

interface CreateIssueInput {
    severity: Severity;
    category: Category;
    summary: string;
    explanation?: string;
    filePath: string;
    codeSnippet?: string;
    lineNumber: number;
    status?: IssueStatus;
}

export const createIssues = async (issues: CreateIssueInput[], scanId: number, projectId: number) => {

    return prisma.issue.createMany({
        data: issues.map(issue => ({
            projectId,
            scanId,
            filePath: issue.filePath,
            lineNumber: issue.lineNumber,
            severity: issue.severity,
            category: issue.category,
            summary: issue.summary,
            explanation: issue.explanation,
            codeSnippet: issue.codeSnippet,
            status: issue.status ?? IssueStatus.OPEN
        }))
    })
};

export const getIssuesByProject = async (
    projectId: number,
    filters?: {
        severity?: Severity;
        category?: Category;
        status?: IssueStatus;
    },
    page: number = 1,
    limit: number = 20
) => {
    const skip = (page - 1) * limit;

    const [issues, total] = await prisma.$transaction([
        prisma.issue.findMany({
            where: {
                projectId,
                ...filters,
            },
            include: { suggestions: true },
            orderBy: { detectedAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.issue.count({
            where: {
                projectId,
                ...filters,
            }
        })
    ]);

    return { issues, total };
};

export const getIssueById = async (issueId: number) => {
    return prisma.issue.findUnique({
        where: { id: issueId },
        include: {
            suggestions: true
        }
    })
}


export const updateIssueStatus = async (
    issueId: number,
    status: IssueStatus
) => {
    return prisma.issue.update({
        where: { id: issueId },
        data: { status }
    });
};



export const createSuggestions = async (
    suggestions: {
        issueId: number;
        scanId: number;
        projectId: number;
        summary: string;
        explanation?: string;
        diffPatch: string;
    }[]
) => {
    return prisma.suggestion.createMany({
        data: suggestions.map(s => ({
            ...s,
            status: SuggestionStatus.PENDING
        }))
    });
};



export const applyPatch = async (issueId: number) => {
    const suggestion = await prisma.suggestion.findFirst({
        where: { issueId }
    });

    if (!suggestion) {
        throw new ApiError('No suggestion found for this issue', 404);
    }

    // TODO: send diffPatch to VS Code extension via WebSocket
    // This will be implemented when VS Code extension is ready

    await prisma.suggestion.update({
        where: { id: suggestion.id },
        data: { status: SuggestionStatus.APPLIED }
    });

    return updateIssueStatus(issueId, IssueStatus.FIXED);
};
