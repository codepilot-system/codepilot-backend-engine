import {
  getProjectScans,
  getScanById,
  startScan,
  deleteScan,
  analyzeLocalCode,
  getScanReport,
} from '../../../../services/scans/scans.service';
import prisma from '../../../../lib/prisma';
import { ApiError } from '../../../../lib/ApiError';
import { analyzeLocalScan } from '../../../../services/ai/ai.service';
import { runRepoScanPipeline } from '../../../../services/scans/scan-pipeline';
import { analyzeFileContents } from '../../../../services/scans/analysis/analyzer';
import { buildScanReportPdf } from '../../../../services/scans/scan-report.pdf';

jest.mock('p-limit', () => {
  return jest.fn().mockImplementation(() => {
    return jest.fn().mockImplementation((fn) => fn());
  });
});

jest.mock('octokit', () => ({
  App: jest.fn().mockImplementation(() => ({
    getInstallationOctokit: jest.fn(),
    octokit: { auth: jest.fn() },
  })),
  Octokit: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
  })),
}));

jest.mock('../../../../config/env.config', () => ({
  ENV: {
    GITHUB_APP_ID: '123',
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-secret',
    GITHUB_REDIRECT_URI: 'http://localhost:3000/callback',
    GITHUB_WEBHOOK_SECRET: 'webhook-secret',
    GITHUB_PRIVATE_KEY: 'test-key',
    GITHUB_APP_BOT_LOGIN: 'test-bot[bot]',
    GROQ_API_KEY: 'test-groq-key',
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/codepilot_test',
    JWT_ACCESS_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
}));

jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  })),
}));

jest.mock('../../../../lib/prisma');
jest.mock('../../../../services/ai/ai.service', () => ({
  analyzeLocalScan: jest.fn(),
  analyzeRepoScan: jest.fn(),
  applyBulkFixes: jest.fn(),
  generateProjectSummary: jest.fn(),
  CodeFile: {},
}));
jest.mock('../../../../services/scans/scan-pipeline');
jest.mock('../../../../services/scans/analysis/analyzer');
jest.mock('../../../../services/scans/scan-report.pdf');

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Scans Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProjectScans', () => {
    it('should return scans and total count when user is member', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue({ id: 1 } as any);
      const mockScans = [{ id: 10, status: 'COMPLETED' }];
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([mockScans, 1]);

      const result = await getProjectScans(1, 1, 'COMPLETED', 2, 10);

      expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: 1, members: { some: { userId: 1 } } },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({ scans: mockScans, total: 1 });
    });

    it('should throw 404 if project not found or access denied', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(getProjectScans(1, 1)).rejects.toThrow(ApiError);
      await expect(getProjectScans(1, 1)).rejects.toThrow('Project not found or access denied');
    });
  });

  describe('getScanById', () => {
    it('should return scan if user is member of project', async () => {
      const mockScan = { id: 10, projectId: 1 };
      (mockPrisma.scan.findFirst as jest.Mock).mockResolvedValue(mockScan as any);

      const result = await getScanById(1, 10);

      expect(mockPrisma.scan.findFirst).toHaveBeenCalledWith({
        where: { id: 10, project: { members: { some: { userId: 1 } } } },
      });
      expect(result).toEqual(mockScan);
    });

    it('should throw 404 if scan not found or access denied', async () => {
      (mockPrisma.scan.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(getScanById(1, 10)).rejects.toThrow(ApiError);
    });
  });

  describe('startScan', () => {
    it('should create scan and trigger pipeline', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue({ id: 1 } as any);
      (mockPrisma.scan.create as jest.Mock).mockResolvedValue({ id: 10, projectId: 1, branchName: 'main' } as any);
      (runRepoScanPipeline as jest.Mock).mockResolvedValue(undefined);

      const result = await startScan(1, 1, 'main');

      expect(mockPrisma.scan.create).toHaveBeenCalledWith({
        data: {
          projectId: 1,
          initiatorId: 1,
          branchName: 'main',
          status: 'IN_PROGRESS',
        },
      });
      expect(runRepoScanPipeline).toHaveBeenCalledWith(10);
      expect(result).toEqual({ id: 10, projectId: 1, branchName: 'main' });
    });

    it('should throw 404 if project not found or access denied', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(startScan(1, 1, 'main')).rejects.toThrow(ApiError);
    });

    it('should handle pipeline errors without failing the request', async () => {
      (mockPrisma.project.findFirst as jest.Mock).mockResolvedValue({ id: 1 } as any);
      (mockPrisma.scan.create as jest.Mock).mockResolvedValue({ id: 10 } as any);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (runRepoScanPipeline as jest.Mock).mockRejectedValue(new Error('Pipeline failed'));

      const result = await startScan(1, 1, 'main');
      
      // We must wait a tick for the unhandled rejection to be caught
      await new Promise(process.nextTick);

      expect(result).toEqual({ id: 10 });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled error dispatching pipeline for scan 10'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('deleteScan', () => {
    it('should delete scan if user is member', async () => {
      (mockPrisma.scan.findFirst as jest.Mock).mockResolvedValue({ id: 10 } as any);
      (mockPrisma.scan.delete as jest.Mock).mockResolvedValue({} as any);

      const result = await deleteScan(1, 10);

      expect(mockPrisma.scan.delete).toHaveBeenCalledWith({ where: { id: 10 } });
      expect(result).toBe(true);
    });

    it('should throw 404 if scan not found', async () => {
      (mockPrisma.scan.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(deleteScan(1, 10)).rejects.toThrow(ApiError);
    });
  });

  describe('analyzeLocalCode', () => {
    it('should successfully analyze code and return issues', async () => {
      const files = [
        { path: 'test.ts', content: 'const a = 1;', selectedLines: [{ start: 1, end: 1 }] },
      ];
      (mockPrisma.project.findUnique as jest.Mock).mockResolvedValue({ projectBrief: 'A test project' } as any);
      (analyzeFileContents as jest.Mock).mockReturnValue([]);
      
      const mockAiResult = {
        issues: [{
          filePath: 'test.ts',
          lineNumber: 1,
          severity: 'HIGH',
          category: 'SECURITY',
          summary: 'Bad code',
          codeSnippet: 'const a = 1;',
          suggestedFixSummary: 'Fix it',
          explanation: 'Because it is bad',
          diffPatch: 'patch',
        }],
        modelUsed: 'test-model',
        tokensUsed: { prompt: 10, completion: 20, total: 30 },
        durationMs: 100,
      };
      (analyzeLocalScan as jest.Mock).mockResolvedValue(mockAiResult);

      const result = await analyzeLocalCode(1, files, '1', 'test-model');

      expect(result.modelUsed).toBe('test-model');
      expect(result.durationMs).toBe(100);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].suggestions[0].summary).toBe('Fix it');
    });

    it('should throw 400 if files array is empty', async () => {
      await expect(analyzeLocalCode(1, [])).rejects.toThrow('At least one file is required');
    });

    it('should throw 400 if a file has no path', async () => {
      await expect(analyzeLocalCode(1, [{ path: '', content: 'test' }])).rejects.toThrow('Each file must have a non-empty path');
    });

    it('should throw 400 if a file has non-string content', async () => {
      await expect(analyzeLocalCode(1, [{ path: 'test.ts', content: null as any }])).rejects.toThrow('must have string content');
    });

    it('should throw 400 if selectedLines is invalid', async () => {
      const files = [{ path: 'test.ts', content: 'test\n', selectedLines: [{ start: 2, end: 1 }] }];
      await expect(analyzeLocalCode(1, files)).rejects.toThrow('start and end must be positive integers with end >= start');
    });

    it('should throw 400 if selectedLines exceeds file lines', async () => {
      const files = [{ path: 'test.ts', content: 'test\n', selectedLines: [{ start: 1, end: 5 }] }];
      await expect(analyzeLocalCode(1, files)).rejects.toThrow('exceeds total lines');
    });

    it('should throw 400 if project id is invalid format', async () => {
      const files = [{ path: 'test.ts', content: 'test\n' }];
      await expect(analyzeLocalCode(1, files, 'not-a-number')).rejects.toThrow('Invalid projectId format');
    });

    it('should merge overlapping selectedLines', async () => {
      const files = [
        { path: 'test.ts', content: '1\n2\n3\n4\n5\n6\n', selectedLines: [{ start: 1, end: 3 }, { start: 2, end: 4 }, { start: 6, end: 6 }] },
      ];
      (analyzeFileContents as jest.Mock).mockReturnValue([]);
      (analyzeLocalScan as jest.Mock).mockResolvedValue({ issues: [] });

      await analyzeLocalCode(1, files);

      expect(analyzeLocalScan).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            selectedLines: [{ start: 1, end: 4 }, { start: 6, end: 6 }]
          })
        ]),
        "1",
        undefined,
        undefined
      );
    });

    it('should skip files with only whitespace content', async () => {
      const files = [
        { path: 'test1.ts', content: '   ' },
        { path: 'test2.ts', content: 'valid' }
      ];
      (analyzeFileContents as jest.Mock).mockReturnValue([]);
      (analyzeLocalScan as jest.Mock).mockResolvedValue({ issues: [] });

      await analyzeLocalCode(1, files);

      expect(analyzeLocalScan).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ filePath: 'test2.ts' })
        ]),
        expect.any(String),
        undefined,
        undefined
      );
    });

    it('should throw 400 if all files are empty', async () => {
      const files = [{ path: 'test1.ts', content: '   ' }];
      await expect(analyzeLocalCode(1, files)).rejects.toThrow('All provided files are empty');
    });
  });

  describe('getScanReport', () => {
    it('should generate PDF report for completed scan', async () => {
      const mockScan = {
        id: 10,
        status: 'COMPLETED',
        analytics: [{ id: 1 }],
      };
      (mockPrisma.scan.findFirst as jest.Mock).mockResolvedValue(mockScan as any);
      (buildScanReportPdf as jest.Mock).mockResolvedValue(Buffer.from('pdf data'));

      const result = await getScanReport(1, 10);

      expect(buildScanReportPdf).toHaveBeenCalledWith({ scan: mockScan, analytics: mockScan.analytics[0] });
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toBe('codepilot-scan-10-report.pdf');
    });

    it('should throw 404 if scan not found', async () => {
      (mockPrisma.scan.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(getScanReport(1, 10)).rejects.toThrow(ApiError);
    });

    it('should throw 400 if scan is not COMPLETED', async () => {
      const mockScan = { id: 10, status: 'IN_PROGRESS' };
      (mockPrisma.scan.findFirst as jest.Mock).mockResolvedValue(mockScan as any);

      await expect(getScanReport(1, 10)).rejects.toThrow('only available for completed scans');
    });

    it('should throw 500 if analytics are missing', async () => {
      const mockScan = { id: 10, status: 'COMPLETED', analytics: [] };
      (mockPrisma.scan.findFirst as jest.Mock).mockResolvedValue(mockScan as any);

      await expect(getScanReport(1, 10)).rejects.toThrow('Internal server error');
    });
  });
});
