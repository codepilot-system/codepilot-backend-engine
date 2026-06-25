import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
import JavaScript from 'tree-sitter-javascript';
import { LanguageRules } from './types';

const JS_TS_CC_NODES = [
    'if_statement',
    'else_clause',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'switch_case',
    'catch_clause',
    'ternary_expression',
    'logical_expression',
];

const PYTHON_CC_NODES = [
    'if_statement',
    'elif_clause',
    'for_statement',
    'while_statement',
    'except_clause',
    'conditional_expression',
    'boolean_operator',
];

const JAVA_CC_NODES = [
    'if_statement',
    'else',
    'for_statement',
    'enhanced_for_statement',
    'while_statement',
    'do_statement',
    'switch_label',
    'catch_clause',
    'ternary_expression',
    'binary_expression',
];

export const LANGUAGE_RULES: Record<string, LanguageRules> = {
    '.ts': {
        functionNodes: ['function_declaration', 'method_definition', 'arrow_function'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'for_in_statement', 'switch_statement'],
        callNodes: ['call_expression'],
        ccNodes: JS_TS_CC_NODES,
        language: TypeScript.typescript,
    },
    '.tsx': {
        functionNodes: ['function_declaration', 'method_definition', 'arrow_function'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'for_in_statement', 'switch_statement'],
        callNodes: ['call_expression'],
        ccNodes: JS_TS_CC_NODES,
        language: TypeScript.tsx,
    },
    '.js': {
        functionNodes: ['function_declaration', 'method_definition', 'arrow_function'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'for_in_statement', 'switch_statement'],
        callNodes: ['call_expression'],
        ccNodes: JS_TS_CC_NODES,
        language: JavaScript,
    },
    '.jsx': {
        functionNodes: ['function_declaration', 'method_definition', 'arrow_function'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'for_in_statement', 'switch_statement'],
        callNodes: ['call_expression'],
        ccNodes: JS_TS_CC_NODES,
        language: JavaScript,
    },
    '.py': {
        functionNodes: ['function_definition'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement'],
        callNodes: ['call'],
        ccNodes: PYTHON_CC_NODES,
        language: Python,
    },
    '.java': {
        functionNodes: ['method_declaration', 'constructor_declaration'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'enhanced_for_statement', 'switch_expression'],
        callNodes: ['method_invocation'],
        ccNodes: JAVA_CC_NODES,
        language: Java,
    },
};
