import { createIssues, getIssuesByProject, getIssueById, updateIssueStatus, createSuggestions } from '../../../../services/issues/issues.service';
import prisma from '../../../../lib/prisma';
import { Severity, Category, IssueStatus, IssueSource } from '@prisma/client';

jest.mock('../../../../lib/prisma');

describe('Issues Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createIssues', () => {
    it('should create multiple issues successfully', async () => {
      const mockIssues = [
        {
          severity: Severity.HIGH,
          category: Category.SECURITY,
          summary: 'SQL Injection',
          explanation: 'User input not sanitized',
          filePath: 'src/auth.ts',
          codeSnippet: 'db.query("SELECT * FROM users WHERE id = " + id)',
          lineNumber: 42,
          status: IssueStatus.OPEN,
          source: IssueSource.ANALYZER,
        },
      ];

      (prisma.issue.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await createIssues(mockIssues, 1, 1);

      expect(prisma.issue.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            projectId: 1,
            scanId: 1,
            severity: Severity.HIGH,
            category: Category.SECURITY,
          }),
        ]),
      });
      expect(result).toEqual({ count: 1 });
    });

    it('should handle empty issues array', async () => {
      (prisma.issue.createMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await createIssues([], 1, 1);

      expect(prisma.issue.createMany).toHaveBeenCalledWith({
        data: [],
      });
      expect(result).toEqual({ count: 0 });
    });
  });

  describe('getIssuesByProject', () => {
    it('should retrieve issues with pagination', async () => {
      const mockIssues = [
        { id: 1, summary: 'Issue 1', severity: Severity.HIGH },
        { id: 2, summary: 'Issue 2', severity: Severity.LOW },
      ];

      (prisma.$transaction as jest.Mock).mockResolvedValue([
        mockIssues,
        2,
      ]);

      const result = await getIssuesByProject(1, {}, 1, 20);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.issues).toEqual(mockIssues);
      expect(result.total).toBe(2);
    });

    it('should apply filters correctly', async () => {
      const mockIssues = [{ id: 1, summary: 'Security issue', severity: Severity.HIGH }];

      (prisma.$transaction as jest.Mock).mockResolvedValue([mockIssues, 1]);

      const filters = {
        severity: Severity.HIGH,
        category: Category.SECURITY,
        status: IssueStatus.OPEN,
      };

      await getIssuesByProject(1, filters, 1, 20);

      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 1,
            severity: Severity.HIGH,
            category: Category.SECURITY,
            status: IssueStatus.OPEN,
          }),
        }),
      );
    });

    it('should include suggestions in response', async () => {
      const mockIssues = [
        {
          id: 1,
          summary: 'Issue 1',
          suggestions: [{ id: 1, summary: 'Fix suggestion' }],
        },
      ];

      (prisma.$transaction as jest.Mock).mockResolvedValue([mockIssues, 1]);

      const result = await getIssuesByProject(1, {}, 1, 20);

      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { suggestions: true },
        }),
      );
    });
  });

  describe('getIssueById', () => {
    it('should retrieve issue by ID with suggestions', async () => {
      const mockIssue = {
        id: 1,
        summary: 'Test issue',
        suggestions: [{ id: 1, summary: 'Suggestion' }],
      };

      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(mockIssue);

      const result = await getIssueById(1);

      expect(prisma.issue.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { suggestions: true },
      });
      expect(result).toEqual(mockIssue);
    });

    it('should return null for non-existent issue', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await getIssueById(999);

      expect(result).toBeNull();
    });
  });

  describe('updateIssueStatus', () => {
    it('should update issue status', async () => {
      const mockUpdatedIssue = {
        id: 1,
        summary: 'Test issue',
        status: IssueStatus.FIXED,
      };

      (prisma.issue.update as jest.Mock).mockResolvedValue(mockUpdatedIssue);

      const result = await updateIssueStatus(1, IssueStatus.FIXED);

      expect(prisma.issue.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: IssueStatus.FIXED },
      });
      expect(result).toEqual(mockUpdatedIssue);
    });
  });

  describe('createSuggestions', () => {
    it('should create multiple suggestions with PENDING status', async () => {
      const mockSuggestions = [
        {
          issueId: 1,
          scanId: 1,
          projectId: 1,
          summary: 'Use parameterized query',
          explanation: 'Prevents SQL injection',
          diffPatch: '- db.query("SELECT * FROM users WHERE id = " + id)\n+ db.query("SELECT * FROM users WHERE id = $1", [id])',
        },
      ];

      (prisma.suggestion.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await createSuggestions(mockSuggestions);

      expect(prisma.suggestion.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            status: 'PENDING',
          }),
        ]),
      });
      expect(result).toEqual({ count: 1 });
    });

    it('should handle empty suggestions array', async () => {
      (prisma.suggestion.createMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await createSuggestions([]);

      expect(prisma.suggestion.createMany).toHaveBeenCalledWith({
        data: [],
      });
      expect(result).toEqual({ count: 0 });
    });
  });
});
