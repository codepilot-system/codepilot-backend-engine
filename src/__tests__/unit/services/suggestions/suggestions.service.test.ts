import {
  cleanupStaleApplies,
  getSuggestions,
  getAIFixSuggestion,
  applyAISuggestion,
  dismissAISuggestion,
  bulkApplyAISuggestions,
  bulkDismissAISuggestions,
  getSuggestionsApplies,
  getSuggestionsApplyById
} from '../../../../services/suggestions/suggestions.service';

import prisma from '../../../../lib/prisma';
import { ApiError } from '../../../../lib/ApiError';
import { SuggestionStatus, SuggestionsApplyStatus, SuggestionsApplyItemStatus } from '@prisma/client';

jest.mock('../../../../lib/prisma');

jest.mock('../../../../config/env.config', () => ({
  default: {
    GITHUB_APP_ID: '123'
  }
}));

jest.mock('../../../../services/github/github.service', () => ({
  getInstallationOctokit: jest.fn(),
  ensureBranch: jest.fn(),
  createCommit: jest.fn(),
  findOpenPrUrl: jest.fn(),
  createPullRequest: jest.fn(),
  isBranchCreatedByCodePilot: jest.fn()
}));

jest.mock('../../../../services/scans/scan-github', () => ({
  fetchFileContent: jest.fn()
}));

jest.mock('../../../../services/ai/ai.service', () => ({
  applyBulkFixes: jest.fn()
}));

jest.mock('diff', () => ({
  applyPatch: jest.fn()
}));

describe('Suggestions Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cleanupStaleApplies', () => {
    it('should find stale applies and mark them as timed out', async () => {
      const mockStaleApplies = [
        {
          id: 1,
          status: SuggestionsApplyStatus.IN_PROGRESS,
          suggestionItems: [{ id: 10, suggestionId: 100 }]
        }
      ];

      (prisma.suggestionsApply.findMany as jest.Mock).mockResolvedValue(mockStaleApplies);
      (prisma.suggestionsApply.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await cleanupStaleApplies();

      expect(prisma.suggestionsApply.findMany).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.suggestionsApply.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: SuggestionsApplyStatus.IN_PROGRESS },
        data: expect.objectContaining({ status: SuggestionsApplyStatus.FAILED })
      });
      expect(prisma.suggestionsApplyItem.updateMany).toHaveBeenCalledWith({
        where: { id: 10, status: SuggestionsApplyItemStatus.PENDING },
        data: expect.objectContaining({ status: SuggestionsApplyItemStatus.FAILED })
      });
    });

    it('should do nothing if no stale applies found', async () => {
      (prisma.suggestionsApply.findMany as jest.Mock).mockResolvedValue([]);
      await cleanupStaleApplies();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getSuggestions', () => {
    it('should throw if user has no access', async () => {
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(getSuggestions(1, 1)).rejects.toThrow(ApiError);
    });

    it('should return suggestions and pagination data', async () => {
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      const mockData = [{ id: 1, summary: 'Test' }];
      (prisma.suggestion.findMany as jest.Mock).mockResolvedValue(mockData);
      (prisma.suggestion.count as jest.Mock).mockResolvedValue(1);

      const result = await getSuggestions(1, 1, 10, 20, SuggestionStatus.PENDING, 2, 5);

      expect(prisma.suggestion.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId: 1, scanId: 10, issueId: 20, status: SuggestionStatus.PENDING },
        skip: 5,
        take: 5
      }));
      expect(result).toEqual({ data: mockData, pagination: { page: 2, limit: 5, total: 1 } });
    });
  });

  describe('getAIFixSuggestion', () => {
    it('should throw if suggestion not found', async () => {
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(getAIFixSuggestion(1, 1)).rejects.toThrow(ApiError);
    });

    it('should throw if user has no access', async () => {
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue({ id: 1, projectId: 1, scan: { modelUsed: 'gpt-4' } });
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(getAIFixSuggestion(1, 1)).rejects.toThrow(ApiError);
    });

    it('should return suggestion data', async () => {
      const mockSuggestion = { id: 1, projectId: 1, scanId: 2, issueId: 3, status: SuggestionStatus.PENDING, summary: 'Sum', explanation: 'Exp', diffPatch: 'patch', scan: { modelUsed: 'gpt-4' }, generatedAt: new Date() };
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue(mockSuggestion);
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });

      const result = await getAIFixSuggestion(1, 1);
      expect(result.id).toEqual(1);
      expect(result.modelUsed).toEqual('gpt-4');
    });
  });

  describe('applyAISuggestion', () => {
    it('should throw if suggestion not found', async () => {
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(applyAISuggestion(1, 1)).rejects.toThrow(ApiError);
    });

    it('should throw if github app not installed', async () => {
      const mockSuggestion = { projectId: 1, scanId: 2, issue: {}, scan: { project: { id: 1, installationId: null } } };
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue(mockSuggestion);
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.suggestionsApply.findMany as jest.Mock).mockResolvedValue([]);

      await expect(applyAISuggestion(1, 1)).rejects.toThrow(/GitHub App is not installed/);
    });

    it('should reuse existing apply if found', async () => {
      const mockSuggestion = { id: 1, projectId: 1, scanId: 2, issue: {}, scan: { project: { id: 1, installationId: 123 }, commitSha: 'sha' } };
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue(mockSuggestion);
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      
      const mockExistingApply = {
        id: 99, status: SuggestionsApplyStatus.COMPLETED, branchName: 'b', prUrl: 'url', createdAt: new Date(),
        suggestionItems: [{ suggestionId: 1 }]
      };
      (prisma.suggestionsApply.findMany as jest.Mock).mockResolvedValue([mockExistingApply]);

      const result = await applyAISuggestion(1, 1);
      expect(result.suggestionsApplyId).toEqual(99);
      expect(result.status).toEqual(SuggestionsApplyStatus.COMPLETED);
    });

    it('should create new apply and return in progress', async () => {
      const mockSuggestion = { id: 1, projectId: 1, scanId: 2, issue: {}, scan: { project: { id: 1, installationId: 123 }, commitSha: 'sha' } };
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue(mockSuggestion);
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.suggestionsApply.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.suggestionsApply.create as jest.Mock).mockResolvedValue({ id: 100 });
      // Mock for the background job to prevent it from crashing or doing much
      (prisma.suggestionsApply.findUnique as jest.Mock).mockResolvedValueOnce(mockSuggestion).mockResolvedValueOnce(null);

      const result = await applyAISuggestion(1, 1);
      expect(prisma.suggestionsApply.create).toHaveBeenCalled();
      expect(result.suggestionsApplyId).toEqual(100);
      expect(result.status).toEqual(SuggestionsApplyStatus.IN_PROGRESS);
    });
  });

  describe('dismissAISuggestion', () => {
    it('should throw if suggestion not found', async () => {
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(dismissAISuggestion(1, 1)).rejects.toThrow(ApiError);
    });

    it('should throw if already dismissed', async () => {
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue({ id: 1, projectId: 1, status: SuggestionStatus.DISMISSED });
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      await expect(dismissAISuggestion(1, 1)).rejects.toThrow(/already been dismissed/);
    });

    it('should dismiss suggestion successfully', async () => {
      (prisma.suggestion.findUnique as jest.Mock).mockResolvedValue({ id: 1, projectId: 1, status: SuggestionStatus.PENDING });
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.suggestion.update as jest.Mock).mockResolvedValue({ id: 1, status: SuggestionStatus.DISMISSED });

      const result = await dismissAISuggestion(1, 1);
      expect(result.status).toEqual(SuggestionStatus.DISMISSED);
      expect(prisma.suggestion.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: SuggestionStatus.DISMISSED }
      });
    });
  });

  describe('bulkApplyAISuggestions', () => {
    it('should throw if array is empty', async () => {
      await expect(bulkApplyAISuggestions(1, [])).rejects.toThrow(ApiError);
    });

    it('should handle failures like not found or duplicate issue', async () => {
      const mockSuggestions = [
        { id: 1, issueId: 10, projectId: 1, scanId: 2, scan: { project: { id: 1, installationId: 123 }, commitSha: 'sha' } },
        { id: 2, issueId: 10, projectId: 1, scanId: 2, scan: { project: { id: 1, installationId: 123 }, commitSha: 'sha' } }
      ];
      (prisma.suggestion.findMany as jest.Mock).mockResolvedValue(mockSuggestions);
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.suggestionsApply.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.suggestionsApply.create as jest.Mock).mockResolvedValue({ id: 200 });
      (prisma.suggestionsApply.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await bulkApplyAISuggestions(1, [1, 2, 3]);
      expect(result.failures[3]).toEqual('Suggestion not found');
      expect(result.failures[2]).toEqual('Only one suggestion per issue can be included in a bulk apply');
      expect(result.suggestionIds).toEqual([1]);
    });

    it('should reuse existing bulk apply', async () => {
      const mockSuggestions = [
        { id: 1, issueId: 10, projectId: 1, scanId: 2, scan: { project: { id: 1, installationId: 123 }, commitSha: 'sha' } }
      ];
      (prisma.suggestion.findMany as jest.Mock).mockResolvedValue(mockSuggestions);
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      const mockExistingApply = {
        id: 99, status: SuggestionsApplyStatus.COMPLETED, branchName: 'b', prUrl: 'url', createdAt: new Date(),
        suggestionItems: [{ suggestionId: 1 }]
      };
      (prisma.suggestionsApply.findMany as jest.Mock).mockResolvedValue([mockExistingApply]);

      const result = await bulkApplyAISuggestions(1, [1]);
      expect(result.suggestionsApplyId).toEqual(99);
    });
  });

  describe('bulkDismissAISuggestions', () => {
    it('should throw if array is empty', async () => {
      await expect(bulkDismissAISuggestions(1, [])).rejects.toThrow(ApiError);
    });

    it('should handle multiple suggestions and partial failures', async () => {
      const mockSuggestions = [
        { id: 1, projectId: 1, status: SuggestionStatus.PENDING },
        { id: 2, projectId: 1, status: SuggestionStatus.DISMISSED }
      ];
      (prisma.suggestion.findMany as jest.Mock).mockResolvedValue(mockSuggestions);
      (prisma.projectMember.findMany as jest.Mock).mockResolvedValue([{ id: 1 }]);
      (prisma.suggestion.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await bulkDismissAISuggestions(1, [1, 2, 3]);
      expect(result.failures[3]).toEqual('Suggestion not found');
      expect(result.failures[2]).toEqual('Suggestion has already been dismissed');
      expect(result.dismissedCount).toEqual(1);
      expect(prisma.suggestion.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: { status: SuggestionStatus.DISMISSED }
      });
    });

    it('should throw if missing access to a project', async () => {
      const mockSuggestions = [
        { id: 1, projectId: 1, status: SuggestionStatus.PENDING },
        { id: 2, projectId: 2, status: SuggestionStatus.PENDING }
      ];
      (prisma.suggestion.findMany as jest.Mock).mockResolvedValue(mockSuggestions);
      (prisma.projectMember.findMany as jest.Mock).mockResolvedValue([{ id: 1 }]); // Only has access to one

      await expect(bulkDismissAISuggestions(1, [1, 2])).rejects.toThrow(/Access denied/);
    });
  });

  describe('getSuggestionsApplies', () => {
    it('should throw if user lacks access', async () => {
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(getSuggestionsApplies(1, 1)).rejects.toThrow(ApiError);
    });

    it('should return applies and pagination', async () => {
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      const mockData = [{ id: 1, suggestionItems: [{ id: 10, suggestionId: 100 }] }];
      (prisma.suggestionsApply.findMany as jest.Mock).mockResolvedValue(mockData);
      (prisma.suggestionsApply.count as jest.Mock).mockResolvedValue(1);

      const result = await getSuggestionsApplies(1, 1, 10, 2, 5);
      expect(prisma.suggestionsApply.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId: 1, scanId: 10 },
        skip: 5,
        take: 5
      }));
      expect(result.data[0].suggestions[0].id).toEqual(10);
      expect(result.pagination.total).toEqual(1);
    });
  });

  describe('getSuggestionsApplyById', () => {
    it('should throw if not found', async () => {
      (prisma.suggestionsApply.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(getSuggestionsApplyById(1, 1)).rejects.toThrow(ApiError);
    });

    it('should return mapped apply object', async () => {
      const mockData = { id: 1, projectId: 1, suggestionItems: [{ id: 10, suggestionId: 100 }] };
      (prisma.suggestionsApply.findUnique as jest.Mock).mockResolvedValue(mockData);
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({ id: 1 });

      const result = await getSuggestionsApplyById(1, 1);
      expect(result.id).toEqual(1);
      expect(result.suggestions[0].id).toEqual(10);
    });
  });
});
