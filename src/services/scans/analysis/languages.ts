import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
import { LanguageRules } from './types';

export const LANGUAGE_RULES: Record<string, LanguageRules> = {
    '.ts': {
        functionNodes: ['function_declaration', 'method_definition', 'arrow_function'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'for_in_statement', 'switch_statement', 'try_statement'],
        callNodes: ['call_expression'],
        language: TypeScript.typescript
    },
    '.tsx': {
        functionNodes: ['function_declaration', 'method_definition', 'arrow_function'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'for_in_statement', 'switch_statement', 'try_statement'],
        callNodes: ['call_expression'],
        language: TypeScript.tsx
    },
    '.js': {
        functionNodes: ['function_declaration', 'method_definition', 'arrow_function'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'for_in_statement', 'switch_statement', 'try_statement'],
        callNodes: ['call_expression'],
        language: TypeScript.typescript
    },
    '.py': {
        functionNodes: ['function_definition'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'try_statement'],
        callNodes: ['call'],
        language: Python
    },
    '.java': {
        functionNodes: ['method_declaration', 'constructor_declaration'],
        nestingNodes: ['if_statement', 'for_statement', 'while_statement', 'enhanced_for_statement', 'switch_expression', 'try_statement'],
        callNodes: ['method_invocation'],
        language: Java
    }
};
