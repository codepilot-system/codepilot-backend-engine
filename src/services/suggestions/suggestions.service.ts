import prisma from '../../lib/prisma';
import { ApiError } from '../../lib/ApiError';
import { SuggestionStatus, SuggestionsApplyStatus, SuggestionsApplyItemStatus } from '@prisma/client';
import { getInstallationOctokit, ensureBranch, findOpenPrUrl, createCommit, createPullRequest, isBranchCreatedByCodePilot } from '../github/github.service';
import { fetchFileContent } from '../scans/scan-github';
import { applyPatch } from 'diff';

const STALE_APPLY_MINUTES = 15;
const APPLY_TIMEOUT_ERROR = 'Apply job timed out';
const MATCHABLE_APPLY_STATUSES = [
  SuggestionsApplyStatus.IN_PROGRESS,
  SuggestionsApplyStatus.COMPLETED
];

type ExactApplyMatch = {
  id: number;
  status: SuggestionsApplyStatus;
  createdAt: Date;
  branchName: string | null;
  prUrl: string | null;
  suggestionItems: Array<{
    id: number;
    suggestionId: number;
  }>;
};

async function validateUserAccess(userId: number, projectId: number) {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } }
  });
  if (!member) throw new ApiError('Project not found or access denied', 404);
}

function isApplyStale(createdAt: Date): boolean {
  return createdAt.getTime() < Date.now() - STALE_APPLY_MINUTES * 60 * 1000;
}

async function isApplyStillInProgress(applyId: number): Promise<boolean> {
  const apply = await prisma.suggestionsApply.findUnique({
    where: { id: applyId },
    select: { status: true }
  });

  return apply?.status === SuggestionsApplyStatus.IN_PROGRESS;
}

async function markApplyAsTimedOut(apply: ExactApplyMatch): Promise<boolean> {
  const now = new Date();

  return prisma.$transaction(async tx => {
    const updated = await tx.suggestionsApply.updateMany({
      where: {
        id: apply.id,
        status: SuggestionsApplyStatus.IN_PROGRESS
      },
      data: {
        status: SuggestionsApplyStatus.FAILED,
        error: APPLY_TIMEOUT_ERROR,
        finishedAt: now
      }
    });

    if (updated.count === 0) {
      return false;
    }

    for (const item of apply.suggestionItems) {
      await tx.suggestionsApplyItem.updateMany({
        where: {
          id: item.id,
          status: SuggestionsApplyItemStatus.PENDING
        },
        data: {
          status: SuggestionsApplyItemStatus.FAILED,
          error: APPLY_TIMEOUT_ERROR
        }
      });
    }

    return true;
  });
}

function buildExistingApplyResponse(
  apply: Pick<ExactApplyMatch, 'id' | 'status' | 'branchName' | 'prUrl'>,
  suggestionIds: number[],
  message: string
) {
  return {
    suggestionsApplyId: apply.id,
    status: apply.status,
    message,
    suggestionIds,
    branchName: apply.branchName,
    prUrl: apply.prUrl
  };
}

async function resolveReusableExactApply(
  applies: ExactApplyMatch[],
  suggestionIds: number[],
  message: string
) {
  for (const apply of applies) {
    if (apply.status === SuggestionsApplyStatus.COMPLETED) {
      return buildExistingApplyResponse(apply, suggestionIds, message);
    }

    if (apply.status !== SuggestionsApplyStatus.IN_PROGRESS) {
      continue;
    }

    if (!isApplyStale(apply.createdAt)) {
      return buildExistingApplyResponse(apply, suggestionIds, message);
    }

    const timedOut = await markApplyAsTimedOut(apply);
    if (!timedOut) {
      const refreshedApply = await prisma.suggestionsApply.findUnique({
        where: { id: apply.id },
        select: {
          id: true,
          status: true,
          branchName: true,
          prUrl: true
        }
      });

      if (
        refreshedApply &&
        (refreshedApply.status === SuggestionsApplyStatus.COMPLETED ||
          refreshedApply.status === SuggestionsApplyStatus.IN_PROGRESS)
      ) {
        return buildExistingApplyResponse(refreshedApply, suggestionIds, message);
      }
    }
  }

  return null;
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



async function processSingleSuggestionsApply(applyId: number) {
  try {
    console.log(`[processSingleSuggestionsApply] Starting for applyId ${applyId}`);

    const apply = await prisma.suggestionsApply.findUnique({
      where: { id: applyId },
      include: {
        suggestionItems: {
          include: {
            suggestion: {
              include: {
                issue: true,
                scan: { include: { project: true } }
              }
            }
          }
        }
      }
    });

    if (!apply || apply.suggestionItems.length !== 1) {
      throw new Error('Invalid apply record');
    }

    if (apply.status !== SuggestionsApplyStatus.IN_PROGRESS) {
      console.log(`[processSingleSuggestionsApply] Skipping applyId ${applyId} because it is no longer active`);
      return;
    }

    const applyItem = apply.suggestionItems[0];
    const sug = applyItem.suggestion;
    const { issue, scan } = sug;
    const { project } = scan;

    if (!project.installationId) throw new Error('GitHub App is not installed');
    if (!scan.commitSha) throw new Error('No commit SHA');

    const currentContent = await fetchFileContent(project.installationId, project.owner, project.repoName, issue.filePath, scan.commitSha);
    if (currentContent === null) throw new Error(`Could not fetch file ${issue.filePath}`);

    const patchedContent = tryApplyPatch(currentContent, sug.diffPatch);
    if (patchedContent === false) throw new Error(`Patch could not be applied to ${issue.filePath}`);

    if (!(await isApplyStillInProgress(applyId))) {
      console.log(`[processSingleSuggestionsApply] Stopping applyId ${applyId} before GitHub write because it is no longer active`);
      return;
    }

    const octokit = await getInstallationOctokit(project.installationId);
    const desiredBranch = `codepilot/apply-suggestion-${sug.id}`;
    const prTitle = `[CodePilot] ${issue.summary}`;
    const prBody = `## CodePilot Auto-Fix

**Issue**: ${issue.summary}

**Explanation**: ${sug.explanation ?? issue.explanation ?? ''}

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

    const now = new Date();
    const finalized = await prisma.$transaction(async tx => {
      const activeApply = await tx.suggestionsApply.count({
        where: {
          id: applyId,
          status: SuggestionsApplyStatus.IN_PROGRESS
        }
      });

      if (activeApply === 0) {
        return false;
      }

      await tx.suggestion.update({
        where: { id: sug.id },
        data: { status: SuggestionStatus.APPLIED }
      });

      await tx.suggestionsApplyItem.update({
        where: { id: applyItem.id },
        data: {
          status: SuggestionsApplyItemStatus.APPLIED
        }
      });

      await tx.suggestionsApply.update({
        where: { id: applyId },
        data: {
          status: SuggestionsApplyStatus.COMPLETED,
          branchName,
          prUrl,
          finishedAt: now
        }
      });

      return true;
    });

    if (!finalized) {
      console.log(`[processSingleSuggestionsApply] Skipping final write for applyId ${applyId} because it is no longer active`);
      return;
    }

    console.log(`[processSingleSuggestionsApply] Completed for applyId ${applyId}`);
  } catch (error) {
    console.error(`[processSingleSuggestionsApply] Failed for applyId ${applyId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const now = new Date();

    const apply = await prisma.suggestionsApply.findUnique({
      where: { id: applyId },
      include: { suggestionItems: true }
    });

    if (apply && apply.status === SuggestionsApplyStatus.IN_PROGRESS && apply.suggestionItems.length > 0) {
      await prisma.$transaction(async tx => {
        const activeApply = await tx.suggestionsApply.count({
          where: {
            id: applyId,
            status: SuggestionsApplyStatus.IN_PROGRESS
          }
        });

        if (activeApply === 0) {
          return;
        }

        await tx.suggestionsApplyItem.update({
          where: { id: apply.suggestionItems[0].id },
          data: {
            status: SuggestionsApplyItemStatus.FAILED,
            error: errorMessage
          }
        });

        await tx.suggestionsApply.update({
          where: { id: applyId },
          data: {
            status: SuggestionsApplyStatus.FAILED,
            error: errorMessage,
            finishedAt: now
          }
        });
      });
    } else {
      console.log(`[processSingleSuggestionsApply] Skipping failure write for applyId ${applyId} because it is no longer active`);
    }
  }
}

async function processBulkSuggestionsApply(applyId: number) {
  try {
    console.log(`[processBulkSuggestionsApply] Starting for applyId ${applyId}`);

    const apply = await prisma.suggestionsApply.findUnique({
      where: { id: applyId },
      include: {
        suggestionItems: {
          include: {
            suggestion: {
              include: {
                issue: true,
                scan: { include: { project: true } }
              }
            }
          }
        }
      }
    });

    if (!apply || apply.suggestionItems.length === 0) throw new Error('Invalid apply record');

    if (apply.status !== SuggestionsApplyStatus.IN_PROGRESS) {
      console.log(`[processBulkSuggestionsApply] Skipping applyId ${applyId} because it is no longer active`);
      return;
    }

    const applyItems = apply.suggestionItems;
    const suggestions = applyItems.map(item => item.suggestion);
    const project = suggestions[0].scan.project;
    const scanId = suggestions[0].scanId;
    const installationId = project.installationId;
    const owner = project.owner;
    const repoName = project.repoName;
    const commitSha = suggestions[0].scan.commitSha;
    const baseBranch = suggestions[0].scan.branchName;

    if (!installationId) throw new Error('GitHub App is not installed');
    if (!commitSha) throw new Error('No commit SHA');

    const fileContents: Record<string, string> = {};
    const succeededApplyItems: typeof applyItems = [];
    const failedApplyItems: Array<{ item: typeof applyItems[0]; error: string }> = [];

    for (const applyItem of applyItems) {
      const sug = applyItem.suggestion;
      const filePath = sug.issue.filePath;
      try {
        if (!(filePath in fileContents)) {
          const content = await fetchFileContent(installationId, owner, repoName, filePath, commitSha);
          if (content === null) {
            failedApplyItems.push({ item: applyItem, error: `Could not fetch file ${filePath} from GitHub` });
            continue;
          }
          fileContents[filePath] = content;
        }

        const patched = tryApplyPatch(fileContents[filePath], sug.diffPatch);
        if (patched === false) {
          failedApplyItems.push({ item: applyItem, error: `Patch could not be applied cleanly to ${filePath}` });
          continue;
        }
        fileContents[filePath] = patched;
        succeededApplyItems.push(applyItem);
      } catch (error) {
        console.error('[processBulkSuggestionsApply] Error applying suggestion', sug.id, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        failedApplyItems.push({ item: applyItem, error: `Unexpected error while applying patch to ${filePath}: ${errorMessage}` });
      }
    }

    let branchName: string | undefined;
    let prUrl: string | null = null;
    let finalStatus: SuggestionsApplyStatus;
    const now = new Date();

    if (succeededApplyItems.length === 0) {
      finalStatus = SuggestionsApplyStatus.FAILED;
    } else {
      if (!(await isApplyStillInProgress(applyId))) {
        console.log(`[processBulkSuggestionsApply] Stopping applyId ${applyId} before GitHub write because it is no longer active`);
        return;
      }

      const desiredBranch = `codepilot/fixes-from-scan-${scanId}`;
      const octokit = await getInstallationOctokit(installationId);
      const succeededSuggestions = succeededApplyItems.map(item => item.suggestion);
      const prTitle = `[CodePilot] Batch Fixes for Scan ${scanId}`;
      const prBody = `## CodePilot Auto-Fixes

Applied the following fixes:
${succeededSuggestions.map(s => `- ${s.issue.summary}`).join('\n')}

---
*Applied by CodePilot from scan \`${commitSha.slice(0, 7)}\`*`;
      const commitMessage = `fix(codepilot): apply batch fixes from scan ${scanId}`;

      branchName = await ensureBranch(octokit, owner, repoName, desiredBranch, commitSha);
      await createCommit(octokit, owner, repoName, branchName, commitSha, fileContents, commitMessage);
      prUrl = await createPullRequest(octokit, owner, repoName, prTitle, prBody, branchName, baseBranch);
      finalStatus = succeededApplyItems.length === applyItems.length ? SuggestionsApplyStatus.COMPLETED : SuggestionsApplyStatus.PARTIAL;
    }

    const succeededIds = succeededApplyItems.map(item => item.suggestion.id);

    const finalized = await prisma.$transaction(async tx => {
      const activeApply = await tx.suggestionsApply.count({
        where: {
          id: applyId,
          status: SuggestionsApplyStatus.IN_PROGRESS
        }
      });

      if (activeApply === 0) {
        return false;
      }

      if (succeededIds.length > 0) {
        await tx.suggestion.updateMany({
          where: { id: { in: succeededIds } },
          data: { status: SuggestionStatus.APPLIED }
        });
      }

      for (const item of succeededApplyItems) {
        await tx.suggestionsApplyItem.update({
          where: { id: item.id },
          data: {
            status: SuggestionsApplyItemStatus.APPLIED
          }
        });
      }

      for (const { item, error } of failedApplyItems) {
        await tx.suggestionsApplyItem.update({
          where: { id: item.id },
          data: {
            status: SuggestionsApplyItemStatus.FAILED,
            error
          }
        });
      }

      await tx.suggestionsApply.update({
        where: { id: applyId },
        data: {
          status: finalStatus,
          branchName,
          prUrl,
          error: finalStatus === SuggestionsApplyStatus.FAILED ? 'No suggestions could be applied successfully' : null,
          finishedAt: now
        }
      });

      return true;
    });

    if (!finalized) {
      console.log(`[processBulkSuggestionsApply] Skipping final write for applyId ${applyId} because it is no longer active`);
      return;
    }

    console.log(`[processBulkSuggestionsApply] Completed for applyId ${applyId}`);
  } catch (error) {
    console.error(`[processBulkSuggestionsApply] Failed for applyId ${applyId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const now = new Date();

    const apply = await prisma.suggestionsApply.findUnique({
      where: { id: applyId },
      include: { suggestionItems: true }
    });

    if (apply && apply.status === SuggestionsApplyStatus.IN_PROGRESS) {
      await prisma.$transaction(async tx => {
        const activeApply = await tx.suggestionsApply.count({
          where: {
            id: applyId,
            status: SuggestionsApplyStatus.IN_PROGRESS
          }
        });

        if (activeApply === 0) {
          return;
        }

        for (const item of apply.suggestionItems) {
          await tx.suggestionsApplyItem.update({
            where: { id: item.id },
            data: {
              status: SuggestionsApplyItemStatus.FAILED,
              error: errorMessage
            }
          });
        }

        await tx.suggestionsApply.update({
          where: { id: applyId },
          data: {
            status: SuggestionsApplyStatus.FAILED,
            error: errorMessage,
            finishedAt: now
          }
        });
      });
    } else {
      console.log(`[processBulkSuggestionsApply] Skipping failure write for applyId ${applyId} because it is no longer active`);
    }
  }
}

export const cleanupStaleApplies = async () => {
  const cutoff = new Date(Date.now() - STALE_APPLY_MINUTES * 60 * 1000);

  const staleApplies = await prisma.suggestionsApply.findMany({
    where: {
      status: SuggestionsApplyStatus.IN_PROGRESS,
      createdAt: { lt: cutoff }
    },
    include: { suggestionItems: true }
  });

  if (staleApplies.length === 0) return;

  console.log(`[cleanupStaleApplies] Found ${staleApplies.length} stale applies`);

  for (const apply of staleApplies) {
    await markApplyAsTimedOut(apply);
  }
};

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
  await validateUserAccess(userId, suggestion.scan.project.id);

  // Check if there's an existing apply with exactly this suggestion
  const existingApplies = await prisma.suggestionsApply.findMany({
    where: {
      projectId: suggestion.projectId,
      scanId: suggestion.scanId,
      status: { in: MATCHABLE_APPLY_STATUSES },
      suggestionItems: {
        every: { suggestionId }
      }
    },
    include: {
      suggestionItems: true
    },
    orderBy: { createdAt: 'desc' }
  });

  const exactSingleApplies = existingApplies.filter(apply => apply.suggestionItems.length === 1);
  const reusableSingleApply = await resolveReusableExactApply(
    exactSingleApplies,
    [suggestionId],
    'Found existing apply for this suggestion'
  );

  if (reusableSingleApply) {
    return reusableSingleApply;
  }

  if (!suggestion.scan.project.installationId)
    throw new ApiError('GitHub App is not installed on this repository', 422);
  if (!suggestion.scan.commitSha)
    throw new ApiError('Scan has no associated commit SHA - cannot apply patch', 422);

  const suggestionsApply = await prisma.suggestionsApply.create({
    data: {
      projectId: suggestion.projectId,
      scanId: suggestion.scanId,
      userId,
      status: SuggestionsApplyStatus.IN_PROGRESS,
      suggestionItems: {
        create: { suggestionId }
      }
    }
  });

  // Fire and forget
  processSingleSuggestionsApply(suggestionsApply.id);

  return {
    suggestionsApplyId: suggestionsApply.id,
    status: SuggestionsApplyStatus.IN_PROGRESS,
    message: 'Apply job started successfully',
    suggestionIds: [suggestionId],
    branchName: null,
    prUrl: null
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
      const sug = suggestions.find(s => s.id === id);
      if (!sug) {
        failures[id] = 'Suggestion not found';
        continue;
      }
      if (seenIssueIds.has(sug.issueId)) {
        failures[id] = 'Another suggestion for this issue is already being applied';
        continue;
      }
      seenIssueIds.add(sug.issueId);
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
    }

    const applicableSuggestions = suggestions.filter(s => !failures[s.id]);
    if (applicableSuggestions.length === 0)
      return { suggestionsApplyId: null, failures, message: 'No applicable suggestions', suggestionIds: [] };

    // Check if there's an existing apply with exactly the same set of suggestions
    const sortedApplicableIds = applicableSuggestions.map(s => s.id).sort((a, b) => a - b);
    const existingApplies = await prisma.suggestionsApply.findMany({
      where: {
        projectId,
        scanId,
        status: { in: MATCHABLE_APPLY_STATUSES },
        suggestionItems: {
          every: { suggestionId: { in: sortedApplicableIds } }
        }
      },
      include: {
        suggestionItems: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const exactApplies: ExactApplyMatch[] = [];
    for (const apply of existingApplies) {
      const applySuggestionIds = apply.suggestionItems.map(item => item.suggestionId).sort((a, b) => a - b);
      if (JSON.stringify(applySuggestionIds) === JSON.stringify(sortedApplicableIds)) {
        exactApplies.push(apply);
      }
    }

    const reusableBulkApply = await resolveReusableExactApply(
      exactApplies,
      applicableSuggestions.map(s => s.id),
      'Found existing apply for this set of suggestions'
    );

    if (reusableBulkApply) {
      return {
        ...reusableBulkApply,
        failures
      };
    }

    if (!project.installationId)
      throw new ApiError('GitHub App is not installed on this repository', 422);
    if (!suggestions[0].scan.commitSha)
      throw new ApiError('Scan has no associated commit SHA - cannot apply patches', 422);

    const suggestionsApply = await prisma.suggestionsApply.create({
      data: {
        projectId,
        scanId,
        userId,
        status: SuggestionsApplyStatus.IN_PROGRESS,
        suggestionItems: {
          create: applicableSuggestions.map(s => ({ suggestionId: s.id }))
        }
      }
    });

    // Fire and forget
    processBulkSuggestionsApply(suggestionsApply.id);

    return {
      suggestionsApplyId: suggestionsApply.id,
      status: SuggestionsApplyStatus.IN_PROGRESS,
      message: 'Bulk apply job started successfully',
      suggestionIds: applicableSuggestions.map(s => s.id),
      branchName: null,
      prUrl: null,
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

export const getSuggestionsApplies = async (
  userId: number,
  projectId: number,
  scanId?: number,
  page: number = 1,
  limit: number = 20
) => {
  await validateUserAccess(userId, projectId);

  const skip = (page - 1) * limit;
  const where: any = { projectId };
  if (scanId) where.scanId = scanId;

  const [applies, total] = await Promise.all([
    prisma.suggestionsApply.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
        suggestionItems: {
          include: {
            suggestion: {
              select: { id: true, summary: true, issueId: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.suggestionsApply.count({ where })
  ]);

  const mappedApplies = applies.map(apply => {
    const { suggestionItems, ...rest } = apply;
    return {
      ...rest,
      suggestions: suggestionItems.map(item => ({
        id: item.id,
        suggestionsApplyId: item.suggestionsApplyId,
        suggestionId: item.suggestionId,
        status: item.status,
        error: item.error,
        suggestion: item.suggestion
      }))
    };
  });

  return { data: mappedApplies, pagination: { page, limit, total } };
};

export const getSuggestionsApplyById = async (userId: number, applyId: number) => {
  const apply = await prisma.suggestionsApply.findUnique({
    where: { id: applyId },
    include: {
      user: { select: { id: true, username: true, avatarUrl: true } },
      suggestionItems: {
        include: { suggestion: true }
      }
    }
  });

  if (!apply) throw new ApiError('Suggestions apply not found', 404);

  await validateUserAccess(userId, apply.projectId);

  const { suggestionItems, ...rest } = apply;
  return {
    ...rest,
    suggestions: suggestionItems.map(item => ({
      id: item.id,
      suggestionsApplyId: item.suggestionsApplyId,
      suggestionId: item.suggestionId,
      status: item.status,
      error: item.error,
      suggestion: item.suggestion
    }))
  };
};
