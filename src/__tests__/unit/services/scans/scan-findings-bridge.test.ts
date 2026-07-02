import { buildCodeFilesFromFindings, buildFindingsSummaryText } from '../../../../services/scans/scan-findings-bridge';
import { AnalyzerOutput } from '../../../../services/scans/analysis/analyzer';
import { FetchedFile } from '../../../../services/scans/scan-github';

function makeAnalyzerOutput(overrides: Partial<AnalyzerOutput> = {}): AnalyzerOutput {
    return {
        analyzerVersion: '1.1.0',
        scanType: 'repo',
        summary: {
            totalFilesAnalyzed: 1,
            totalFindings: 0,
            highConfidenceFindings: 0,
            ...overrides.summary,
        },
        findings: overrides.findings ?? [],
    };
}

describe('scan-findings-bridge', () => {
    describe('buildCodeFilesFromFindings', () => {
        it('should correctly build code files with selected lines from findings', () => {
            const allFiles: FetchedFile[] = [
                { filePath: 'file1.ts', content: 'content1' },
                { filePath: 'file2.ts', content: 'content2' },
                { filePath: 'file3.ts', content: 'content3' },
            ];

            const analyzerOutput = makeAnalyzerOutput({
                summary: { totalFilesAnalyzed: 3, totalFindings: 3, highConfidenceFindings: 3 },
                findings: [
                    {
                        filePath: 'file1.ts',
                        functionName: 'func1',
                        startLine: 1,
                        endLine: 10,
                        findings: []
                    },
                    {
                        filePath: 'file1.ts',
                        functionName: 'func2',
                        startLine: 5,
                        endLine: 15,
                        findings: []
                    },
                    {
                        filePath: 'file2.ts',
                        functionName: 'func3',
                        startLine: 20,
                        endLine: 30,
                        findings: []
                    }
                ]
            });

            const result = buildCodeFilesFromFindings(allFiles, analyzerOutput);


            expect(result).toHaveLength(2);

            const file1 = result.find(f => f.filePath === 'file1.ts');
            expect(file1).toBeDefined();
            expect(file1?.selectedLines).toEqual([{ start: 1, end: 15 }]);

            const file2 = result.find(f => f.filePath === 'file2.ts');
            expect(file2).toBeDefined();
            expect(file2?.selectedLines).toEqual([{ start: 20, end: 30 }]);
        });

        it('should handle empty findings', () => {
            const result = buildCodeFilesFromFindings(
                [{ filePath: 'f1.ts', content: 'c' }],
                makeAnalyzerOutput({ summary: { totalFilesAnalyzed: 1, totalFindings: 0, highConfidenceFindings: 0 } })
            );
            expect(result).toHaveLength(0);
        });
    });

    describe('buildFindingsSummaryText', () => {
        it('should generate human-readable text from findings', () => {
            const analyzerOutput = makeAnalyzerOutput({
                summary: { totalFilesAnalyzed: 2, totalFindings: 4, highConfidenceFindings: 2 },
                findings: [
                    {
                        filePath: 'file1.ts',
                        functionName: 'func1',
                        startLine: 1,
                        endLine: 10,
                        findings: [
                            { issueType: 'LONG_FUNCTION', severity: 'MEDIUM', confidence: 0.9, signals: { lineCount: 150 } },
                            { issueType: 'DEEP_NESTING', severity: 'LOW', confidence: 0.6, signals: { nestingDepth: 5 } }
                        ]
                    },
                    {
                        filePath: 'file2.ts',
                        functionName: 'func2',
                        startLine: 20,
                        endLine: 30,
                        findings: [
                            { issueType: 'DUPLICATE', severity: 'HIGH', confidence: 0.95, signals: { duplicateGroupId: 'g1' } },
                            { issueType: 'HIGH_COMPLEXITY', severity: 'MEDIUM', confidence: 0.8, signals: { concerns: ['Too complex'] } }
                        ]
                    }
                ]
            });


            const summary = buildFindingsSummaryText(analyzerOutput);

            expect(summary).toContain('file2.ts:func2');
            expect(summary).toContain('DUPLICATE');
            expect(summary).toContain('HIGH_COMPLEXITY');
            expect(summary).toContain('duplicate group g1');
            expect(summary).toContain('Too complex');
        });

        it('should limit output lines based on maxLines', () => {
            const analyzerOutput = makeAnalyzerOutput({
                summary: { totalFilesAnalyzed: 3, totalFindings: 3, highConfidenceFindings: 3 },
                findings: [
                    { filePath: 'file1.ts', functionName: 'func1', startLine: 1, endLine: 10, findings: [{ issueType: 'LONG_FUNCTION', severity: 'LOW', confidence: 0.9, signals: {} }] },
                    { filePath: 'file2.ts', functionName: 'func2', startLine: 1, endLine: 10, findings: [{ issueType: 'DEEP_NESTING', severity: 'LOW', confidence: 0.8, signals: {} }] },
                    { filePath: 'file3.ts', functionName: 'func3', startLine: 1, endLine: 10, findings: [{ issueType: 'SRP_VIOLATION', severity: 'LOW', confidence: 0.7, signals: {} }] },
                ]
            });

            const summary = buildFindingsSummaryText(analyzerOutput, 2);
            expect(summary).toContain('...and 1 more lower-confidence findings omitted for brevity.');
            expect(summary).toContain('func1');
            expect(summary).toContain('func2');
            expect(summary).not.toContain('func3');
        });

        it('should ignore findings that reference missing files', () => {
            const allFiles = [
                { filePath: 'a.ts', content: '...' }
            ];

            const analyzer = makeAnalyzerOutput({
                findings: [
                    {
                        filePath: 'missing.ts',
                        functionName: 'f',
                        startLine: 1,
                        endLine: 2,
                        findings: [],
                    },
                ],
            });

            const result = buildCodeFilesFromFindings(allFiles, analyzer);

            expect(result).toEqual([]);
        });
    });
});
