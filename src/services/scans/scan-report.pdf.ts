import PDFDocument from 'pdfkit';
import {
    Analytics,
    Category,
    Issue,
    IssueSource,
    Project,
    Scan,
    Severity,
    Suggestion,
    SuggestionStatus,
    User,
} from '@prisma/client';

const MAX_TEXT_LENGTH = 500;
const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const ALL_CATEGORIES: Category[] = [
    'CODE_SMELL',
    'DEAD_CODE',
    'DUPLICATE',
    'COMPLEXITY',
    'SRP_VIOLATION',
    'SECURITY',
    'PERFORMANCE',
    'FUNCTIONALITY',
    'OTHER',
];

type ScanReportData = {
    scan: Scan & {
        project: Pick<Project, 'id' | 'name' | 'owner' | 'repoName' | 'repoUrl' | 'provider'>;
        issues: (Issue & { suggestions: Suggestion[] })[];
        initiator: Pick<User, 'username'> | null;
    };
    analytics: Analytics;
};

function truncate(text: string | null | undefined): string {
    if (!text) return 'N/A';
    if (text.length <= MAX_TEXT_LENGTH) return text;
    return `${text.slice(0, MAX_TEXT_LENGTH)}…`;
}

function formatDuration(durationMs: number | null): string {
    if (durationMs === null) return 'N/A';
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatDate(date: Date): string {
    return date.toISOString();
}

function parseSeverityDistribution(raw: unknown): Record<Severity, number> {
    const base: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    if (!raw || typeof raw !== 'object') return base;

    for (const severity of SEVERITY_ORDER) {
        const value = (raw as Record<string, unknown>)[severity];
        if (typeof value === 'number') base[severity] = value;
    }

    return base;
}

function computeCategoryDistribution(issues: Issue[]): Record<Category, number> {
    const counts = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
    for (const issue of issues) {
        counts[issue.category]++;
    }
    return counts;
}

function computeSourceCounts(issues: Issue[]): Record<IssueSource, number> {
    return {
        AI: issues.filter((i) => i.source === 'AI').length,
        ANALYZER: issues.filter((i) => i.source === 'ANALYZER').length,
    };
}

function computeSuggestionStatusCounts(suggestions: Suggestion[]): Record<SuggestionStatus, number> {
    return {
        PENDING: suggestions.filter((s) => s.status === 'PENDING').length,
        APPLIED: suggestions.filter((s) => s.status === 'APPLIED').length,
        DISMISSED: suggestions.filter((s) => s.status === 'DISMISSED').length,
    };
}

function collectAllSuggestions(issues: (Issue & { suggestions: Suggestion[] })[]): Suggestion[] {
    return issues.flatMap((issue) => issue.suggestions);
}

function renderPdf(data: ScanReportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const { scan, analytics } = data;
        const { project, issues } = scan;
        const severityDistribution = parseSeverityDistribution(analytics.severityDistribution);
        const categoryDistribution = computeCategoryDistribution(issues);
        const sourceCounts = computeSourceCounts(issues);
        const allSuggestions = collectAllSuggestions(issues);
        const suggestionStatusCounts = computeSuggestionStatusCounts(allSuggestions);

        doc.fontSize(20).text('CodePilot Scan Report', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#666666').text(`Generated: ${formatDate(new Date())}`, { align: 'center' });
        doc.fillColor('#000000');
        doc.moveDown(1.5);

        doc.fontSize(14).text('Project Information');
        doc.moveDown(0.5);
        doc.fontSize(10);
        doc.text(`Name: ${project.name}`);
        doc.text(`Repository: ${project.owner}/${project.repoName}`);
        doc.text(`URL: ${project.repoUrl}`);
        doc.text(`Provider: ${project.provider}`);
        doc.moveDown(1);

        doc.fontSize(14).text('Scan Information');
        doc.moveDown(0.5);
        doc.fontSize(10);
        doc.text(`Scan ID: ${scan.id}`);
        doc.text(`Branch: ${scan.branchName}`);
        doc.text(`Commit SHA: ${scan.commitSha ?? 'N/A'}`);
        doc.text(`Scan Date: ${formatDate(scan.scanDate)}`);
        doc.text(`Status: ${scan.status}`);
        doc.text(`Model Used: ${scan.modelUsed ?? 'N/A'}`);
        doc.text(`Duration: ${formatDuration(scan.durationMs)}`);
        doc.text(`Tokens Used: ${scan.tokensUsed ?? 'N/A'}`);
        if (scan.initiator?.username) {
            doc.text(`Initiated By: ${scan.initiator.username}`);
        }
        doc.moveDown(1);

        doc.fontSize(14).text('Analytics');
        doc.moveDown(0.5);
        doc.fontSize(10);
        doc.text(`Technical Debt Score: ${analytics.technicalDebtScore}`);
        doc.text(`Average Complexity: ${analytics.avgComplexity.toFixed(2)}`);
        doc.text(`Analytics Generated: ${formatDate(analytics.generatedAt)}`);
        doc.moveDown(0.5);
        doc.text('Severity Distribution:');
        for (const severity of SEVERITY_ORDER) {
            doc.text(`  ${severity}: ${severityDistribution[severity]}`);
        }
        doc.moveDown(0.5);
        doc.text('Category Distribution:');
        for (const category of ALL_CATEGORIES) {
            if (categoryDistribution[category] > 0) {
                doc.text(`  ${category}: ${categoryDistribution[category]}`);
            }
        }
        doc.moveDown(1);

        doc.fontSize(14).text('Issues');
        doc.moveDown(0.5);

        if (issues.length === 0) {
            doc.fontSize(10).text('No issues recorded for this scan.');
        } else {
            for (const severity of SEVERITY_ORDER) {
                const group = issues.filter((i) => i.severity === severity);
                if (group.length === 0) continue;

                doc.fontSize(12).text(`${severity} (${group.length})`);
                doc.moveDown(0.3);

                for (const issue of group) {
                    doc.fontSize(10);
                    doc.text(`• ${issue.filePath}:${issue.lineNumber} [${issue.source}] [${issue.category}] [${issue.status}]`);
                    doc.text(`  Summary: ${truncate(issue.summary)}`);
                    if (issue.explanation) {
                        doc.text(`  Explanation: ${truncate(issue.explanation)}`);
                    }
                    doc.moveDown(0.3);
                }

                doc.moveDown(0.5);
            }
        }

        doc.addPage();
        doc.fontSize(14).text('Suggestions');
        doc.moveDown(0.5);

        if (allSuggestions.length === 0) {
            doc.fontSize(10).text('No suggestions recorded for this scan.');
        } else {
            for (const suggestion of allSuggestions) {
                const linkedIssue = issues.find((i) => i.id === suggestion.issueId);
                doc.fontSize(10);
                doc.text(`• [${suggestion.status}] ${truncate(suggestion.summary)}`);
                if (linkedIssue) {
                    doc.text(`  Issue: ${linkedIssue.filePath}:${linkedIssue.lineNumber}`);
                }
                if (suggestion.explanation) {
                    doc.text(`  Explanation: ${truncate(suggestion.explanation)}`);
                }
                doc.moveDown(0.4);
            }
        }

        doc.moveDown(1);
        doc.fontSize(14).text('Summary Statistics');
        doc.moveDown(0.5);
        doc.fontSize(10);
        doc.text(`Total Issues: ${issues.length}`);
        doc.text(`  AI: ${sourceCounts.AI}`);
        doc.text(`  Analyzer: ${sourceCounts.ANALYZER}`);
        doc.moveDown(0.5);
        doc.text('Issues by Severity:');
        for (const severity of SEVERITY_ORDER) {
            doc.text(`  ${severity}: ${severityDistribution[severity]}`);
        }
        doc.moveDown(0.5);
        doc.text('Issues by Category:');
        for (const category of ALL_CATEGORIES) {
            if (categoryDistribution[category] > 0) {
                doc.text(`  ${category}: ${categoryDistribution[category]}`);
            }
        }
        doc.moveDown(0.5);
        doc.text(`Total Suggestions: ${allSuggestions.length}`);
        doc.text(`  Pending: ${suggestionStatusCounts.PENDING}`);
        doc.text(`  Applied: ${suggestionStatusCounts.APPLIED}`);
        doc.text(`  Dismissed: ${suggestionStatusCounts.DISMISSED}`);

        doc.end();
    });
}

export async function buildScanReportPdf(data: ScanReportData): Promise<Buffer> {
    return renderPdf(data);
}
