import Parser from 'tree-sitter';
import { LanguageRules, RawFinding, FunctionRecord } from './types';
import { CONCERN_PATTERNS } from './patterns';
import { buildFingerprint, hashFingerprint } from './fingerprints';

const NESTING_THRESHOLD = 5;
const SRP_CONCERN_THRESHOLD = 2;
const LONG_FUNCTION_THRESHOLD = 50;
const MIN_LINES_FOR_DUPLICATE = 4;

export function getFunctionName(node: Parser.SyntaxNode): string {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : 'anonymous';
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
            const confidence = Math.min(0.95, 0.6 + (lineCount - LONG_FUNCTION_THRESHOLD) * 0.01);
            raw.push({
                filePath, functionName: name, startLine, endLine,
                issueType: 'LONG_FUNCTION',
                confidence: parseFloat(confidence.toFixed(2)),
                signals: { lineCount, threshold: LONG_FUNCTION_THRESHOLD }
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
    reported: Set<string> = new Set(),
    fnStart: number = 0,
    fnEnd: number = 0
) {
    if (rules.functionNodes.includes(node.type)) {
        functionName = getFunctionName(node);
        fnStart = node.startPosition.row + 1;
        fnEnd = node.endPosition.row + 1;
        depth = 0;
    }

    if (rules.nestingNodes.includes(node.type)) {
        depth++;
        if (depth >= NESTING_THRESHOLD && !reported.has(functionName)) {
            reported.add(functionName);
            const confidence = Math.min(0.95, 0.65 + (depth - NESTING_THRESHOLD) * 0.1);
            raw.push({
                filePath, functionName, startLine: fnStart, endLine: fnEnd,
                issueType: 'DEEP_NESTING',
                confidence: parseFloat(confidence.toFixed(2)),
                signals: { nestingDepth: depth, threshold: NESTING_THRESHOLD }
            });
        }
    }

    for (let i = 0; i < node.childCount; i++) {
        detectDeepNesting(node.child(i)!, rules, filePath, raw, depth, functionName, reported, fnStart, fnEnd);
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
            const confidence = Math.min(0.95, 0.5 + detectedConcerns.length * 0.1);
            raw.push({
                filePath, functionName, startLine, endLine,
                issueType: 'SRP_VIOLATION',
                confidence: parseFloat(confidence.toFixed(2)),
                signals: { concerns: detectedConcerns, concernCount: detectedConcerns.length, threshold: SRP_CONCERN_THRESHOLD }
            });
        } else {
            // fallback: low-confidence catch for custom/unrecognized service names
            // that don't match our known patterns but still look suspicious
            const uniqueCallers = new Set(
                calls.map(c => c.split('(')[0].split('.')[0].trim())
            );
            const lineCount = endLine - startLine + 1;
            if (lineCount > 7 && uniqueCallers.size > 4) {
                raw.push({
                    filePath, functionName, startLine, endLine,
                    issueType: 'SRP_VIOLATION',
                    confidence: 0.35,
                    signals: {
                        concerns: ['UNKNOWN'],
                        uniqueCallers: Array.from(uniqueCallers).slice(0, 8),
                        note: 'Fallback heuristic: many distinct external calls, unrecognized patterns'
                    }
                });
            }
        }
    }

    for (let i = 0; i < node.childCount; i++) {
        detectSRPViolations(node.child(i)!, rules, filePath, raw, functionName);
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
                    signals: { duplicateGroupId, duplicateOf }
                });
            }
        }
    }
}
