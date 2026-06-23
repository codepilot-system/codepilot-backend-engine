import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
import { AnalyzerOutput, FunctionAnalysis, RawFinding, FunctionRecord, IssueType, Severity } from './types';
import { LANGUAGE_RULES } from './languages';
import {
    detectLongFunctions,
    detectDeepNesting,
    detectSRPViolations,
    collectFunctionRecords,
    detectDuplicates
} from './detectors';

const ANALYZER_VERSION = '1.0.0';
const HIGH_CONFIDENCE_THRESHOLD = 0.75;

function severityFromConfidence(confidence: number, issueType: IssueType): Severity {
    // duplicates and SRP violations are inherently more impactful at the same confidence level
    const weight = (issueType === 'SRP_VIOLATION' || issueType === 'DUPLICATE') ? 0.1 : 0;
    const adjusted = confidence + weight;

    if (adjusted >= 0.85) return 'CRITICAL';
    if (adjusted >= 0.7) return 'HIGH';
    if (adjusted >= 0.5) return 'MEDIUM';
    return 'LOW';
}

function groupFindings(raw: RawFinding[]): FunctionAnalysis[] {
    const map = new Map<string, FunctionAnalysis>();

    for (const r of raw) {
        const key = `${r.filePath}::${r.functionName}::${r.startLine}`;
        if (!map.has(key)) {
            map.set(key, {
                filePath: r.filePath,
                functionName: r.functionName,
                startLine: r.startLine,
                endLine: r.endLine,
                findings: []
            });
        }
        map.get(key)!.findings.push({
            issueType: r.issueType,
            confidence: r.confidence,
            severity: severityFromConfidence(r.confidence, r.issueType),
            signals: r.signals
        });
    }

    return Array.from(map.values());
}


export function analyzeFiles(
    filePaths: string[],
    scanType: 'local' | 'repo' = 'local'
): AnalyzerOutput {
    const raw: RawFinding[] = [];
    const allFunctionRecords: FunctionRecord[] = [];
    let filesAnalyzed = 0;

    for (const filePath of filePaths) {
        const ext = path.extname(filePath);
        const rules = LANGUAGE_RULES[ext];
        if (!rules) continue;

        const parser = new Parser();
        parser.setLanguage(rules.language);
        const code = fs.readFileSync(filePath, 'utf8');
        const tree = parser.parse(code);

        detectLongFunctions(tree.rootNode, rules, filePath, raw);
        detectDeepNesting(tree.rootNode, rules, filePath, raw);
        detectSRPViolations(tree.rootNode, rules, filePath, raw);
        collectFunctionRecords(tree.rootNode, rules, filePath, allFunctionRecords);

        filesAnalyzed++;
    }

    detectDuplicates(allFunctionRecords, raw);

    const findings = groupFindings(raw);
    const totalFindings = raw.length;
    const highConfidenceFindings = raw.filter(r => r.confidence >= HIGH_CONFIDENCE_THRESHOLD).length;

    return {
        analyzerVersion: ANALYZER_VERSION,
        scanType,
        summary: {
            totalFilesAnalyzed: filesAnalyzed,
            totalFindings,
            highConfidenceFindings
        },
        findings
    };
}

/**
 * Same as analyzeFiles, but takes in-memory file contents instead of reading
 * from disk.  */
export function analyzeFileContents(
    files: { filePath: string; content: string }[],
    scanType: 'local' | 'repo' = 'local'
): AnalyzerOutput {
    const raw: RawFinding[] = [];
    const allFunctionRecords: FunctionRecord[] = [];
    let filesAnalyzed = 0;

    for (const file of files) {
        const ext = path.extname(file.filePath);
        const rules = LANGUAGE_RULES[ext];
        if (!rules) continue;

        const parser = new Parser();
        parser.setLanguage(rules.language);
        const tree = parser.parse(file.content);

        detectLongFunctions(tree.rootNode, rules, file.filePath, raw);
        detectDeepNesting(tree.rootNode, rules, file.filePath, raw);
        detectSRPViolations(tree.rootNode, rules, file.filePath, raw);
        collectFunctionRecords(tree.rootNode, rules, file.filePath, allFunctionRecords);

        filesAnalyzed++;
    }

    detectDuplicates(allFunctionRecords, raw);

    const findings = groupFindings(raw);
    const totalFindings = raw.length;
    const highConfidenceFindings = raw.filter(r => r.confidence >= HIGH_CONFIDENCE_THRESHOLD).length;

    return {
        analyzerVersion: ANALYZER_VERSION,
        scanType,
        summary: {
            totalFilesAnalyzed: filesAnalyzed,
            totalFindings,
            highConfidenceFindings
        },
        findings
    };
}

export type { AnalyzerOutput, FunctionAnalysis, FunctionFinding, IssueType, Severity } from './types';
