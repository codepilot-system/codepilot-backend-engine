import Groq from 'groq-sdk';
import { analyzeLocalScan, analyzeRepoScan, applyBulkFixes, generateProjectSummary } from '../../../../services/ai/ai.service';
import { ApiError } from '../../../../lib/ApiError';
import * as aiLimiter from '../../../../services/ai/ai.limiter';

jest.mock('../../../../lib/prisma');

jest.mock('../../../../config/env.config', () => ({
  ENV: { GROQ_API_KEY: 'test-key' }
}));

jest.mock('groq-sdk', () => {
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
    mockCreate,
  };
});

jest.mock('../../../../services/ai/ai.limiter', () => ({
  checkDailyQuota: jest.fn(),
  recordDailyQuota: jest.fn(),
  tripCircuitBreaker: jest.fn(),
  getCircuitBreakerStatus: jest.fn(),
  LOCAL_MODELS: ['local-model-1', 'local-model-2'],
  REPO_MODELS: ['repo-model-1'],
  MODELS_BY_SCAN_TYPE: { local: ['local-model-1', 'local-model-2'], repo: ['repo-model-1'] },
  MODEL_TOKEN_LIMITS: { 'local-model-1': 8000, 'local-model-2': 8000, 'repo-model-1': 80000, 'summary-model': 80000 },
  COOLDOWN_MESSAGES: { daily: 'daily cooldown', minute: 'minute cooldown' },
  SUMMARY_MODEL: 'summary-model',
}));

const groqModule = jest.requireMock<{ mockCreate: jest.Mock }>('groq-sdk');
const mockCreate = groqModule.mockCreate;

describe('AI Service', () => {
  const mockCheckDailyQuota = aiLimiter.checkDailyQuota as jest.Mock;
  const mockRecordDailyQuota = aiLimiter.recordDailyQuota as jest.Mock;
  const mockTripCircuitBreaker = aiLimiter.tripCircuitBreaker as jest.Mock;
  const mockGetCircuitBreakerStatus = aiLimiter.getCircuitBreakerStatus as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCircuitBreakerStatus.mockResolvedValue(null);
    mockCheckDailyQuota.mockResolvedValue(true);
  });

  describe('analyzeLocalScan', () => {
    it('should throw an error if no user ID is provided', () => {
      expect(() => analyzeLocalScan([{ filePath: 'test.ts', content: 'code' }], '')).toThrow(ApiError);
    });
    
    it('should throw an error if no files are provided', async () => {
      await expect(analyzeLocalScan([], 'user1')).rejects.toThrow(ApiError);
    });

    it('should throw an error if preferredModel is unsupported', async () => {
      await expect(analyzeLocalScan([{ filePath: 'test.ts', content: 'code' }], 'user1', 'unsupported-model')).rejects.toThrow(ApiError);
    });

    it('should throw an error if model circuit breaker is tripped', async () => {
      mockGetCircuitBreakerStatus.mockResolvedValue('daily');
      await expect(analyzeLocalScan([{ filePath: 'test.ts', content: 'code' }], 'user1')).rejects.toThrow(ApiError);
    });

    it('should throw an error if payload is too large', async () => {
      const largeContent = 'a'.repeat(30000);
      await expect(analyzeLocalScan([{ filePath: 'test.ts', content: largeContent }], 'user1')).rejects.toThrow(ApiError);
    });

    it('should throw an error if quota is exceeded', async () => {
      mockCheckDailyQuota.mockResolvedValue(false);
      await expect(analyzeLocalScan([{ filePath: 'test.ts', content: 'code' }], 'user1')).rejects.toThrow(ApiError);
    });

    it('should handle model returning empty response and fallback or throw', async () => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
      await expect(analyzeLocalScan([{ filePath: 'test.ts', content: 'code' }], 'user1')).rejects.toThrow(ApiError);
    });

    it('should parse valid JSON response successfully', async () => {
      const fakeResponse = {
        issues: [
          {
            filePath: 'test.ts',
            severity: 'HIGH',
            category: 'SECURITY',
            summary: 'A bug',
            explanation: 'It is bad',
            affectedCodeSnippet: 'console.log()',
            suggestedFixDiff: '+console.error()',
            suggestedFixSummary: 'Use error',
            lineNumber: 10
          }
        ]
      };
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(fakeResponse) } }],
        usage: { total_tokens: 100 }
      });
      const result = await analyzeLocalScan([{ filePath: 'test.ts', content: 'code' }], 'user1');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].summary).toBe('A bug');
      expect(result.tokensUsed).toBe(100);
      expect(mockRecordDailyQuota).toHaveBeenCalledWith('user1', 'user', 'local-model-1', 100);
    });

    it('should parse valid JSON response embedded in markdown successfully', async () => {
      const fakeResponse = {
        issues: [
          {
            filePath: 'test.ts',
            severity: 'MEDIUM',
            category: 'CODE_SMELL',
            summary: 'A code smell'
          }
        ]
      };
      const markdownResponse = `Here are the issues:\n\`\`\`json\n${JSON.stringify(fakeResponse)}\n\`\`\``;
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: markdownResponse } }],
        usage: { total_tokens: 50 }
      });
      const result = await analyzeLocalScan([{ filePath: 'test.ts', content: 'code' }], 'user1');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].summary).toBe('A code smell');
    });

    it('should handle malformed JSON gracefully (trip circuit breaker and fallback/throw)', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'invalid json' } }]
      });
      await expect(analyzeLocalScan([{ filePath: 'test.ts', content: 'code' }], 'user1')).rejects.toThrow();
    });

    it('should fallback to the next model if the first fails', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Model error')).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ issues: [] }) } }],
        usage: { total_tokens: 50 }
      });
      
      const result = await analyzeLocalScan([{ filePath: 'test.ts', content: 'code' }], 'user1');
      expect(result.issues).toHaveLength(0);
      expect(result.modelUsed).toBe('local-model-2');
    });

    it('should properly format prompt with selectedLines', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ issues: [] }) } }],
        usage: { total_tokens: 50 }
      });
      const files = [{
        filePath: 'test.ts',
        content: 'line1\nline2\nline3',
        selectedLines: [{ start: 2, end: 2 }]
      }];
      await analyzeLocalScan(files, 'user1');
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain('<snippet-to-analyze>');
    });
  });

  describe('analyzeRepoScan', () => {
    it('should throw an error if no project ID is provided', () => {
      expect(() => analyzeRepoScan([{ filePath: 'test.ts', content: 'code' }], '')).toThrow(ApiError);
    });

    it('should process a successful repo scan with extra context', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ issues: [] }) } }],
        usage: { total_tokens: 150 }
      });
      const result = await analyzeRepoScan(
        [{ filePath: 'test.ts', content: 'code' }],
        'proj1',
        undefined,
        'Project summary',
        [{ filePath: 'dep.ts', skeleton: 'export const a = 1;' }],
        'src/',
        'deps'
      );
      expect(result.issues).toEqual([]);
      expect(mockRecordDailyQuota).toHaveBeenCalledWith('proj1', 'project', 'repo-model-1', 150);
      
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain('Project Architecture Context');
      expect(callArgs.messages[1].content).toContain('Project Folder Structure');
      expect(callArgs.messages[1].content).toContain('Installed Dependencies');
      expect(callArgs.messages[1].content).toContain('Direct Dependencies');
    });
  });

  describe('applyBulkFixes', () => {
    it('should handle successful fix application', async () => {
      const mockResponse = {
        modifiedFile: 'new content',
        appliedSuggestionIds: [1],
        failedSuggestions: []
      };
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
        usage: { total_tokens: 200 }
      });
      const suggestions = [{ id: 1, diffPatch: '+code', summary: 'fix' }];
      const result = await applyBulkFixes('test.ts', 'old content', suggestions);
      
      expect(result.modifiedFile).toBe('new content');
      expect(result.appliedSuggestionIds).toEqual([1]);
      expect(result.failedSuggestions).toEqual([]);
      expect(result.tokensUsed).toBe(200);
    });

    it('should skip model if circuit breaker is tripped', async () => {
      mockGetCircuitBreakerStatus.mockResolvedValue('minute');
      const suggestions = [{ id: 1, diffPatch: '+code', summary: 'fix' }];
      const result = await applyBulkFixes('test.ts', 'old content', suggestions);
      
      expect(result.appliedSuggestionIds).toHaveLength(0);
      expect(result.failedSuggestions).toHaveLength(1);
      expect(result.failedSuggestions[0].reason).toBe('All AI models failed to apply fixes');
    });

    it('should extract JSON from markdown formatting', async () => {
      const mockResponse = {
        modifiedFile: 'new content',
        appliedSuggestionIds: [1],
        failedSuggestions: []
      };
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(mockResponse)}\n\`\`\`` } }],
        usage: { total_tokens: 200 }
      });
      const result = await applyBulkFixes('test.ts', 'old content', [{ id: 1, diffPatch: '+code', summary: 'fix' }]);
      expect(result.modifiedFile).toBe('new content');
    });

    it('should trip circuit breaker on unhandled error', async () => {
      mockCreate.mockRejectedValue(new Error('Network error'));
      const result = await applyBulkFixes('test.ts', 'old content', [{ id: 1, diffPatch: '+code', summary: 'fix' }]);
      expect(mockTripCircuitBreaker).toHaveBeenCalled();
      expect(result.failedSuggestions[0].reason).toBe('All AI models failed to apply fixes');
    });
  });

  describe('generateProjectSummary', () => {
    it('should throw an error if no files are provided', async () => {
      await expect(generateProjectSummary([])).rejects.toThrow(ApiError);
    });

    it('should throw an error if model circuit breaker is tripped', async () => {
      mockGetCircuitBreakerStatus.mockResolvedValue('daily');
      await expect(generateProjectSummary([{ filePath: 'test.ts', content: 'code' }])).rejects.toThrow(ApiError);
    });

    it('should handle successful summary generation', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ detailed: 'Det', brief: 'Br' }) } }],
        usage: { total_tokens: 300 }
      });
      const result = await generateProjectSummary([{ filePath: 'test.ts', content: 'code' }], 'tree', 'deps');
      expect(result.summary).toBe('Det');
      expect(result.brief).toBe('Br');
      expect(result.tokensUsed).toBe(300);
      
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain('Project Folder Structure');
      expect(callArgs.messages[1].content).toContain('Installed Dependencies');
    });

    it('should handle empty response', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '' } }]
      });
      await expect(generateProjectSummary([{ filePath: 'test.ts', content: 'code' }])).rejects.toThrow(ApiError);
    });

    it('should handle malformed JSON format', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'invalid json' } }]
      });
      await expect(generateProjectSummary([{ filePath: 'test.ts', content: 'code' }])).rejects.toThrow(ApiError);
    });
  });
});
