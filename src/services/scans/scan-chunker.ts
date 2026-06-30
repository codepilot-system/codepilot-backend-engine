import { CodeFile, AnalysisResult, ScanIssue } from '../ai/ai.types';
import { analyzeRepoScan } from '../ai/ai.service';

const CHUNK_CHAR_BUDGET = 350_000;

const CHUNK_MAX_FILES = 10;

export interface RepoScanChunkResult {
    issues: ScanIssue[];
    tokensUsed: number;
    durationMs: number;
    modelUsed: string;
    chunkCount: number;
    failedChunks: number;
}

export async function analyzeRepoInChunks(
    files: CodeFile[],
    projectId: string,
    projectSummary: string | undefined,
    folderTree: string | undefined,
    dependencies: string | undefined,
    preferredModel?: string,
): Promise<RepoScanChunkResult> {
    const chunks = buildChunks(files);

    console.log(`[Chunker] ${files.length} file(s) split into ${chunks.length} chunk(s)`);

    const allIssues: ScanIssue[] = [];
    let totalTokens = 0;
    let totalDuration = 0;
    const modelsUsed = new Set<string>();
    let failedChunks = 0;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`[Chunker] Running AI on chunk ${i + 1}/${chunks.length} (${chunk.length} file(s))`);

        try {
            const result: AnalysisResult = await analyzeRepoScan(
                chunk,
                projectId,
                preferredModel,
                projectSummary,
                undefined,
                folderTree,
                dependencies,
            );

            allIssues.push(...result.issues);
            totalTokens += result.tokensUsed;
            totalDuration += result.durationMs;
            modelsUsed.add(result.modelUsed);

            console.log(`[Chunker] Chunk ${i + 1} succeeded: ${result.issues.length} issue(s), ${result.tokensUsed} tokens`);
        } catch (error) {
            failedChunks++;
            const reason = error instanceof Error ? error.message : String(error);
            const filePaths = chunk.map((f) => f.filePath).join(', ');
            console.error(`[Chunker] Chunk ${i + 1}/${chunks.length} failed — skipping. Reason: ${reason}. Files: ${filePaths}`);
        }
    }

    const succeededChunks = chunks.length - failedChunks;
    console.log(`[Chunker] Done: ${succeededChunks}/${chunks.length} chunk(s) succeeded, ${failedChunks} failed, ${allIssues.length} total issue(s)`);

    // If every single chunk failed there is nothing useful to return — let the pipeline decide
    if (succeededChunks === 0) {
        throw new Error(`All ${chunks.length} AI chunk(s) failed. The scan cannot be completed.`);
    }

    const modelUsed = modelsUsed.size === 1
        ? [...modelsUsed][0]
        : [...modelsUsed].join('+');

    return {
        issues: allIssues,
        tokensUsed: totalTokens,
        durationMs: totalDuration,
        modelUsed,
        chunkCount: chunks.length,
        failedChunks,
    };
}

function buildChunks(files: CodeFile[]): CodeFile[][] {
    const chunks: CodeFile[][] = [];
    let currentChunk: CodeFile[] = [];
    let currentCharCount = 0;

    for (const file of files) {
        const fileCharCount = file.content.length;

        const wouldExceedBudget = currentCharCount + fileCharCount > CHUNK_CHAR_BUDGET;
        const wouldExceedFileLimit = currentChunk.length >= CHUNK_MAX_FILES;

        if (currentChunk.length > 0 && (wouldExceedBudget || wouldExceedFileLimit)) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentCharCount = 0;
        }


        currentChunk.push(file);
        currentCharCount += fileCharCount;
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}
