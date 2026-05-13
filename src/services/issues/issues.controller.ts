import { Request, Response } from 'express';
import { Category, Severity, IssueStatus } from '../../generated/prisma';
import {
    getIssuesByProject,
    getIssueById as getIssueByIdService,
    updateIssueStatus,
    applyPatch
} from './issues.service';

export const getIssues = async (req: Request, res: Response) => {
    const { projectId, status, severity, category, page, limit } = req.query;

    if (!projectId) {
        return res.status(400).json({ status: "error", message: "projectId is required" });
    }

    try {
        const currentPage = parseInt(page as string) || 1;
        const currentLimit = parseInt(limit as string) || 20;

        const { issues, total } = await getIssuesByProject(
            parseInt(projectId as string),
            {
                severity: severity as Severity,
                category: category as Category,
                status: status as IssueStatus,
            },
            currentPage,
            currentLimit
        );

        return res.status(200).json({
            status: "success",
            data: issues,
            pagination: {
                page: currentPage,
                limit: currentLimit,
                total,
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Failed to fetch issues" });
    }
};


export const getIssueById = async (req: Request, res: Response) => {

    const { issueId } = req.params;

    try {
        const issue = await getIssueByIdService(parseInt(issueId));

        if (!issue) {
            return res.status(404).json({ status: "error", message: "Issue not found" });
        }

        return res.status(200).json({
            status: "success",
            data: issue,
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Failed to fetch issue" });
    }
};

export const patchIssue = async (req: Request, res: Response) => {
    const { issueId } = req.params;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ status: "error", message: "status is required" });
    }

    try {
        const updated = await updateIssueStatus(
            parseInt(issueId),
            status as IssueStatus
        );

        return res.status(200).json({
            status: "success",
            data: updated,
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Failed to update issue" });
    }
};

export const applyIssuePatch = async (req: Request, res: Response) => {
    const { issueId } = req.params;

    try {
        await applyPatch(parseInt(issueId));

        return res.status(200).json({
            status: "success",
            message: "Patch applied successfully",
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Failed to apply patch" });
    }
};
