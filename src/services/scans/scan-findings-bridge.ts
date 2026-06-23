import { AnalyzerOutput, FunctionAnalysis } from './analysis/analyzer';
import { FetchedFile } from './scan-github';
import { CodeFile } from '../ai/ai.service';

export function buildCodeFilesFromFindings(
    allFiles: FetchedFile[],
    analyzerOutput: AnalyzerOutput
): CodeFile[] {
    const findingsByPath = new Map<string, FunctionAnalysis[]>();
    for (const finding of analyzerOutput.findings) {
        const existing = findingsByPath.get(finding.filePath) ?? [];
        existing.push(finding);
        findingsByPath.set(finding.filePath, existing);
    }

    const codeFiles: CodeFile[] = [];

    for (const file of allFiles) {
        const findings = findingsByPath.get(file.filePath);
        if (!findings || findings.length === 0) continue;
        const selectedLines = mergeOverlappingRanges(
            findings.map((f) => ({ start: f.startLine, end: f.endLine }))
        );

        codeFiles.push({
            filePath: file.filePath,
            content: file.content,
            selectedLines,
        });
    }

    return codeFiles;
}


function mergeOverlappingRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
    if (ranges.length <= 1) return ranges;

    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const prev = merged[merged.length - 1];
        if (sorted[i].start <= prev.end + 1) {
            prev.end = Math.max(prev.end, sorted[i].end);
        } else {
            merged.push(sorted[i]);
        }
    }

    return merged;
}

/**
* transforms analyzerOutput into a human-readable summary of findings
*/
export function buildFindingsSummaryText(analyzerOutput: AnalyzerOutput, maxLines: number = 60): string {
    const lines: string[] = [];

    const sortedFindings = [...analyzerOutput.findings].sort((a, b) => {
        const maxConfA = Math.max(...a.findings.map((f) => f.confidence));
        const maxConfB = Math.max(...b.findings.map((f) => f.confidence));
        return maxConfB - maxConfA;
    });

    for (const fn of sortedFindings) {
        if (lines.length >= maxLines) break;

        const issueDescriptions = fn.findings.map((f) => {
            const signalSummary = summarizeSignals(f.signals);
            return `${f.issueType} (confidence ${f.confidence}${signalSummary ? `, ${signalSummary}` : ''})`;
        }).join('; ');

        lines.push(`- ${fn.filePath}:${fn.functionName} (lines ${fn.startLine}-${fn.endLine}): ${issueDescriptions}`);
    }

    if (sortedFindings.length > lines.length) {
        lines.push(`...and ${sortedFindings.length - lines.length} more lower-confidence findings omitted for brevity.`);
    }

    return [
        'Static Analysis Findings (these are heuristic signals to guide your review - verify each one against the actual code before reporting it as a confirmed issue):',
        ...lines
    ].join('\n');
}

function summarizeSignals(signals: Record<string, any>): string {
    if ('lineCount' in signals) return `${signals.lineCount} lines`;
    if ('nestingDepth' in signals) return `nesting depth ${signals.nestingDepth}`;
    if ('concerns' in signals) return `concerns: ${signals.concerns.join(', ')}`;
    if ('duplicateGroupId' in signals) return `duplicate group ${signals.duplicateGroupId}`;
    return '';
}
