import Parser from 'tree-sitter';
import { LanguageRules, RawFinding, FunctionRecord } from './types';
import { CONCERN_PATTERNS } from './patterns';
import { buildFingerprint, hashFingerprint } from './fingerprints';

const NESTING_THRESHOLD = 4;           // was 5 — try_statement removed so this is equivalent
const SRP_CONCERN_THRESHOLD = 3;       // raised from 2; logging alone shouldn't trigger SRP
const LONG_FUNCTION_THRESHOLD = 150;   // raised from 50 — 50 lines is normal
const MIN_LINES_FOR_DUPLICATE = 4;

const LOGICAL_OPERATORS = new Set(['&&', '||', '??', 'and', 'or']);

export function computeCyclomaticComplexity(
    node: Parser.SyntaxNode,
    rules: LanguageRules,
    isRoot: boolean = true
): number {
    let count = 0;

    // Don't descend into nested function definitions (they own their CC)
    if (!isRoot && rules.functionNodes.includes(node.type)) {
        return 0;
    }

    if (rules.ccNodes.includes(node.type)) {
        // For Java binary_expression, only count logical operators (&& / ||)
        if (node.type === 'binary_expression') {
            const operator = node.childForFieldName('operator')?.text ?? '';
            if (LOGICAL_OPERATORS.has(operator)) count++;
        } else {
            count++;
        }
    }

    for (let i = 0; i < node.childCount; i++) {
        count += computeCyclomaticComplexity(node.child(i)!, rules, false);
    }

    return count;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

export function getFunctionName(node: Parser.SyntaxNode): string {
    const nameNode = node.childForFieldName('name');
    // For anonymous functions, use position as a unique identifier so the
    // reported Set in detectDeepNesting doesn't deduplicate them incorrectly
    return nameNode ? nameNode.text : `anonymous@${node.startPosition.row + 1}`;
}

function extractCalls(node: Parser.SyntaxNode, rules: LanguageRules, calls: string[] = []): string[] {
    if (rules.callNodes.includes(node.type)) {
        calls.push(node.text);
    }
    for (let i = 0; i < node.childCount; i++) {
        extractCalls(node.child(i)!, rules, calls);
    }
    return calls;
}

// ----------------------------------------------------------------
// Detectors
// ----------------------------------------------------------------

export function detectLongFunctions(
    node: Parser.SyntaxNode,
    rules: LanguageRules,
    filePath: string,
    raw: RawFinding[]
) {
    if (rules.functionNodes.includes(node.type)) {
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const lineCount = endLine - startLine + 1;
        const name = getFunctionName(node);

        if (lineCount > LONG_FUNCTION_THRESHOLD) {
            const cc = computeCyclomaticComplexity(node, rules);
            // Confidence scales with how far over the threshold the function is
            const confidence = Math.min(0.95, 0.6 + (lineCount - LONG_FUNCTION_THRESHOLD) * 0.005);
            raw.push({
                filePath, functionName: name, startLine, endLine,
                issueType: 'LONG_FUNCTION',
                confidence: parseFloat(confidence.toFixed(2)),
                signals: { lineCount, threshold: LONG_FUNCTION_THRESHOLD, cc },
            });
        }
    }
    for (let i = 0; i < node.childCount; i++) {
        detectLongFunctions(node.child(i)!, rules, filePath, raw);
    }
}

export function detectDeepNesting(
    node: Parser.SyntaxNode,
    rules: LanguageRules,
    filePath: string,
    raw: RawFinding[],
    depth: number = 0,
    functionName: string = '',
    reported: Set<string> = new Set(),  // still per-tree-walk but now keyed by unique name
    fnStart: number = 0,
    fnEnd: number = 0,
    fnNode: Parser.SyntaxNode | null = null
) {
    if (rules.functionNodes.includes(node.type)) {
        functionName = getFunctionName(node);  // now includes position for anonymous functions
        fnStart = node.startPosition.row + 1;
        fnEnd = node.endPosition.row + 1;
        fnNode = node;
        depth = 0;
        // Reset reported per function so nested anonymous functions are
        // each evaluated independently
        reported = new Set();
    }

    if (rules.nestingNodes.includes(node.type)) {
        depth++;
        if (depth >= NESTING_THRESHOLD && !reported.has(functionName)) {
            reported.add(functionName);
            const cc = fnNode ? computeCyclomaticComplexity(fnNode, rules) : 0;
            const confidence = Math.min(0.95, 0.65 + (depth - NESTING_THRESHOLD) * 0.1);
            raw.push({
                filePath, functionName, startLine: fnStart, endLine: fnEnd,
                issueType: 'DEEP_NESTING',
                confidence: parseFloat(confidence.toFixed(2)),
                signals: { nestingDepth: depth, threshold: NESTING_THRESHOLD, cc },
            });
        }
    }

    for (let i = 0; i < node.childCount; i++) {
        detectDeepNesting(node.child(i)!, rules, filePath, raw, depth, functionName, reported, fnStart, fnEnd, fnNode);
    }
}

export function detectSRPViolations(
    node: Parser.SyntaxNode,
    rules: LanguageRules,
    filePath: string,
    raw: RawFinding[],
    functionName: string = ''
) {
    if (rules.functionNodes.includes(node.type)) {
        functionName = getFunctionName(node);
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;

        const calls = extractCalls(node, rules);
        const detectedConcerns: string[] = [];

        for (const [concern, patterns] of Object.entries(CONCERN_PATTERNS)) {
            if (calls.some(call => patterns.some(p => p.test(call)))) {
                detectedConcerns.push(concern);
            }
        }

        if (detectedConcerns.length >= SRP_CONCERN_THRESHOLD) {
            const cc = computeCyclomaticComplexity(node, rules);
            const confidence = Math.min(0.95, 0.5 + detectedConcerns.length * 0.1);
            raw.push({
                filePath, functionName, startLine, endLine,
                issueType: 'SRP_VIOLATION',
                confidence: parseFloat(confidence.toFixed(2)),
                signals: { concerns: detectedConcerns, concernCount: detectedConcerns.length, threshold: SRP_CONCERN_THRESHOLD, cc },
            });
        } else {
            // Fallback heuristic for unrecognized patterns — tightened thresholds
            // to reduce noise on normal service functions
            const lineCount = endLine - startLine + 1;
            const uniqueCallers = new Set(
                calls.map(c => c.split('(')[0].split('.')[0].trim())
            );
            if (lineCount > 40 && uniqueCallers.size > 8) {
                const cc = computeCyclomaticComplexity(node, rules);
                raw.push({
                    filePath, functionName, startLine, endLine,
                    issueType: 'SRP_VIOLATION',
                    confidence: 0.35,
                    signals: {
                        concerns: ['UNKNOWN'],
                        uniqueCallers: Array.from(uniqueCallers).slice(0, 8),
                        note: 'Fallback heuristic: many distinct external calls, unrecognized patterns',
                        cc,
                    },
                });
            }
        }
    }

    for (let i = 0; i < node.childCount; i++) {
        detectSRPViolations(node.child(i)!, rules, filePath, raw, functionName);
    }
}

/**
 * Standalone HIGH_COMPLEXITY detector.
 * Flags functions whose CC is high even if no other detector fires.
 * This catches deeply branchy functions that are short enough to pass
 * LONG_FUNCTION and not nested enough for DEEP_NESTING.
 *
 * Thresholds based on McCabe's scale:
 *   CC 11–15 → moderate, confidence 0.60 (MEDIUM)
 *   CC 16–20 → high,     confidence 0.78 (HIGH)
 *   CC 21+   → critical, confidence 0.92 (CRITICAL)
 */
export function detectHighComplexity(
    node: Parser.SyntaxNode,
    rules: LanguageRules,
    filePath: string,
    raw: RawFinding[]
) {
    if (rules.functionNodes.includes(node.type)) {
        const name = getFunctionName(node);
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const cc = computeCyclomaticComplexity(node, rules);

        if (cc >= 11) {
            let confidence: number;
            if (cc >= 21) confidence = 0.92;
            else if (cc >= 16) confidence = 0.78;
            else confidence = 0.60;   // 11–15

            raw.push({
                filePath, functionName: name, startLine, endLine,
                issueType: 'HIGH_COMPLEXITY',
                confidence,
                signals: { cc, threshold: 11 },
            });
        }
    }

    for (let i = 0; i < node.childCount; i++) {
        detectHighComplexity(node.child(i)!, rules, filePath, raw);
    }
}

export function collectFunctionRecords(
    node: Parser.SyntaxNode,
    rules: LanguageRules,
    filePath: string,
    records: FunctionRecord[]
) {
    if (rules.functionNodes.includes(node.type)) {
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const lineCount = endLine - startLine + 1;

        if (lineCount >= MIN_LINES_FOR_DUPLICATE) {
            const name = getFunctionName(node);
            const fingerprint = buildFingerprint(node);
            const hash = hashFingerprint(fingerprint);
            records.push({ name, filePath, startLine, endLine, hash, fingerprint });
        }
    }
    for (let i = 0; i < node.childCount; i++) {
        collectFunctionRecords(node.child(i)!, rules, filePath, records);
    }
}

export function detectDuplicates(allRecords: FunctionRecord[], raw: RawFinding[]) {
    const hashMap = new Map<string, FunctionRecord[]>();
    for (const record of allRecords) {
        const group = hashMap.get(record.hash) || [];
        group.push(record);
        hashMap.set(record.hash, group);
    }

    let groupId = 0;
    for (const [, group] of hashMap) {
        if (group.length > 1) {
            groupId++;
            const duplicateGroupId = `dup-${String(groupId).padStart(3, '0')}`;
            for (const fn of group) {
                const duplicateOf = group
                    .filter(f => f !== fn)
                    .map(f => ({ functionName: f.name, filePath: f.filePath, startLine: f.startLine }));
                raw.push({
                    filePath: fn.filePath,
                    functionName: fn.name,
                    startLine: fn.startLine,
                    endLine: fn.endLine,
                    issueType: 'DUPLICATE',
                    confidence: 0.95,
                    signals: { duplicateGroupId, duplicateOf },
                });
            }
        }
    }
}
