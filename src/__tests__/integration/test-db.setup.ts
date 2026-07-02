import prisma from '../../lib/prisma';

export function getPrisma() {
    return prisma;
}

async function cleanDatabase() {
    await prisma.suggestionsApplyItem.deleteMany();
    await prisma.suggestionsApply.deleteMany();
    await prisma.suggestion.deleteMany();
    await prisma.issue.deleteMany();
    await prisma.analytics.deleteMany();
    await prisma.scan.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.project.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
}

export async function setupTestDatabase() {
    await cleanDatabase();
}

export async function seedTestDatabase(suffix = '') {
    const unique = suffix ? `${suffix}_${Date.now()}` : `${Date.now()}`;
    const numericSuffix = Number(String(Date.now()).slice(-6));

    const githubId = BigInt(12345 + numericSuffix + Math.floor(Math.random() * 10000));
    const githubRepoId = BigInt(67890 + numericSuffix + Math.floor(Math.random() * 10000));

    const user = await prisma.user.create({
        data: {
            githubId,
            username: `testuser_${unique}`,
            email: `test_${unique}@example.com`,
            avatarUrl: 'https://example.com/avatar.png',
            githubAccessToken: 'encrypted-test-token',
        },
    });

    const project = await prisma.project.create({
        data: {
            provider: 'GITHUB',
            githubRepoId,
            owner: 'testowner',
            repoName: `testrepo_${unique}`,
            repoUrl: `https://github.com/testowner/testrepo_${unique}`,
            name: `testrepo_${unique}`,
            installationId: BigInt(111),
            projectBrief: 'Test project brief',
            members: {
                create: {
                    userId: user.id,
                    role: 'ADMIN',
                },
            },
        },
    });

    const scan = await prisma.scan.create({
        data: {
            projectId: project.id,
            initiatorId: user.id,
            branchName: 'main',
            commitSha: 'abc123def456',
            status: 'COMPLETED',
            scanDate: new Date(),
            modelUsed: 'test-model',
            tokensUsed: 1000,
            durationMs: 5000,
        },
    });

    const issue = await prisma.issue.create({
        data: {
            projectId: project.id,
            scanId: scan.id,
            severity: 'HIGH',
            category: 'SECURITY',
            summary: 'Test security issue',
            explanation: 'This is a test security issue',
            filePath: 'src/test.ts',
            codeSnippet: 'const x = 1;',
            lineNumber: 10,
            status: 'OPEN',
            source: 'AI',
        },
    });

    const suggestion = await prisma.suggestion.create({
        data: {
            projectId: project.id,
            scanId: scan.id,
            issueId: issue.id,
            summary: 'Fix the security issue',
            explanation: 'Use parameterized query',
            diffPatch: '- const x = 1;\n+ const x = 2;',
            status: 'PENDING',
        },
    });

    await prisma.analytics.create({
        data: {
            projectId: project.id,
            scanId: scan.id,
            technicalDebtScore: 75,
            avgComplexity: 10,
            severityDistribution: {
                LOW: 2,
                MEDIUM: 3,
                HIGH: 4,
                CRITICAL: 1,
            },
        },
    });

    return { user, project, scan, issue, suggestion };
}

export async function teardownTestDatabase() {
    await cleanDatabase();
}

export async function verifyDatabaseConnection(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch {
        return false;
    }
}
