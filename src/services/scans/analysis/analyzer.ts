import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
import { AnalyzerOutput, FunctionAnalysis, RawFinding, FunctionRecord, IssueType, Severity } from './types';
import { LANGUAGE_RULES } from './languages';
import {
    detectLongFunctions,
    detectDeepNesting,
    detectSRPViolations,
    detectHighComplexity,
    collectFunctionRecords,
    detectDuplicates,
} from './detectors';

const ANALYZER_VERSION = '1.1.0';
const HIGH_CONFIDENCE_THRESHOLD = 0.75;

function ccBoost(cc: number): number {
    if (cc >= 21) return 0.20;
    if (cc >= 11) return 0.10;
    return 0;
}

function severityFromConfidence(confidence: number, issueType: IssueType): Severity {
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
                findings: [],
            });
        }
        map.get(key)!.findings.push({
            issueType: r.issueType,
            confidence: r.confidence,
            severity: severityFromConfidence(r.confidence, r.issueType),
            signals: r.signals,
        });
    }

    return Array.from(map.values());
}

function applyComplexityBoost(findings: FunctionAnalysis[]): void {
    for (const fn of findings) {
        const maxCC = fn.findings.reduce((best, f) => {
            const cc = typeof f.signals.cc === 'number' ? f.signals.cc : 0;
            return Math.max(best, cc);
        }, 0);

        const boost = ccBoost(maxCC);
        if (boost === 0) continue;

        for (const finding of fn.findings) {
            if (finding.issueType === 'DUPLICATE') continue;
            finding.confidence = parseFloat(
                Math.min(0.99, finding.confidence + boost).toFixed(2)
            );
            finding.severity = severityFromConfidence(finding.confidence, finding.issueType);
            finding.signals.ccBoost = boost;
        }
    }
}

function runDetectors(
    parsedFiles: { filePath: string; tree: Parser.Tree }[],
    rules: typeof LANGUAGE_RULES
): { raw: RawFinding[]; allFunctionRecords: FunctionRecord[]; filesAnalyzed: number } {
    const raw: RawFinding[] = [];
    const allFunctionRecords: FunctionRecord[] = [];
    let filesAnalyzed = 0;

    for (const { filePath, tree } of parsedFiles) {
        const ext = path.extname(filePath);
        const fileRules = rules[ext];
        if (!fileRules) continue;

        detectLongFunctions(tree.rootNode, fileRules, filePath, raw);
        detectDeepNesting(tree.rootNode, fileRules, filePath, raw);
        detectSRPViolations(tree.rootNode, fileRules, filePath, raw);
        detectHighComplexity(tree.rootNode, fileRules, filePath, raw);
        collectFunctionRecords(tree.rootNode, fileRules, filePath, allFunctionRecords);

        filesAnalyzed++;
    }

    detectDuplicates(allFunctionRecords, raw);
    return { raw, allFunctionRecords, filesAnalyzed };
}

function buildOutput(
    raw: RawFinding[],
    filesAnalyzed: number,
    scanType: 'local' | 'repo'
): AnalyzerOutput {
    const findings = groupFindings(raw);
    applyComplexityBoost(findings);

    const totalFindings = raw.length;
    const highConfidenceFindings = raw.filter(r => r.confidence >= HIGH_CONFIDENCE_THRESHOLD).length;

    return {
        analyzerVersion: ANALYZER_VERSION,
        scanType,
        summary: { totalFilesAnalyzed: filesAnalyzed, totalFindings, highConfidenceFindings },
        findings,
    };
}

export function analyzeFiles(
    filePaths: string[],
    scanType: 'local' | 'repo' = 'local'
): AnalyzerOutput {
    const parsedFiles: { filePath: string; tree: Parser.Tree }[] = [];

    for (const filePath of filePaths) {
        const ext = path.extname(filePath);
        const fileRules = LANGUAGE_RULES[ext];
        if (!fileRules) continue;

        const parser = new Parser();
        parser.setLanguage(fileRules.language);
        const code = fs.readFileSync(filePath, 'utf8');
        parsedFiles.push({ filePath, tree: parser.parse(code) });
    }

    const { raw, filesAnalyzed } = runDetectors(parsedFiles, LANGUAGE_RULES);
    return buildOutput(raw, filesAnalyzed, scanType);
}

export function analyzeFileContents(
    files: { filePath: string; content: string }[],
    scanType: 'local' | 'repo' = 'local'
): AnalyzerOutput {
    const parsedFiles: { filePath: string; tree: Parser.Tree }[] = [];

    for (const file of files) {
        const ext = path.extname(file.filePath);
        const fileRules = LANGUAGE_RULES[ext];
        if (!fileRules) continue;

        const parser = new Parser();
        parser.setLanguage(fileRules.language);
        parsedFiles.push({ filePath: file.filePath, tree: parser.parse(file.content) });
    }

    const { raw, filesAnalyzed } = runDetectors(parsedFiles, LANGUAGE_RULES);
    return buildOutput(raw, filesAnalyzed, scanType);
}

export type { AnalyzerOutput, FunctionAnalysis, IssueType, Severity } from './types';
