import prisma from '../../lib/prisma';
import { runRepoScanPipeline } from '../../services/scans/scan-pipeline';
import * as scanGithub from '../../services/scans/scan-github';
import * as scanChunker from '../../services/scans/scan-chunker';
import {
  setupTestDatabase,
  seedTestDatabase,
  teardownTestDatabase,
  verifyDatabaseConnection,
} from './test-db.setup';

describe('Scan Pipeline Integration', () => {
  let dbAvailable = false;
  let testProjectId: number;

  beforeAll(async () => {
    dbAvailable = await verifyDatabaseConnection();
    if (!dbAvailable) return;

    await setupTestDatabase();
    const seeded = await seedTestDatabase('pipeline');
    testProjectId = seeded.project.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
      await teardownTestDatabase();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should mark scan failed when GitHub app is not installed', async () => {
    if (!dbAvailable) return;

    const scan = await prisma.scan.create({
      data: {
        projectId: testProjectId,
        initiatorId: (await prisma.user.findFirst())!.id,
        branchName: 'main',
        status: 'IN_PROGRESS',
      },
    });

    await prisma.project.update({
      where: { id: testProjectId },
      data: { installationId: null },
    });

    await runRepoScanPipeline(scan.id);

    const updated = await prisma.scan.findUnique({ where: { id: scan.id } });
    expect(updated?.status).toBe('FAILED');

    await prisma.project.update({
      where: { id: testProjectId },
      data: { installationId: BigInt(111) },
    });
  });

  it('should complete pipeline with mocked GitHub and AI', async () => {
    if (!dbAvailable) return;

    jest.spyOn(scanGithub, 'getLatestCommitSha').mockResolvedValue('sha123');
    jest.spyOn(scanGithub, 'fetchRepoFiles').mockResolvedValue([
      { filePath: 'index.ts', content: 'function hello() { return 1; }' },
    ]);
    jest.spyOn(scanGithub, 'fetchPackageJson').mockResolvedValue(null);
    jest.spyOn(scanChunker, 'analyzeRepoInChunks').mockResolvedValue({
      issues: [{
        filePath: 'index.ts',
        lineNumber: 1,
        severity: 'HIGH',
        category: 'SECURITY',
        summary: 'AI finding',
        explanation: 'Explanation',
        codeSnippet: 'code',
        diffPatch: '+fix',
        suggestedFixSummary: 'Fix summary',
      }],
      chunkCount: 1,
      failedChunks: 0,
      tokensUsed: 100,
      durationMs: 50,
      modelUsed: 'test-model',
    });

    const scan = await prisma.scan.create({
      data: {
        projectId: testProjectId,
        initiatorId: (await prisma.user.findFirst())!.id,
        branchName: 'main',
        status: 'IN_PROGRESS',
      },
    });

    await runRepoScanPipeline(scan.id);

    const updated = await prisma.scan.findUnique({ where: { id: scan.id } });
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.commitSha).toBe('sha123');

    const issues = await prisma.issue.findMany({ where: { scanId: scan.id } });
    expect(issues.length).toBeGreaterThan(0);

    const suggestions = await prisma.suggestion.findMany({ where: { scanId: scan.id } });
    expect(suggestions.length).toBeGreaterThan(0);

    const analytics = await prisma.analytics.findFirst({ where: { scanId: scan.id } });
    expect(analytics).not.toBeNull();
  });

  it('should handle empty repository files', async () => {
    if (!dbAvailable) return;

    jest.spyOn(scanGithub, 'getLatestCommitSha').mockResolvedValue('sha456');
    jest.spyOn(scanGithub, 'fetchRepoFiles').mockResolvedValue([]);

    const scan = await prisma.scan.create({
      data: {
        projectId: testProjectId,
        initiatorId: (await prisma.user.findFirst())!.id,
        branchName: 'main',
        status: 'IN_PROGRESS',
      },
    });

    await runRepoScanPipeline(scan.id);

    const updated = await prisma.scan.findUnique({ where: { id: scan.id } });
    expect(updated?.status).toBe('FAILED');
  });
});
