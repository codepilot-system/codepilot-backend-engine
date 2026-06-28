import prisma from '../../lib/prisma';
import { ApiError } from '../../lib/ApiError';
import { SuggestionStatus } from '@prisma/client';
import { getInstallationOctokit, ensureBranch, findOpenPrUrl, createCommit, createPullRequest, isBranchCreatedByCodePilot } from '../github/github.service';
import { fetchFileContent } from '../scans/scan-github';
import { applyPatch } from 'diff';

async function validateUserAccess(userId: number, projectId: number) {
    const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } }
    });
    if (!member) throw new ApiError('Project not found or access denied', 404);
}

function isRealDiff(patch: string): boolean {
    return patch.includes('@@') || patch.startsWith('---') || patch.startsWith('+++') || 
           patch.split('\n').some(line => line.startsWith('-') || line.startsWith('+'));
}

function extractFixedCodeFromDiff(diff: string): string | null {
    const lines = diff.split('\n');
    const fixedLines: string[] = [];
    for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
            fixedLines.push(line.slice(1));
        } else if (!line.startsWith('-') && !line.startsWith('---') && !line.startsWith('@@')) {
            fixedLines.push(line);
        }
    }
    return fixedLines.length > 0 ? fixedLines.join('\n') : null;
}

function tryApplyPatch(oldContent: string, diffPatch: string): string | false {
    if (!isRealDiff(diffPatch)) {
        return diffPatch;
    }
    
    try {
        const patched = applyPatch(oldContent, diffPatch);
        if (patched !== false) {
            return patched;
        }
    } catch (error) {
        // Fall through to extraction
    }
    
    const extracted = extractFixedCodeFromDiff(diffPatch);
    return extracted || false;
}

export const getSuggestions = async (
    userId: number,
    projectId: number,
    scanId?: number,
    issueId?: number,
    status?: SuggestionStatus,
    page: number = 1,
    limit: number = 20
) => {
    await validateUserAccess(userId, projectId);

    const skip = (page - 1) * limit;
    const where: any = { projectId };
    if (scanId) where.scanId = scanId;
    if (issueId) where.issueId = issueId;
    if (status) where.status = status;

    const [suggestions, total] = await Promise.all([
        prisma.suggestion.findMany({
            where,
            select: { id: true, projectId: true, scanId: true, issueId: true, status: true, summary: true, generatedAt: true },
            orderBy: { generatedAt: 'desc' },
            skip,
            take: limit
        }),
        prisma.suggestion.count({ where })
    ]);

    return { data: suggestions, pagination: { page, limit, total } };
};

export const getAIFixSuggestion = async (userId: number, suggestionId: number) => {
    const suggestion = await prisma.suggestion.findUnique({
        where: { id: suggestionId },
        include: { scan: { select: { modelUsed: true } } }
    });

    if (!suggestion) throw new ApiError('Suggestion not found', 404);

    const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: suggestion.projectId, userId } }
    });
    if (!member) throw new ApiError('Project not found or access denied', 404);

    return {
        id: suggestion.id,
        projectId: suggestion.projectId,
        scanId: suggestion.scanId,
        issueId: suggestion.issueId,
        status: suggestion.status,
        summary: suggestion.summary,
        explanation: suggestion.explanation,
        diffPatch: suggestion.diffPatch,
        modelUsed: suggestion.scan.modelUsed,
        generatedAt: suggestion.generatedAt
    };
};

export const applyAISuggestion = async (userId: number, suggestionId: number) => {
    const suggestion = await prisma.suggestion.findUnique({
        where: { id: suggestionId },
        include: { issue: true, scan: { include: { project: true } } }
    });

    if (!suggestion) throw new ApiError('Suggestion not found', 404);

    const { issue, scan } = suggestion;
    const { project } = scan;

    await validateUserAccess(userId, project.id);

    if (!project.installationId)
        throw new ApiError('GitHub App is not installed on this repository', 422);

    if (!scan.commitSha)
        throw new ApiError('Scan has no associated commit SHA - cannot apply patch', 422);

    const currentContent = await fetchFileContent(project.installationId, project.owner, project.repoName, issue.filePath,  scan.commitSha);
    if (currentContent === null)
        throw new ApiError(`Could not fetch file ${issue.filePath} from GitHub`, 502);

    const patchedContent = tryApplyPatch(currentContent, suggestion.diffPatch);
    if (patchedContent === false)
        throw new ApiError(`Patch could not be applied cleanly to ${issue.filePath}. `, 504);

    const octokit = await getInstallationOctokit(project.installationId);
    const desiredBranch = `codepilot/fix-${suggestionId}`;
    const prTitle = `[CodePilot] ${issue.summary}`;
    const prBody = `## CodePilot Auto-Fix

**Issue:** ${issue.summary}

**Explanation:** ${suggestion.explanation ?? issue.explanation ?? ''}

---
*Applied by CodePilot from scan \`${scan.commitSha.slice(0, 7)}\`*`;

    const existingBranchContent = await fetchFileContent(project.installationId, project.owner, project.repoName, issue.filePath, desiredBranch);
    const isOwnedByCodePilot = await isBranchCreatedByCodePilot(octokit, project.owner, project.repoName, desiredBranch);

    let branchName = desiredBranch;
    let prUrl: string | null = null;

    if (existingBranchContent === patchedContent && isOwnedByCodePilot) {
        prUrl = await findOpenPrUrl(octokit, project.owner, project.repoName, desiredBranch, scan.branchName);
        if (!prUrl) prUrl = await createPullRequest(octokit, project.owner, project.repoName, prTitle, prBody, desiredBranch, scan.branchName);
    } else {
        branchName = await ensureBranch(octokit, project.owner, project.repoName, desiredBranch, scan.commitSha);
        await createCommit(octokit, project.owner, project.repoName, branchName, scan.commitSha, { [issue.filePath]: patchedContent }, `fix(codepilot): ${issue.summary}`);
        prUrl = await createPullRequest(octokit, project.owner, project.repoName, prTitle, prBody, branchName, scan.branchName);
    }

    const [updated] = await prisma.$transaction([
        prisma.suggestion.update({
            where: { id: suggestionId },
            data: { status: SuggestionStatus.APPLIED }
        })
    ]);

    return {
        id: updated.id,
        status: updated.status,
        branchName,
        prUrl
    };
};

export const dismissAISuggestion = async (userId: number, suggestionId: number) => {
    const suggestion = await prisma.suggestion.findUnique({
        where: { id: suggestionId }
    });

    if (!suggestion) throw new ApiError('Suggestion not found', 404);
    if (suggestion.status === SuggestionStatus.DISMISSED)
        throw new ApiError('Suggestion has already been dismissed', 409);

    await validateUserAccess(userId, suggestion.projectId);

    const updated = await prisma.suggestion.update({
        where: { id: suggestionId },
        data: { status: SuggestionStatus.DISMISSED }
    });

    return { id: updated.id, status: updated.status };
};

export const bulkApplyAISuggestions = async (userId: number, suggestionIds: number[]) => {
    console.log('[bulkApplyAISuggestions] Starting with suggestionIds:', suggestionIds);
    try {
        if (!Array.isArray(suggestionIds) || suggestionIds.length === 0)
            throw new ApiError('At least one suggestion ID is required', 400);

    const suggestions = await prisma.suggestion.findMany({
        where: { id: { in: suggestionIds } },
        include: { issue: true, scan: { include: { project: true } } }
    });

    const failures: Record<number, string> = {};
    const seenIssueIds = new Set<number>();
    for (const id of suggestionIds) {
        if (!suggestions.some(s => s.id === id))
            failures[id] = 'Suggestion not found';
    }

    if (suggestions.length === 0)
        throw new ApiError('No suggestions found', 404);

    const project = suggestions[0].scan.project;
    const projectId = project.id;
    const scanId = suggestions[0].scanId;

    await validateUserAccess(userId, projectId);

    for (const sug of suggestions) {
        if (failures[sug.id]) continue;
        if (sug.projectId !== projectId)
            throw new ApiError('All suggestions must belong to the same project', 400);
        if (sug.scanId !== scanId)
            throw new ApiError('All suggestions must belong to the same scan', 400);
        if (seenIssueIds.has(sug.issueId)) {
            failures[sug.id] = `Another suggestion for this issue is already being applied`;
            continue;
        }
        seenIssueIds.add(sug.issueId);
    }

    const applicableSuggestions = suggestions.filter(s => !failures[s.id]);
    if (applicableSuggestions.length === 0)
        return { branchName: null, prUrl: null, appliedCount: 0, failures };

    const installationId = project.installationId;
    const owner = project.owner;
    const repoName = project.repoName;
    const commitSha = suggestions[0].scan.commitSha;
    const baseBranch = suggestions[0].scan.branchName;

    if (!installationId)
        throw new ApiError('GitHub App is not installed on this repository', 422);
    if (!commitSha)
        throw new ApiError('Scan has no associated commit SHA — cannot apply patches', 422);

    const fileContents: Record<string, string> = {};
    const succeededSuggestions: typeof suggestions = [];

    for (const sug of applicableSuggestions) {
        const filePath = sug.issue.filePath;
        try {
            if (!(filePath in fileContents)) {
                const content = await fetchFileContent(installationId, owner, repoName, filePath, commitSha);
                if (content === null) {
                    failures[sug.id] = `Could not fetch file ${filePath} from GitHub`;
                    continue;
                }
                fileContents[filePath] = content;
            }

            const patched = tryApplyPatch(fileContents[filePath], sug.diffPatch);
            if (patched === false) {
                failures[sug.id] = `Patch could not be applied cleanly to ${filePath}.`;
                continue;
            }
            fileContents[filePath] = patched;
            succeededSuggestions.push(sug);
        } catch (error) {
            console.error('[bulkApplyAISuggestions] Error applying suggestion', sug.id, error);
            failures[sug.id] = `Unexpected error while applying patch to ${filePath}`;
        }
    }

    if (succeededSuggestions.length === 0) {
        return { branchName: null, prUrl: null, appliedCount: 0, failures };
    }

    const desiredBranch = `codepilot/batch-fixes-${scanId}`;
    const octokit = await getInstallationOctokit(installationId);
    const prTitle = `[CodePilot] Batch Fixes for Scan ${scanId}`;
    const prBody = `## CodePilot Auto-Fixes

Applied the following fixes:
${succeededSuggestions.map(s => `- ${s.issue.summary}`).join('\n')}

---
*Applied by CodePilot from scan \`${commitSha.slice(0, 7)}\`*`;
    const commitMessage = `fix(codepilot): apply batch fixes from scan ${scanId}`;

    let branchName = desiredBranch;
    let prUrl: string | null = null;

    let isBranchApplied = true;
    for (const filePath of Object.keys(fileContents)) {
        const branchContent = await fetchFileContent(installationId, owner, repoName, filePath, desiredBranch);
        if (branchContent !== fileContents[filePath]) {
            isBranchApplied = false;
            break;
        }
    }
    const isOwnedByCodePilot = await isBranchCreatedByCodePilot(octokit, owner, repoName, desiredBranch);

    if (isBranchApplied && isOwnedByCodePilot) {
        prUrl = await findOpenPrUrl(octokit, owner, repoName, desiredBranch, baseBranch);
        if (!prUrl) prUrl = await createPullRequest(octokit, owner, repoName, prTitle, prBody, desiredBranch, baseBranch);
    } else {
        branchName = await ensureBranch(octokit, owner, repoName, desiredBranch, commitSha);
        await createCommit(octokit, owner, repoName, branchName, commitSha, fileContents, commitMessage);
        prUrl = await createPullRequest(octokit, owner, repoName, prTitle, prBody, branchName, baseBranch);
    }

    const succeededIds = succeededSuggestions.map(s => s.id);

    await prisma.$transaction([
        prisma.suggestion.updateMany({
            where: { id: { in: succeededIds } },
            data: { status: SuggestionStatus.APPLIED }
        })
    ]);

    return {
        branchName,
        prUrl,
        appliedCount: succeededIds.length,
        failures
    };
    } catch (error) {
        console.error('[bulkApplyAISuggestions] Uncaught error:', error);
        throw error;
    }
};

export const bulkDismissAISuggestions = async (userId: number, suggestionIds: number[]) => {
    if (!Array.isArray(suggestionIds) || suggestionIds.length === 0)
        throw new ApiError('At least one suggestion ID is required', 400);

    const suggestions = await prisma.suggestion.findMany({
        where: { id: { in: suggestionIds } }
    });

    const failures: Record<number, string> = {};
    for (const id of suggestionIds) {
        if (!suggestions.some(s => s.id === id))
            failures[id] = 'Suggestion not found';
    }

    if (suggestions.length === 0)
        throw new ApiError('No suggestions found', 404);

    const projectIds = Array.from(new Set(suggestions.map(s => s.projectId)));
    const memberships = await prisma.projectMember.findMany({
        where: {
            userId,
            projectId: { in: projectIds }
        }
    });

    if (memberships.length !== projectIds.length)
        throw new ApiError('Access denied to one or more projects', 403);

    const dismissibleSuggestions = suggestions.filter(s => s.status !== SuggestionStatus.DISMISSED);
    const dismissibleIds = dismissibleSuggestions.map(s => s.id);

    for (const s of suggestions) {
        if (s.status === SuggestionStatus.DISMISSED && !failures[s.id])
            failures[s.id] = 'Suggestion has already been dismissed';
    }

    if (dismissibleIds.length > 0) {
        await prisma.suggestion.updateMany({
            where: { id: { in: dismissibleIds } },
            data: { status: SuggestionStatus.DISMISSED }
        });
    }

    return {
        dismissedCount: dismissibleIds.length,
        failures
    };
};
