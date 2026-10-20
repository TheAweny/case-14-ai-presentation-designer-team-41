import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ChatEvent, ChatMessage, ChatMode, ChatPart } from '@lct/contracts';
import { chatToolActivitySchema, type ChatToolActivity } from '@lct/contracts';
import { loadAgent, type LoadedAgent } from '@lct/registry';
import type { ChatModel, ModelMessage, ToolSpec } from './chat-model.js';
import { ChatToolDispatcher } from './tool-runtime.js';
import { parseArguments } from './tool-arguments.js';
import { ContextBudgetExceededError, fitChatContext } from './context-budget.js';
import { loadRuntimeAgent } from '../runtime-limits.js';
export { lenientJson, mendedArguments } from './tool-arguments.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the chat numbers it. */
export type ChatEventBody = DistributiveOmit<ChatEvent, 'seq'>;

/** What a tool gave back: what the model reads, and whether the turn ends here. */
export interface ToolOutcome {
  readonly output: unknown;
  /** The turn waits for the person now: a question, a plan to approve. */
  readonly stop?: boolean;
  readonly failed?: boolean;
}

export interface ToolContext {
  readonly signal: AbortSignal;
  readonly callId: string;
  /** Put a part into the answer, after the text said so far. Returns its index. */
  show(part: ChatPart): number;
  /** Replace a part shown earlier: a build moving on, a plan approved. */
  update(index: number, part: ChatPart): void;
  /**
   * Upsert one nested step of this call by `id`. Ignored after the call has finished, and a
   * finished step is not reopened. The part index stays the render key; `callId` is the model id.
   */
  activity?(activity: ChatToolActivity): void;
}

/**
 * A tool of the chat agent. What it is for, as the model reads it, lives in the registry next to
 * the agent; here are its input and what it does.
 */
export interface ChatTool {
  readonly name: string;
  readonly input: z.ZodType;
  /** Modes in which the model is offered the tool. */
  readonly modes: readonly ChatMode[];
  run(input: unknown, context: ToolContext): Promise<ToolOutcome>;
}

/** The chat agent from the registry: its prompts, one per mode, and the descriptions of its tools. */
export interface ChatAgent {
  readonly agent: LoadedAgent;
  /** Fingerprint of all selected registry prompt modules, including tool descriptions. */
  readonly promptsSha256?: string;
  readonly modes: Readonly<Record<ChatMode, string>>;
  readonly tools: Readonly<Record<string, string>>;
  readonly jsonMode: string;
  /** Said to the model after an answer that looped was cut off. */
  readonly loopNudge: string;
  /** Said on the last step, when tools are closed and the turn must end in an answer. */
  readonly finalizeNudge: string;
}

export const CHAT_AGENT_ID = 'chat-assistant';

export async function loadChatAgent(registryDir: string): Promise<ChatAgent> {
  const directory = join(registryDir, CHAT_AGENT_ID);
  const agent = await loadAgent(directory);
  const runtimeAgent = await loadRuntimeAgent(registryDir);
  const read = (...path: string[]) => readFile(join(directory, ...path), 'utf8');
  const [chat, plan, auto, jsonMode, loopNudge, finalizeNudge] = await Promise.all([
    read('modes', 'chat.md'),
    read('modes', 'plan.md'),
    read('modes', 'auto.md'),
    read('json-mode.md'),
    read('loop-nudge.md'),
    read('finalize.md'),
  ]);
  const toolFiles = (await readdir(join(directory, 'tools')))
    .filter((name) => name.endsWith('.md'))
    .sort();
  const tools = Object.fromEntries(
    await Promise.all(
      toolFiles.map(async (file) => [file.slice(0, -3), (await read('tools', file)).trim()]),
    ),
  );
  return {
    agent,
    promptsSha256: createHash('sha256')
      .update(
        JSON.stringify({
          instructions: agent.instructions,
          runtime: {
            version: runtimeAgent.config.version,
            instructions: runtimeAgent.instructions,
          },
          chat,
          plan,
          auto,
          jsonMode,
          loopNudge,
          finalizeNudge,
          tools,
        }),
      )
      .digest('hex'),
    modes: { chat, plan, auto },
    tools,
    jsonMode,
    loopNudge: loopNudge.trim(),
    finalizeNudge: finalizeNudge.trim(),
  };
}

/** The system prompt of a turn: the agent, its mode, and the facts of this chat as data. */
export function chatInstructions(agent: ChatAgent, mode: ChatMode, facts: unknown): string {
  return [
    agent.agent.instructions.trim(),
    agent.modes[mode].trim(),
    JSON.stringify({ facts }),
  ].join('\n\n');
}

/** The tools the model is offered in a mode, with their descriptions from the registry. */
export function toolSpecs(agent: ChatAgent, tools: readonly ChatTool[]): ToolSpec[] {
  return tools.map((tool) => {
    const description = agent.tools[tool.name];
    if (!description) throw new Error(`The registry does not describe the tool ${tool.name}.`);
    const { $schema: _schema, ...parameters } = z.toJSONSchema(tool.input, {
      target: 'draft-7',
      io: 'input',
    }) as Record<string, unknown>;
    return { name: tool.name, description, parameters };
  });
}

/** What a tool result may weigh in the conversation; a longer one is cut. */
const MAX_OUTPUT_CHARS = 12000;

function clipped(output: unknown): unknown {
  const text = JSON.stringify(output ?? null);
  return text.length <= MAX_OUTPUT_CHARS ? output : { truncated: text.slice(0, MAX_OUTPUT_CHARS) };
}

const MAX_TOOL_ACTIVITIES = 32;

function asTool(part: ChatPart | undefined): Extract<ChatPart, { type: 'tool' }> | undefined {
  return part?.type === 'tool' ? part : undefined;
}

/**
 * Nested steps of one tool call. A finished step is not started again. Past 32, the oldest
 * finished step makes room; a running step is never dropped.
 */
export function mergeToolActivity(
  part: Extract<ChatPart, { type: 'tool' }>,
  activity: ChatToolActivity,
): Extract<ChatPart, { type: 'tool' }> | undefined {
  if (part.status !== 'running') return undefined;
  const parsed = chatToolActivitySchema.safeParse(activity);
  if (!parsed.success) return undefined;
  const next = parsed.data;
  const activities = [...(part.activities ?? [])];
  const at = activities.findIndex((item) => item.id === next.id);
  if (at >= 0) {
    const current = activities[at];
    if (!current || current.status !== 'running') return undefined;
    activities[at] = next;
    return { ...part, activities };
  }
  if (activities.length >= MAX_TOOL_ACTIVITIES) {
    const evict = activities.findIndex((item) => item.status !== 'running');
    if (evict < 0) return undefined;
    activities.splice(evict, 1);
  }
  activities.push(next);
  return { ...part, activities };
}

/**
 * Give a tool call a terminal status. Already finished nested steps stay as they are. A call that
 * itself already finished only closes nested steps still marked running.
 */
export function closeToolPart(
  part: Extract<ChatPart, { type: 'tool' }>,
  status: 'done' | 'failed',
  output: unknown,
  childStatus: 'done' | 'failed' | 'cancelled',
): Extract<ChatPart, { type: 'tool' }> {
  const finishedAt = Date.now();
  const activities = part.activities?.map((item) =>
    item.status === 'running'
      ? { ...item, status: childStatus, finishedAt: item.finishedAt ?? finishedAt }
      : item,
  );
  if (part.status !== 'running') {
    if (!part.activities?.some((item) => item.status === 'running')) return part;
    return { ...part, activities, finishedAt: part.finishedAt ?? finishedAt };
  }
  return { ...part, status, output, finishedAt, activities };
}

/**
 * The assistant message of a turn as it grows. Text streams into the current text part; a part a
 * tool shows closes it, so the text after the part starts a new one. Every change is an event.
 */
export class AnswerWriter {
  readonly parts: ChatPart[] = [];
  private textIndex: number | null = null;

  constructor(
    readonly messageId: string,
    private readonly emit: (event: ChatEventBody) => void,
  ) {}

  text(delta: string): void {
    if (!delta) return;
    if (this.textIndex === null) this.textIndex = this.show({ type: 'text', text: '' });
    const index = this.textIndex;
    const part = this.parts[index];
    if (part?.type !== 'text') return;
    this.parts[index] = { type: 'text', text: part.text + delta };
    this.textIndex = index;
    this.emit({ type: 'text-delta', messageId: this.messageId, index, delta });
  }

  show(part: ChatPart): number {
    this.textIndex = null;
    this.parts.push(part);
    const index = this.parts.length - 1;
    this.emit({ type: 'part', messageId: this.messageId, index, part });
    return index;
  }

  update(index: number, part: ChatPart): void {
    this.parts[index] = part;
    this.emit({ type: 'part', messageId: this.messageId, index, part });
  }

  /** The text part being written and what it says; null when the next text starts a new one. */
  get openText(): { index: number; text: string } | null {
    const index = this.textIndex;
    const part = index === null ? undefined : this.parts[index];
    return index !== null && part?.type === 'text' ? { index, text: part.text } : null;
  }

  /** Take back what streamed into a text part after `text`: the part says `text` again. */
  retract(index: number, text: string): void {
    this.update(index, { type: 'text', text });
    this.textIndex = text ? index : null;
  }
}

/** How long a stretch must be to count as the model saying it again. */
const LOOP_CHARS = 160;

/**
 * The answer began repeating itself: its last stretch already appears earlier. A model that
 * reasons aloud can circle through the same paragraph until its token limit.
 */
export function looping(text: string): boolean {
  if (text.length < LOOP_CHARS * 2) return false;
  const tail = text.slice(-LOOP_CHARS);
  return text.lastIndexOf(tail, text.length - LOOP_CHARS - 1) >= 0;
}

class LoopCut extends Error {
  constructor() {
    super('The answer repeated itself and was cut off.');
  }
}

export interface ChatTurnOptions {
  readonly model: ChatModel;
  readonly instructions: string;
  /** Refreshed trusted deployment facts, including remaining tool quota, before each model step. */
  readonly runtimeInstructions?: (remainingSteps: number) => string;
  /** The conversation before this turn, the new message included. */
  readonly history: readonly ModelMessage[];
  readonly tools: readonly ChatTool[];
  readonly specs: readonly ToolSpec[];
  readonly writer: AnswerWriter;
  readonly signal: AbortSignal;
  /** Model answers in one turn: a model looping over tools stops here. */
  readonly maxSteps?: number;
  /** Rechecked by the runtime before each dispatch, independently of model instructions. */
  readonly mode: ChatMode;
  /** Said to the model once when its answer loops; without it a looping answer ends the turn. */
  readonly loopNudge?: string;
  /**
   * Trusted system text for the last model step. That step offers no tools and counts inside
   * maxSteps. Omit it and every step, including the last, may still call tools.
   */
  readonly finalizeNudge?: string;
  /** Tokens the turn has spent so far, called as they grow. */
  readonly onUsage?: (usage: ChatUsage) => void;
}

export interface ChatUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Rough on purpose: Russian text and JSON both run near three characters a token. */
const CHARS_PER_TOKEN = 3;

/**
 * Tokens of a turn as the person watches them grow. While a step streams it counts an estimate
 * from characters; once the server reports the step's usage, that replaces the estimate.
 */
class TurnUsage {
  private input = 0;
  private output = 0;
  private stepInput = 0;
  private stepChars = 0;

  constructor(private readonly report?: (usage: ChatUsage) => void) {}

  begin(contextChars: number): void {
    this.stepInput = Math.round(contextChars / CHARS_PER_TOKEN);
    this.stepChars = 0;
    this.emit();
  }

  generated(characters: number): void {
    this.stepChars += characters;
    this.emit();
  }

  /** The step is over. A server that reported nothing leaves its estimate in the total. */
  settle(step?: ChatUsage): void {
    this.input += step?.inputTokens || this.stepInput;
    this.output += step?.outputTokens || Math.round(this.stepChars / CHARS_PER_TOKEN);
    this.stepInput = 0;
    this.stepChars = 0;
    this.emit();
  }

  private emit(): void {
    this.report?.({
      inputTokens: this.input + this.stepInput,
      outputTokens: this.output + Math.round(this.stepChars / CHARS_PER_TOKEN),
    });
  }
}

export interface ChatTurnResult {
  readonly steps: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Why the turn ended: the model answered, a tool waits for the person, or the step limit. */
  readonly end: 'answer' | 'waiting' | 'failed' | 'limit' | 'incomplete';
  readonly reason?:
    | 'length'
    | 'content_filter'
    | 'protocol_error'
    | 'interrupted'
    | 'loop'
    | 'empty'
    | 'context_budget';
}

/**
 * Answer one turn: ask the model, run the tools it calls, give it their results, and again, until
 * it answers without a tool, a tool waits for the person, or the steps run out. A tool that fails
 * or gets bad input does not end the turn: the model reads the error and can try otherwise.
 * With finalizeNudge, the last of maxSteps is reserved: the nudge is appended as a system message,
 * the model is asked with no tools, and a tool call it returns anyway is not run.
 */
export async function runChatTurn(options: ChatTurnOptions): Promise<ChatTurnResult> {
  const { writer, signal } = options;
  const dispatcher = new ChatToolDispatcher(options);
  const messages: ModelMessage[] = [
    { role: 'system', content: options.instructions },
    ...options.history,
  ];
  const maxSteps = options.maxSteps ?? 8;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1)
    throw new Error('A positive bounded step limit is required.');
  let inputTokens = 0;
  let outputTokens = 0;
  const usage = new TurnUsage(options.onUsage);
  let nudged = false;
  const finalizeNudge = options.finalizeNudge?.trim() ?? '';
  for (let step = 1; step <= maxSteps; step++) {
    signal.throwIfAborted();
    if (options.runtimeInstructions)
      messages[0] = {
        role: 'system',
        content: `${options.instructions}\n\n${options.runtimeInstructions(maxSteps - step + 1)}`,
      };
    // The summary reuses the last slot. It is not a step after maxSteps.
    const finalizing = finalizeNudge.length > 0 && step === maxSteps;
    if (finalizing) messages.push({ role: 'system', content: finalizeNudge });
    const offered = finalizing ? [] : options.specs;
    let context: ModelMessage[];
    try {
      context = fitChatContext(
        messages,
        offered,
        undefined,
        options.model.contextOverheadChars ?? 0,
      );
    } catch (error) {
      if (!(error instanceof ContextBudgetExceededError)) throw error;
      return {
        steps: step - 1,
        inputTokens,
        outputTokens,
        end: 'incomplete',
        reason: 'context_budget',
      };
    }
    usage.begin(
      JSON.stringify({ messages: context, tools: offered }).length +
        (options.model.contextOverheadChars ?? 0),
    );
    // Calls shown while the model was still writing them, in the order they began.
    const begun: { name: string; index: number }[] = [];
    const childStatus = (): 'cancelled' | 'failed' => (signal.aborted ? 'cancelled' : 'failed');
    const sealAt = (index: number) => {
      const live = asTool(writer.parts[index]);
      if (!live) return;
      const closed = closeToolPart(
        live,
        'failed',
        live.output ?? { error: 'The call was cut off.' },
        childStatus(),
      );
      if (closed !== live) writer.update(index, closed);
    };
    const sealBegun = () => {
      for (const early of begun.splice(0)) sealAt(early.index);
    };
    // A step of its own: an answer circling through the same paragraph is cut off here, while
    // the turn goes on.
    const stepControl = new AbortController();
    const stopStep = () => stepControl.abort(signal.reason);
    signal.addEventListener('abort', stopStep, { once: true });
    const before = writer.openText;
    let said = '';
    const provisional = new Map<number, string>();
    const step$ = options.model.step({
      messages: context,
      tools: offered,
      signal: stepControl.signal,
      onText: (delta) => {
        if (stepControl.signal.aborted) return;
        said += delta;
        if (looping(said)) {
          stepControl.abort(new LoopCut());
          return;
        }
        const previous = writer.openText;
        writer.text(delta);
        const current = writer.openText;
        if (current && !provisional.has(current.index))
          provisional.set(current.index, previous?.index === current.index ? previous.text : '');
      },
      onTextReset: () => {
        for (const [index, text] of provisional) writer.retract(index, text);
        provisional.clear();
        said = '';
      },
      onToolCall: (name) => {
        if (finalizing || stepControl.signal.aborted) return;
        begun.push({
          name,
          index: writer.show({
            type: 'tool',
            callId: `call-${crypto.randomUUID()}`,
            name,
            input: null,
            status: 'running',
            phase: 'preparing',
            startedAt: Date.now(),
          }),
        });
      },
      onGenerated: (characters) => usage.generated(characters),
    });
    let answer: Awaited<typeof step$>;
    try {
      answer = await step$;
      // Some providers return a partial step when the reader is aborted instead of throwing.
      if (stepControl.signal.reason instanceof LoopCut) throw stepControl.signal.reason;
    } catch (error) {
      if (!(stepControl.signal.reason instanceof LoopCut) || signal.aborted) {
        sealBegun();
        throw error;
      }
      usage.settle();
      // The person never sees the loop: the text part goes back to what it said before it.
      const open = writer.openText;
      if (open) writer.retract(open.index, before?.index === open.index ? before.text : '');
      sealBegun();
      if (nudged || !options.loopNudge)
        return { steps: step, inputTokens, outputTokens, end: 'incomplete', reason: 'loop' };
      nudged = true;
      messages.push({ role: 'user', content: options.loopNudge });
      continue;
    } finally {
      signal.removeEventListener('abort', stopStep);
    }
    inputTokens += answer.inputTokens;
    outputTokens += answer.outputTokens;
    usage.settle(answer);
    try {
      signal.throwIfAborted();
    } catch (error) {
      sealBegun();
      throw error;
    }
    // A call on the reserved last step is not run, however the server ended it: the steps ran out.
    if (finalizing && answer.toolCalls.length > 0) {
      sealBegun();
      return { steps: step, inputTokens, outputTokens, end: 'limit' };
    }
    const finish = answer.truncated ? 'length' : answer.finishReason;
    if (finish && finish !== 'stop' && finish !== 'tool_calls') {
      sealBegun();
      return { steps: step, inputTokens, outputTokens, end: 'incomplete', reason: finish };
    }
    if (answer.toolCalls.length === 0) {
      sealBegun();
      if (!answer.text.trim())
        return { steps: step, inputTokens, outputTokens, end: 'incomplete', reason: 'empty' };
      return { steps: step, inputTokens, outputTokens, end: 'answer' };
    }
    messages.push({ role: 'assistant', content: answer.text, toolCalls: answer.toolCalls });
    let waiting = false;
    let terminalFailure = false;
    for (const call of answer.toolCalls) {
      let index = -1;
      try {
        signal.throwIfAborted();
        const input = parseArguments(call.arguments);
        const early = begun[0]?.name === call.name ? begun.shift() : undefined;
        const previous = early ? asTool(writer.parts[early.index]) : undefined;
        const part: Extract<ChatPart, { type: 'tool' }> = {
          type: 'tool',
          callId: call.id,
          name: call.name,
          input: input.ok ? input.value : call.arguments,
          status: 'running',
          phase: 'preparing',
          startedAt: previous?.startedAt ?? Date.now(),
          ...(previous?.activities ? { activities: previous.activities } : {}),
        };
        index = early ? early.index : writer.show(part);
        if (early) writer.update(index, part);
        let outcome: ToolOutcome;
        if (waiting) {
          outcome = {
            output: { skipped: 'The turn waits for the person; call it again later.' },
            failed: true,
          };
        } else {
          const executing = asTool(writer.parts[index]) ?? part;
          writer.update(index, { ...executing, phase: 'executing' });
          outcome = await dispatcher.dispatch(call.name, call.arguments, {
            signal,
            callId: call.id,
            show: (shown) => writer.show(shown),
            update: (at, shown) => writer.update(at, shown),
            activity: (item) => {
              const live = asTool(writer.parts[index]);
              if (!live) return;
              const merged = mergeToolActivity(live, item);
              if (merged) writer.update(index, merged);
            },
          });
        }
        const live = asTool(writer.parts[index]) ?? part;
        const output = clipped(outcome.output);
        writer.update(
          index,
          closeToolPart(
            live,
            outcome.failed ? 'failed' : 'done',
            output,
            outcome.failed ? childStatus() : 'cancelled',
          ),
        );
        messages.push({ role: 'tool', callId: call.id, content: JSON.stringify(output) });
        if (outcome.stop) {
          waiting = true;
          terminalFailure ||= outcome.failed === true;
        }
      } catch (error) {
        if (index >= 0) sealAt(index);
        sealBegun();
        throw error;
      }
    }
    sealBegun();
    if (waiting)
      return {
        steps: step,
        inputTokens,
        outputTokens,
        end: terminalFailure ? 'failed' : 'waiting',
      };
  }
  return { steps: maxSteps, inputTokens, outputTokens, end: 'limit' };
}

/**
 * The stored chat as the model reads it. A user message is its text and, as data, what it
 * attached. An assistant message is its text and its tool calls, each followed by what the tool
 * gave back; parts a tool showed the person are already in those results. A call cut off by a
 * stopped turn reads as interrupted.
 */
export function modelHistory(messages: readonly ChatMessage[]): ModelMessage[] {
  const history: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      history.push({
        role: 'user',
        content: message.attachments.length
          ? `${message.text}\n\n${JSON.stringify({ attachments: message.attachments })}`
          : message.text,
      });
      continue;
    }
    let text = '';
    let calls: Extract<ChatPart, { type: 'tool' }>[] = [];
    const flush = () => {
      if (calls.length) {
        history.push({
          role: 'assistant',
          content: text,
          toolCalls: calls.map((call) => ({
            id: call.callId,
            name: call.name,
            arguments: typeof call.input === 'string' ? call.input : JSON.stringify(call.input),
          })),
        });
        for (const call of calls) {
          history.push({
            role: 'tool',
            callId: call.callId,
            content: JSON.stringify(
              call.status === 'running' ? { error: 'Interrupted.' } : (call.output ?? null),
            ),
          });
        }
      } else if (text.trim()) {
        history.push({ role: 'assistant', content: text });
      }
      text = '';
      calls = [];
    };
    for (const part of message.parts) {
      if (part.type === 'text') {
        if (calls.length) flush();
        text += part.text;
      } else if (part.type === 'tool') {
        calls.push(part);
      }
    }
    flush();
  }
  // Fit alongside instructions and tool schemas at the runtime boundary, before every model step.
  return history;
}
