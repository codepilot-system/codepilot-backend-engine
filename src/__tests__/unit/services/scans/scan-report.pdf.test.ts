import { buildScanReportPdf } from '../../../../services/scans/scan-report.pdf';
import { Category, IssueSource, IssueStatus, ScanStatus, Severity, SuggestionStatus } from '@prisma/client';

describe('scan-report.pdf', () => {
  const mockReportData = {
    scan: {
      id: 1,
      projectId: 1,
      initiatorId: 1,
      branchName: 'main',
      commitSha: 'abc123',
      status: ScanStatus.COMPLETED,
      scanDate: new Date('2026-01-01'),
      modelUsed: 'test-model',
      tokensUsed: 1000,
      durationMs: 5000,
      project: {
        id: 1,
        name: 'testrepo',
        owner: 'testowner',
        repoName: 'testrepo',
        repoUrl: 'https://github.com/testowner/testrepo',
        provider: 'GITHUB' as const,
      },
      initiator: { username: 'testuser' },
      issues: [
        {
          id: 1,
          projectId: 1,
          scanId: 1,
          severity: Severity.HIGH,
          category: Category.SECURITY,
          summary: 'Security issue',
          explanation: 'Details',
          filePath: 'src/test.ts',
          codeSnippet: 'const x = 1;',
          lineNumber: 10,
          status: IssueStatus.OPEN,
          source: IssueSource.AI,
          complexity: null,
          createdAt: new Date(),
          suggestions: [
            {
              id: 1,
              projectId: 1,
              scanId: 1,
              issueId: 1,
              summary: 'Fix it',
              explanation: 'Apply fix',
              diffPatch: '+fix',
              status: SuggestionStatus.PENDING,
              generatedAt: new Date(),
            },
          ],
        },
      ],
    },
    analytics: {
      id: 1,
      projectId: 1,
      scanId: 1,
      technicalDebtScore: 220,
      avgComplexity: 2.5,
      severityDistribution: { LOW: 1, MEDIUM: 1, HIGH: 1, CRITICAL: 1 },
      generatedAt: new Date(),
    },
  };

  it('should generate a valid PDF buffer', async () => {
    const buffer = await buildScanReportPdf(mockReportData as any);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('should handle scan with no issues', async () => {
    const data = {
      ...mockReportData,
      scan: { ...mockReportData.scan, issues: [] },
    };
    const buffer = await buildScanReportPdf(data as any);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
