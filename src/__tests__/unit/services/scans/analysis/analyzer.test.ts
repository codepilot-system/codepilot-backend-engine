import { analyzeFileContents } from '../../../../../services/scans/analysis/analyzer';
import {
  computeCyclomaticComplexity,
  detectLongFunctions,
  detectHighComplexity,
  detectSRPViolations,
  detectDuplicates,
  collectFunctionRecords,
} from '../../../../../services/scans/analysis/detectors';
import { LANGUAGE_RULES } from '../../../../../services/scans/analysis/languages';
import { RawFinding, FunctionRecord } from '../../../../../services/scans/analysis/types';
import Parser from 'tree-sitter';

function parseCode(ext: string, code: string) {
  const rules = LANGUAGE_RULES[ext];
  const parser = new Parser();
  parser.setLanguage(rules.language);
  return { tree: parser.parse(code), rules };
}

describe('Analyzer', () => {
  describe('analyzeFileContents', () => {
    it('should analyze TypeScript files and detect long functions', () => {
      const lines = Array.from({ length: 160 }, (_, i) => `  console.log(${i});`).join('\n');
      const code = `function longFunction() {\n${lines}\n}`;
      const result = analyzeFileContents([{ filePath: 'test.ts', content: code }], 'local');

      expect(result.summary.totalFilesAnalyzed).toBe(1);
      expect(result.findings.some(f =>
        f.findings.some(finding => finding.issueType === 'LONG_FUNCTION')
      )).toBe(true);
    });

    it('should detect deep nesting in JavaScript', () => {
      const code = `
        function deeplyNested() {
          if (a) {
            if (b) {
              if (c) {
                if (d) {
                  if (e) { return true; }
                }
              }
            }
          }
        }
      `;
      const result = analyzeFileContents([{ filePath: 'test.js', content: code }]);
      expect(result.findings.some(f =>
        f.findings.some(finding => finding.issueType === 'DEEP_NESTING')
      )).toBe(true);
    });

    it('should detect high cyclomatic complexity', () => {
      const branches = Array.from({ length: 15 }, (_, i) => `if (x === ${i}) { y = ${i}; }`).join('\n  ');
      const code = `function complex() {\n  let y = 0;\n  ${branches}\n  return y;\n}`;
      const result = analyzeFileContents([{ filePath: 'test.ts', content: code }]);

      expect(result.findings.some(f =>
        f.findings.some(finding => finding.issueType === 'HIGH_COMPLEXITY')
      )).toBe(true);
    });

    it('should analyze Python files', () => {
      const code = `
def hello():
    print("hello")

def world():
    print("world")
`;
      const result = analyzeFileContents([{ filePath: 'test.py', content: code }]);
      expect(result.summary.totalFilesAnalyzed).toBe(1);
    });

    it('should analyze Java files', () => {
      const code = `
public class Test {
    public void hello() {
        System.out.println("hello");
    }
}
`;
      const result = analyzeFileContents([{ filePath: 'Test.java', content: code }]);
      expect(result.summary.totalFilesAnalyzed).toBe(1);
    });

    it('should handle empty files gracefully', () => {
      const result = analyzeFileContents([{ filePath: 'empty.ts', content: '' }]);
      expect(result.summary.totalFilesAnalyzed).toBe(1);
      expect(result.summary.totalFindings).toBe(0);
    });

    it('should handle malformed code without crashing', () => {
      const result = analyzeFileContents([{ filePath: 'broken.ts', content: 'function {{{' }]);
      expect(result.summary.totalFilesAnalyzed).toBe(1);
    });

    it('should skip unsupported file extensions', () => {
      const result = analyzeFileContents([
        { filePath: 'readme.md', content: '# Hello' },
        { filePath: 'valid.ts', content: 'const x = 1;' },
      ]);
      expect(result.summary.totalFilesAnalyzed).toBe(1);
    });

    it('should include analyzer version and scan type in output', () => {
      const result = analyzeFileContents([{ filePath: 'test.ts', content: 'const x = 1;' }], 'repo');
      expect(result.analyzerVersion).toBe('1.1.0');
      expect(result.scanType).toBe('repo');
    });

    it('should track total findings count', () => {
      const lines = Array.from({ length: 160 }, (_, i) => `  console.log(${i});`).join('\n');
      const code = `function longFunction() {\n${lines}\n}`;
      const result = analyzeFileContents([{ filePath: 'test.ts', content: code }]);
      expect(result.summary.totalFindings).toBeGreaterThan(0);
    });
  });
});

describe('Detectors', () => {
  it('should compute cyclomatic complexity for branching code', () => {
    const { tree, rules } = parseCode('.ts', `
      function cc() {
        if (a) return 1;
        if (b) return 2;
        return 0;
      }
    `);
    const fnNode = tree.rootNode.descendantsOfType('function_declaration')[0];
    const cc = computeCyclomaticComplexity(fnNode, rules);
    expect(cc).toBeGreaterThanOrEqual(2);
  });

  it('should detect duplicate code blocks', () => {
    const duplicateBlock = `
      const a = 1;
      const b = 2;
      const c = a + b;
      return c;
    `;
    const code = `
      function fn1() { ${duplicateBlock} }
      function fn2() { ${duplicateBlock} }
    `;
    const { tree, rules } = parseCode('.ts', code);
    const records: FunctionRecord[] = [];
    collectFunctionRecords(tree.rootNode, rules, 'test.ts', records);
    const raw: RawFinding[] = [];
    detectDuplicates(records, raw);

    expect(raw.some(r => r.issueType === 'DUPLICATE')).toBe(true);
  });

  it('should detect SRP violations from multiple concerns', () => {
    const code = `
      function doEverything() {
        console.log("logging");
        fetch("/api/data");
        fs.readFile("file.txt");
      }
    `;
    const { tree, rules } = parseCode('.ts', code);
    const raw: RawFinding[] = [];
    detectSRPViolations(tree.rootNode, rules, 'test.ts', raw);
    expect(raw.some(r => r.issueType === 'SRP_VIOLATION')).toBe(true);
  });

  it('should detect long functions via detector directly', () => {
    const lines = Array.from({ length: 160 }, (_, i) => `x(${i});`).join('\n');
    const code = `function longFn() {\n${lines}\n}`;
    const { tree, rules } = parseCode('.ts', code);
    const raw: RawFinding[] = [];
    detectLongFunctions(tree.rootNode, rules, 'test.ts', raw);
    expect(raw.some(r => r.issueType === 'LONG_FUNCTION')).toBe(true);
  });

  it('should detect high complexity via detector directly', () => {
    const branches = Array.from({ length: 12 }, (_, i) => `if (v === ${i}) { r = ${i}; }`).join('\n  ');
    const code = `function complex() {\n  let r = 0;\n  ${branches}\n  return r;\n}`;
    const { tree, rules } = parseCode('.ts', code);
    const raw: RawFinding[] = [];
    detectHighComplexity(tree.rootNode, rules, 'test.ts', raw);
    expect(raw.some(r => r.issueType === 'HIGH_COMPLEXITY')).toBe(true);
  });
});
