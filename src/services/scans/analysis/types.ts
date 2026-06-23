export type IssueType = 'LONG_FUNCTION' | 'DEEP_NESTING' | 'SRP_VIOLATION' | 'DUPLICATE';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface FunctionFinding {
    issueType: IssueType;
    confidence: number;
    severity: Severity;
    signals: Record<string, any>;
}

export interface FunctionAnalysis {
    filePath: string;
    functionName: string;
    startLine: number;
    endLine: number;
    findings: FunctionFinding[];
}

export interface AnalyzerOutput {
    analyzerVersion: string;
    scanType: 'local' | 'repo';
    summary: {
        totalFilesAnalyzed: number;
        totalFindings: number;
        highConfidenceFindings: number;
    };
    findings: FunctionAnalysis[];
}

export interface RawFinding {
    filePath: string;
    functionName: string;
    startLine: number;
    endLine: number;
    issueType: IssueType;
    confidence: number;
    signals: Record<string, any>;
}

export interface FunctionRecord {
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
    hash: string;
    fingerprint: string;
}

export interface LanguageRules {
    functionNodes: string[];
    nestingNodes: string[];
    callNodes: string[];
    language: any;
}
