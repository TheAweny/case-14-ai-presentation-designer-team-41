import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import {
  materialResearchInputSchema,
  materialResearchSourceSchema,
  materialResearchAnswerSchema,
  materialResearchResultSchema,
  type MaterialResearchResult,
  type MaterialResearchSource,
} from '@lct/contracts';
import { loadAgent, toManifestEntry, type LoadedAgent } from '@lct/registry';
import type { ChatModel } from './chat-model.js';
import { fitChatContext } from './context-budget.js';
import { parseModelJson } from '../generation/provider.js';

const depth = new AsyncLocalStorage<boolean>();
const DEADLINE_MS = 30000;

export function loadMaterialResearchAgent(registryDir: string): Promise<LoadedAgent> {
  return loadAgent(join(registryDir, 'material-researcher'));
}

export interface MaterialResearchOptions {
  readonly question: string;
  readonly sources: readonly MaterialResearchSource[];
  readonly model: ChatModel;
  readonly agent: LoadedAgent;
  readonly signal: AbortSignal;
  readonly seed?: number;
  readonly modelRevision?: string;
}

/** A single isolated model step; only exact excerpts survive into the parent conversation. */
export async function researchMaterials(
  options: MaterialResearchOptions,
): Promise<MaterialResearchResult> {
  if (depth.getStore()) throw new Error('Nested material research is not allowed.');
  options.signal.throwIfAborted();
  const sources = options.sources.map((source) => materialResearchSourceSchema.parse(source));
  const input = materialResearchInputSchema.parse({
    question: options.question,
    fileIds: sources.map((source) => source.sourceId),
  });
  if (new Set(input.fileIds).size !== sources.length) throw new Error('Source ids must be unique.');
  const messages = fitChatContext(
    [
      { role: 'system', content: options.agent.instructions },
      { role: 'user', content: JSON.stringify({ question: input.question, sources }) },
    ],
    [],
    undefined,
    options.model.contextOverheadChars ?? 0,
  );

  return depth.run(true, async () => {
    const timerController = new AbortController();
    const timer = setTimeout(
      () => timerController.abort(new Error('Material research timed out.')),
      DEADLINE_MS,
    );
    const signal = AbortSignal.any([options.signal, timerController.signal]);
    let abort: () => void = () => undefined;
    try {
      // Stop even when an injected provider ignores cancellation. No tool can run in the child.
      const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      const step = await Promise.race([
        options.model.step({ messages, tools: [], signal }),
        cancelled,
      ]);
      signal.throwIfAborted();
      if (
        step.truncated ||
        step.toolCalls.length ||
        (step.finishReason !== undefined && step.finishReason !== 'stop')
      ) {
        throw new Error('The material researcher returned an incomplete answer.');
      }
      const answer = parseModelJson(step.text, materialResearchAnswerSchema);
      const evidence: MaterialResearchResult['evidence'] = [];
      let rejected = false;
      for (const excerpt of answer.excerpts) {
        const source = sources.find((item) => item.sourceId === excerpt.sourceId);
        const localStart = source?.text.indexOf(excerpt.quote) ?? -1;
        const start = source && localStart >= 0 ? (source.offset ?? 0) + localStart : -1;
        if (!source || start < 0 || !excerpt.quote.trim()) {
          rejected = true;
          continue;
        }
        if (
          evidence.some((item) => item.sourceId === source.sourceId && item.quote === excerpt.quote)
        )
          continue;
        evidence.push({
          sourceId: source.sourceId,
          name: source.name,
          quote: excerpt.quote,
          start,
          support: 'unverified',
        });
      }
      const openQuestions = [...answer.openQuestions];
      if (!evidence.length)
        openQuestions.push('Исследователь не вернул проверяемую цитату для ответа.');
      if (rejected)
        openQuestions.push(
          'Часть цитат исследователя не найдена в исходных материалах и отброшена.',
        );
      const manifest = toManifestEntry(options.agent);
      const result = materialResearchResultSchema.parse({
        outputTruncated: false,
        summary: evidence.map((item) => item.quote).join('\n'),
        evidence,
        openQuestions,
        coverage: sources.map((source) => ({
          sourceId: source.sourceId,
          offset: source.offset ?? 0,
          readChars: source.text.length,
          truncated: source.truncated,
          nextOffset: source.truncated ? (source.offset ?? 0) + source.text.length : null,
        })),
        manifest: {
          agentId: manifest.agentId,
          agentVersion: manifest.agentVersion,
          instructionsSha256: manifest.instructionsSha256,
          model: options.model.model,
          modelRevision: options.modelRevision ?? null,
          seed: options.seed ?? null,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
        },
      });
      // Stay below the parent's generic clipping boundary, keeping evidence structured.
      while (JSON.stringify(result).length > 10000) {
        result.outputTruncated = true;
        if (result.evidence.length) {
          result.evidence.pop();
          result.summary = result.evidence.map((item) => item.quote).join('\n');
        } else if (result.openQuestions.length) {
          result.openQuestions.pop();
        } else {
          throw new Error('Material research metadata exceeds the output limit.');
        }
      }
      return result;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  });
}
