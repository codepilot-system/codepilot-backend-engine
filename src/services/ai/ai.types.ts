export interface CodeFile {
  filePath: string;
  content: string;
  selectedLines?: { start: number; end: number }[];
}

export interface ScanIssue {
  filePath: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: 'CODE_SMELL' | 'DEAD_CODE' | 'DUPLICATE' | 'COMPLEXITY' | 'SRP_VIOLATION' | 'SECURITY' | 'PERFORMANCE' | 'FUNCTIONALITY' | 'OTHER';
  summary: string;
  explanation: string;
  codeSnippet: string;
  diffPatch: string;
  suggestedFixSummary: string;
  lineNumber?: number;
}

export interface AnalysisResult {
  issues: ScanIssue[];
  modelUsed: string;
  tokensUsed: number;
  durationMs: number;
}

export interface ModelStatus {
  model: string;
  isAvailable: boolean;
  status: 'Active' | 'Down' | 'Out of Quota';
  reason: string | null;
}

export interface ImportedFileSkeleton {
  filePath: string;
  skeleton: string;
}

export type ScanType = 'local' | 'repo';
