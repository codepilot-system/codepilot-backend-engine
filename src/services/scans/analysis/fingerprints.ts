import Parser from 'tree-sitter';
import * as crypto from 'crypto';

// node types that are just identifiers/literals - normalize these so that
// renamed variables/different literal values still produce the same fingerprint
const NORMALIZE_TYPES = new Set([
    'identifier', 'property_identifier', 'shorthand_property_identifier',
    'string', 'number', 'template_string',
    'string_literal', 'integer_literal', 'decimal_integer_literal',
    'true', 'false', 'null', 'undefined',
    'type_identifier', 'predefined_type'
]);

const SKIP_TYPES = new Set([
    ',', ';', ':', '.', '(', ')', '{', '}', '[', ']',
    'comment', 'block_comment', 'line_comment', 'ERROR'
]);

/**
 * Builds a structural fingerprint of a function's AST, ignoring variable
 * names and literal values */
export function buildFingerprint(node: Parser.SyntaxNode): string {
    if (SKIP_TYPES.has(node.type)) return '';

    if (NORMALIZE_TYPES.has(node.type)) {
        if (node.type === 'identifier' || node.type === 'property_identifier') return 'VAR';
        if (node.type.includes('string') || node.type.includes('template')) return 'STR';
        if (node.type.includes('number') || node.type.includes('integer') || node.type.includes('decimal')) return 'NUM';
        if (node.type === 'true' || node.type === 'false') return 'BOOL';
        if (node.type === 'null' || node.type === 'undefined') return 'NULL';
        return 'LIT';
    }

    if (node.childCount === 0) return node.type;

    const childHashes: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
        const fp = buildFingerprint(node.child(i)!);
        if (fp) {
            childHashes.push(hashFingerprint(fp));
        }
    }

    return `${node.type}(${childHashes.join(',')})`;
}

export function hashFingerprint(fingerprint: string): string {
    return crypto.createHash('md5').update(fingerprint).digest('hex');
}
