import Groq from 'groq-sdk';
import { ENV } from '../../config/env.config';
import { ApiError } from '../../lib/ApiError';
import { ScanIssue, AnalysisResult, CodeFile, ImportedFileSkeleton, ScanType } from './ai.types';
import { checkDailyQuota, recordDailyQuota, tripCircuitBreaker, getCircuitBreakerStatus, LOCAL_MODELS, REPO_MODELS, MODELS_BY_SCAN_TYPE, MODEL_TOKEN_LIMITS, COOLDOWN_MESSAGES, SUMMARY_MODEL } from './ai.limiter';

export type { ScanIssue, AnalysisResult, CodeFile, ImportedFileSkeleton, ScanType } from './ai.types';
export { LOCAL_MODELS, REPO_MODELS, getModelStatuses } from './ai.limiter';

const groqClient = new Groq({ apiKey: ENV.GROQ_API_KEY });
// Models that support chain-of-thought reasoning; we hide it to only get the final JSON output
const REASONING_MODELS = new Set([
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b',
  'openai/gpt-oss-120b',
]);

const SYSTEM_PROMPT = `You are an expert code reviewer. You MUST return ONLY valid JSON matching this exact structure, with no extra text or markdown:
{
  "issues": [
    {
      "filePath": "string",
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "category": "CODE_SMELL|DEAD_CODE|DUPLICATE|COMPLEXITY|SRP_VIOLATION|SECURITY|PERFORMANCE|FUNCTIONALITY|OTHER",
      "summary": "string",
      "explanation": "string",
      "affectedCodeSnippet": "string",
      "suggestedFixDiff": "string",
      "suggestedFixSummary": "string",
      "lineNumber": 0
    }
  ]
}

CRUCIAL INSTRUCTIONS FOR "suggestedFixDiff":
1. The "suggestedFixDiff" MUST be a valid unified diff patch that EXACTLY matches the original code!
2. Every line starting with "-" (removed lines) MUST be an EXACT copy of a line from the original file!
3. Every line starting with "+" (added lines) MUST be the exact fixed version of that line!
4. Include enough context lines (unmodified lines) to make the patch unambiguous!
5. Format the diff correctly with @@ lines showing line numbers!`;

const SUMMARY_SYSTEM_PROMPT = `You are an expert software architect. Analyze the provided codebase files and generate a concise architectural summary. Your summary MUST include:
1. Core frameworks, runtime, and language version
2. Design patterns used (e.g. service layer, repository pattern, middleware chain)
3. Global middleware, error handling, and authentication strategy
4. Coding conventions (naming, file organization, export style)
Do NOT include the folder structure tree or dependency lists.

You MUST return a JSON object with two fields:
{
  "detailed": "The full architectural summary as requested (under 1000 words)",
  "brief": "A 1-2 sentence extremely concise summary (e.g. 'NestJS TypeScript backend using Prisma and JWT')"
}`;



function parseAnalysisIssues(rawText: string): ScanIssue[] {
  try {
    const markdownMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);

    let jsonString = markdownMatch ? markdownMatch[1] : rawText;

    jsonString = jsonString.trim();

    if (!jsonString.startsWith('{') && !jsonString.startsWith('[')) {
      const startIndex = Math.min(
        jsonString.indexOf('{') !== -1 ? jsonString.indexOf('{') : Infinity,
        jsonString.indexOf('[') !== -1 ? jsonString.indexOf('[') : Infinity
      );
      const endIndex = Math.max(jsonString.lastIndexOf('}'), jsonString.lastIndexOf(']'));

      if (startIndex !== Infinity && endIndex !== -1)
        jsonString = jsonString.substring(startIndex, endIndex + 1);
    }

    const parsed = JSON.parse(jsonString) as { issues?: unknown[] };
    const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];

    return rawIssues.map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        filePath: String(item.filePath ?? item.filename ?? 'unknown'),
        severity: String(item.severity ?? 'MEDIUM') as ScanIssue['severity'],
        category: String(item.category ?? 'OTHER') as ScanIssue['category'],
        summary: String(item.summary ?? 'Issue detected'),
        explanation: String(item.explanation ?? ''),
        codeSnippet: String(item.affectedCodeSnippet ?? item.codeSnippet ?? ''),
        diffPatch: String(item.suggestedFixDiff ?? item.diffPatch ?? ''),
        suggestedFixSummary: String(item.suggestedFixSummary ?? item.fixSummary ?? item.summary ?? 'Apply fix'),
        lineNumber: typeof item.lineNumber === 'number' ? item.lineNumber : undefined,
      };
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON output from model: ${detail}`);
  }
}

async function runAnalysis(
  scanType: ScanType,
  files: CodeFile[],
  entityId: string,
  preferredModel?: string,
  projectSummary?: string,
  importedContext?: ImportedFileSkeleton[],
  folderTree?: string,
  dependencies?: string,
): Promise<AnalysisResult> {
  if (!files.length) throw new ApiError('At least one file is required for analysis', 400);

  const entityType = scanType === 'local' ? 'user' : 'project';

  if (preferredModel) {
    const allowed = scanType === 'repo' ? REPO_MODELS : LOCAL_MODELS;
    if (!(allowed as readonly string[]).includes(preferredModel))
      throw new ApiError(`Unsupported model. Choose from: ${allowed.join(', ')}`, 400);
  }

  const fileBlocks = files.map((f) => {
    if (f.selectedLines && f.selectedLines.length > 0) {
      const lines = f.content.split('\n');
      // Reverse-sort so splice insertions don't shift indices of earlier hunks
      const sortedHunks = [...f.selectedLines].sort((a, b) => b.start - a.start);
      for (const hunk of sortedHunks) {
        lines.splice(hunk.end, 0, `</snippet-to-analyze>`);
        lines.splice(Math.max(0, hunk.start - 1), 0, `<snippet-to-analyze>`);
      }
      return `<file path="${f.filePath}">\n${lines.join('\n')}\n</file>`;
    }
    return `<file path="${f.filePath}">\n${f.content}\n</file>`;
  }).join('\n\n');

  let prompt = `Analyze the following codebase for security vulnerabilities, bugs, cross-file issues, namings, and best practice violations.`;
  if (files.some(f => f.selectedLines && f.selectedLines.length > 0))
    prompt += `\nNOTE: You will see <snippet-to-analyze> tags marking recent modifications. Your primary focus is reviewing the code inside these tags. However, you MUST ALSO report any issues OUTSIDE the tags if they are a direct consequence of these modifications (e.g., changing a function signature that breaks a caller, or leaving an unused variable). Use the rest of the file context to identify these cascading issues.`;
  if (projectSummary) prompt += `\n\nProject Architecture Context (Use this to understand global conventions):\n${projectSummary}`;
  if (folderTree) prompt += `\n\nProject Folder Structure:\n${folderTree}`;
  if (dependencies) prompt += `\n\nInstalled Dependencies:\n${dependencies}`;
  if (importedContext?.length) {
    const contextBlocks = importedContext
      .map((ctx) => `<imported-context path="${ctx.filePath}">\n${ctx.skeleton}\n</imported-context>`)
      .join('\n\n');
    prompt += `\n\nDirect Dependencies (exported signatures of files imported by the analyzed code — use for cross-file type checking):\n${contextBlocks}`;
  }
  prompt += `\n\nCode to analyze:\n${fileBlocks}`;

  // Conservative estimate: code averages ~3.2 chars/token (denser than English prose at ~4 chars/token)
  const inputTokens = Math.ceil((SYSTEM_PROMPT.length + prompt.length) / 3.2);
  const maxOutput = scanType === 'repo' ? 4000 : 1500;
  let lastError: unknown = null;

  let models = [...MODELS_BY_SCAN_TYPE[scanType]];
  if (preferredModel) models = [preferredModel, ...models.filter(m => m !== preferredModel)];

  for (const model of models) {
    const cb = await getCircuitBreakerStatus(model);
    if (cb) {
      lastError = new ApiError(`Model ${model} is currently unavailable (${cb})`, 503);
      continue;
    }

    if (inputTokens + maxOutput > MODEL_TOKEN_LIMITS[model]) {
      lastError = new ApiError(`Payload too large for model ${model}`, 413);
      continue;
    }

    const hasQuota = await checkDailyQuota(entityId, entityType, model, inputTokens + maxOutput);
    if (!hasQuota) {
      lastError = new ApiError(`Quota exceeded for model ${model}`, 429);
      continue;
    }

    try {
      const startTime = Date.now();
      const response = await groqClient.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: maxOutput,
        ...(REASONING_MODELS.has(model) && { reasoning_format: 'hidden' }),
      } as any) as any;

      const rawText = response.choices[0]?.message?.content ?? '';
      if (!rawText) {
        lastError = new ApiError('Model returned an empty response', 503);
        continue;
      }

      let issues: ScanIssue[];
      try {
        issues = parseAnalysisIssues(rawText);
      } catch (parseError) {
        lastError = parseError;
        continue;
      }

      const tokensUsed = response.usage?.total_tokens ?? 0;
      const durationMs = Date.now() - startTime;

      await recordDailyQuota(entityId, entityType, model, tokensUsed);
      return { issues, modelUsed: model, tokensUsed, durationMs };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error;
      await tripCircuitBreaker(model, error);
    }
  }

  throw lastError instanceof ApiError
    ? lastError
    : new ApiError('All AI models are currently overwhelmed or out of quota. Please try again later.', 503);
}

export function analyzeLocalScan(files: CodeFile[], userId: string, preferredModel?: string, projectBrief?: string): Promise<AnalysisResult> {
  if (!userId) throw new ApiError('A valid user ID is required to perform a local scan.', 400);
  return runAnalysis('local', files, userId, preferredModel, projectBrief);
}

export function analyzeRepoScan(files: CodeFile[], projectId: string, preferredModel?: string, projectSummary?: string, importedContext?: ImportedFileSkeleton[], folderTree?: string, dependencies?: string)
  : Promise<AnalysisResult> {
  if (!projectId) throw new ApiError('A valid project ID is required to perform a repo scan.', 400);
  return runAnalysis('repo', files, projectId, preferredModel, projectSummary, importedContext, folderTree, dependencies);
}

export async function generateProjectSummary(files: CodeFile[], folderTree?: string, dependencies?: string): Promise<{ summary: string; brief: string; modelUsed: string; tokensUsed: number; durationMs: number }> {
  if (!files.length) throw new ApiError('At least one file is required for summarization', 400);

  const model = SUMMARY_MODEL;

  const cb = await getCircuitBreakerStatus(model);
  if (cb) {
    const cooldown = COOLDOWN_MESSAGES[cb === 'daily' ? 'daily' : 'minute'];
    throw new ApiError(`The summary model is ${cooldown}.`, 503);
  }

  const fileBlocks = files.map((f) => `<file path="${f.filePath}">\n${f.content}\n</file>`).join('\n\n');
  let prompt = `Generate a project architecture summary based on the following context.`;
  if (folderTree) prompt += `\n\nProject Folder Structure:\n${folderTree}`;
  if (dependencies) prompt += `\n\nInstalled Dependencies:\n${dependencies}`;
  prompt += `\n\nKey Files:\n${fileBlocks}`;

  const maxOutput = 2000;

  try {
    const startTime = Date.now();
    const response = await groqClient.chat.completions.create({
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: maxOutput,
    });

    const rawText = response.choices[0]?.message?.content ?? '';
    if (!rawText) throw new ApiError('Summary model returned an empty response', 503);

    let jsonString = rawText;
    const markdownMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (markdownMatch) jsonString = markdownMatch[1];
    jsonString = jsonString.trim();

    let detailed = '';
    let brief = '';
    try {
      const parsed = JSON.parse(jsonString) as { detailed?: string, brief?: string };
      detailed = parsed.detailed ?? 'Failed to generate detailed summary.';
      brief = parsed.brief ?? 'Failed to generate brief summary.';
    } catch {
      throw new ApiError('Invalid JSON format from summary model', 500);
    }

    const tokensUsed = response.usage?.total_tokens ?? 0;
    const durationMs = Date.now() - startTime;

    return { summary: detailed.trim(), brief: brief.trim(), modelUsed: model, tokensUsed, durationMs };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    await tripCircuitBreaker(model, error);
    throw new ApiError('Failed to generate project summary. Please try again later.', 503);
  }
}
