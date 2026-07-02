import { calculateAndSaveAnalytics, getAnalytics } from '../../../../services/analytics/analytics.service';
import prisma from '../../../../lib/prisma';
import { Severity } from '@prisma/client';

jest.mock('../../../../lib/prisma');

describe('Analytics Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('calculateAndSaveAnalytics', () => {
        it('should calculate analytics from issues and save to database', async () => {
            const mockIssues = [
                { severity: Severity.CRITICAL, complexity: 15 },
                { severity: Severity.HIGH, complexity: 10 },
                { severity: Severity.MEDIUM, complexity: 8 },
                { severity: Severity.LOW, complexity: 5 },
                { severity: Severity.LOW, complexity: 3 },
            ];

            (prisma.issue.findMany as jest.Mock).mockResolvedValue(mockIssues);
            (prisma.analytics.create as jest.Mock).mockResolvedValue({ id: 1 });

            await calculateAndSaveAnalytics(1, 1);

            expect(prisma.issue.findMany).toHaveBeenCalledWith({
                where: { scanId: 1 },
            });

            expect(prisma.analytics.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        scanId: 1,
                        projectId: 1,
                        technicalDebtScore: expect.any(Number),
                        avgComplexity: expect.any(Number),
                        severityDistribution: expect.any(Object),
                    }),
                }),
            );
        });

        it('should handle empty issues array', async () => {
            (prisma.issue.findMany as jest.Mock).mockResolvedValue([]);

            await expect(calculateAndSaveAnalytics(1, 1)).rejects.toThrow('No issues found for this scan');
        });

        it('should calculate correct technical debt score', async () => {
            const mockIssues = [
                { severity: Severity.CRITICAL, complexity: 20 },
                { severity: Severity.HIGH, complexity: 15 },
                { severity: Severity.MEDIUM, complexity: 10 },
                { severity: Severity.LOW, complexity: 5 },
            ];

            (prisma.issue.findMany as jest.Mock).mockResolvedValue(mockIssues);
            (prisma.analytics.create as jest.Mock).mockResolvedValue({ id: 1 });

            await calculateAndSaveAnalytics(1, 1);

            const createCall = (prisma.analytics.create as jest.Mock).mock.calls[0];
            const analyticsData = createCall[0].data;

            // CRITICAL (120) * 1 = 120
            // HIGH (60) * 1 = 60
            // MEDIUM (30) * 1 = 30
            // LOW (10) * 1 = 10
            // Total Debt = 220
            expect(analyticsData.technicalDebtScore).toBe(220);

            // Complexity Avg: (4+3+2+1) / 4 = 2.5
            expect(analyticsData.avgComplexity).toBeCloseTo(2.5, 4);
        });

        it('should calculate correct severity distribution', async () => {
            const mockIssues = [
                { severity: Severity.CRITICAL, complexity: 10 },
                { severity: Severity.HIGH, complexity: 10 },
                { severity: Severity.HIGH, complexity: 10 },
                { severity: Severity.LOW, complexity: 10 },
            ];

            (prisma.issue.findMany as jest.Mock).mockResolvedValue(mockIssues);
            (prisma.analytics.create as jest.Mock).mockResolvedValue({ id: 1 });

            await calculateAndSaveAnalytics(1, 1);

            const createCall = (prisma.analytics.create as jest.Mock).mock.calls[0];
            const analyticsData = createCall[0].data;

            expect(analyticsData.severityDistribution).toEqual({
                CRITICAL: 1,
                HIGH: 2,
                MEDIUM: 0,
                LOW: 1,
            });
        });
    });
    it('should propagate database errors', async () => {
        (prisma.issue.findMany as jest.Mock)
            .mockRejectedValue(new Error('Database failed'));

        await expect(
            calculateAndSaveAnalytics(1, 1)
        ).rejects.toThrow('Database failed');
    });

    describe('getAnalytics', () => {
        it('should retrieve analytics with pagination', async () => {
            const mockAnalytics = [
                { id: 1, technicalDebtScore: 85, avgComplexity: 12.5 },
                { id: 2, technicalDebtScore: 70, avgComplexity: 10.0 },
            ];

            (prisma.$transaction as jest.Mock).mockResolvedValue([mockAnalytics, 2]);

            const result = await getAnalytics(1, undefined, 1, 20);

            expect(prisma.$transaction).toHaveBeenCalled();
            expect(result.analytics).toEqual(mockAnalytics);
            expect(result.total).toBe(2);
        });

        it('should filter by scanId when provided', async () => {
            const mockAnalytics = [{ id: 1, scanId: 5 }];

            (prisma.$transaction as jest.Mock).mockResolvedValue([mockAnalytics, 1]);

            await getAnalytics(1, 5, 1, 20);

            expect(prisma.analytics.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        projectId: 1,
                        scanId: 5,
                    }),
                }),
            );
        });

        it('should not filter by scanId when not provided', async () => {
            const mockAnalytics = [{ id: 1 }];

            (prisma.$transaction as jest.Mock).mockResolvedValue([mockAnalytics, 1]);

            await getAnalytics(1, undefined, 1, 20);

            expect(prisma.analytics.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        projectId: 1,
                    }),
                }),
            );
        });

        it('should order by generatedAt descending', async () => {
            const mockAnalytics = [{ id: 1 }];

            (prisma.$transaction as jest.Mock).mockResolvedValue([mockAnalytics, 1]);

            await getAnalytics(1, undefined, 1, 20);

            expect(prisma.analytics.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderBy: { generatedAt: 'desc' },
                }),
            );
        });
    });
});
