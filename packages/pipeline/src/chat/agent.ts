import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ChatEvent, ChatMessage, ChatMode, ChatPart } from '@lct/contracts';
import { loadAgent, type LoadedAgent } from '@lct/registry';
import type { ChatModel, ModelMessage, ToolSpec } from './chat-model.js';

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
  readonly modes: Readonly<Record<ChatMode, string>>;
  readonly tools: Readonly<Record<string, string>>;
  readonly jsonMode: string;
  /** Said to the model after an answer that looped was cut off. */
  readonly loopNudge: string;
}

export const CHAT_AGENT_ID = 'chat-assistant';

export async function loadChatAgent(registryDir: string): Promise<ChatAgent> {
  const directory = join(registryDir, CHAT_AGENT_ID);
  const agent = await loadAgent(directory);
  const read = (...path: string[]) => readFile(join(directory, ...path), 'utf8');
  const [chat, plan, auto, jsonMode, loopNudge] = await Promise.all([
    read('modes', 'chat.md'),
    read('modes', 'plan.md'),
    read('modes', 'auto.md'),
    read('json-mode.md'),
    read('loop-nudge.md'),
  ]);
  const toolFiles = (await readdir(join(directory, 'tools'))).filter((name) =>
    name.endsWith('.md'),
  );
  const tools = Object.fromEntries(
    await Promise.all(
      toolFiles.map(async (file) => [file.slice(0, -3), (await read('tools', file)).trim()]),
    ),
  );
  return { agent, modes: { chat, plan, auto }, tools, jsonMode, loopNudge: loopNudge.trim() };
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
  /** The conversation before this turn, the new message included. */
  readonly history: readonly ModelMessage[];
  readonly tools: readonly ChatTool[];
  readonly specs: readonly ToolSpec[];
  readonly writer: AnswerWriter;
  readonly signal: AbortSignal;
  /** Model answers in one turn: a model looping over tools stops here. */
  readonly maxSteps?: number;
  /** Said to the model once when its answer loops; without it a looping answer ends the turn. */
  readonly loopNudge?: string;
}

export interface ChatTurnResult {
  readonly steps: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Why the turn ended: the model answered, a tool waits for the person, or the step limit. */
  readonly end: 'answer' | 'waiting' | 'limit';
}

/**
 * Answer one turn: ask the model, run the tools it calls, give it their results, and again, until
 * it answers without a tool, a tool waits for the person, or the steps run out. A tool that fails
 * or gets bad input does not end the turn: the model reads the error and can try otherwise.
 */
export async function runChatTurn(options: ChatTurnOptions): Promise<ChatTurnResult> {
  const { writer, signal } = options;
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));
  const messages: ModelMessage[] = [
    { role: 'system', content: options.instructions },
    ...options.history,
  ];
  const maxSteps = options.maxSteps ?? 8;
  let inputTokens = 0;
  let outputTokens = 0;
  let nudged = false;
  for (let step = 1; step <= maxSteps; step++) {
    signal.throwIfAborted();
    // Calls shown while the model was still writing them, in the order they began.
    const begun: { name: string; index: number }[] = [];
    // A step of its own: an answer circling through the same paragraph is cut off here, while
    // the turn goes on.
    const stepControl = new AbortController();
    const stopStep = () => stepControl.abort(signal.reason);
    signal.addEventListener('abort', stopStep, { once: true });
    const before = writer.openText;
    let said = '';
    const step$ = options.model.step({
      messages,
      tools: options.specs,
      signal: stepControl.signal,
      onText: (delta) => {
        if (stepControl.signal.aborted) return;
        said += delta;
        if (looping(said)) {
          stepControl.abort(new LoopCut());
          return;
        }
        writer.text(delta);
      },
      onToolCall: (name) =>
        begun.push({
          name,
          index: writer.show({
            type: 'tool',
            callId: `call-${crypto.randomUUID()}`,
            name,
            input: null,
            status: 'running',
          }),
        }),
    });
    let answer: Awaited<typeof step$>;
    try {
      answer = await step$;
    } catch (error) {
      if (!(stepControl.signal.reason instanceof LoopCut) || signal.aborted) throw error;
      // The person never sees the loop: the text part goes back to what it said before it.
      const open = writer.openText;
      if (open) writer.retract(open.index, before?.index === open.index ? before.text : '');
      for (const early of begun.splice(0))
        writer.update(early.index, {
          type: 'tool',
          callId: `call-${crypto.randomUUID()}`,
          name: early.name,
          input: null,
          status: 'failed',
          output: { error: 'The call was cut off.' },
        });
      if (nudged || !options.loopNudge)
        return { steps: step, inputTokens, outputTokens, end: 'answer' };
      nudged = true;
      messages.push({ role: 'user', content: options.loopNudge });
      continue;
    } finally {
      signal.removeEventListener('abort', stopStep);
    }
    const cutOff = () => {
      for (const early of begun.splice(0)) {
        writer.update(early.index, {
          type: 'tool',
          callId: `call-${crypto.randomUUID()}`,
          name: early.name,
          input: null,
          status: 'failed',
          output: { error: 'The call was cut off.' },
        });
      }
    };
    inputTokens += answer.inputTokens;
    outputTokens += answer.outputTokens;
    if (answer.toolCalls.length === 0) {
      cutOff();
      return { steps: step, inputTokens, outputTokens, end: 'answer' };
    }
    messages.push({ role: 'assistant', content: answer.text, toolCalls: answer.toolCalls });
    let waiting = false;
    for (const call of answer.toolCalls) {
      const input = parseArguments(call.arguments);
      const part: Extract<ChatPart, { type: 'tool' }> = {
        type: 'tool',
        callId: call.id,
        name: call.name,
        input: input.ok ? input.value : call.arguments,
        status: 'running',
      };
      const early = begun[0]?.name === call.name ? begun.shift() : undefined;
      const index = early ? early.index : writer.show(part);
      if (early) writer.update(index, part);
      const outcome = waiting
        ? { output: { skipped: 'The turn waits for the person; call it again later.' } }
        : await runTool(byName.get(call.name), input, {
            signal,
            callId: call.id,
            show: (shown) => writer.show(shown),
            update: (at, shown) => writer.update(at, shown),
          });
      const output = clipped(outcome.output);
      writer.update(index, { ...part, status: outcome.failed ? 'failed' : 'done', output });
      messages.push({ role: 'tool', callId: call.id, content: JSON.stringify(output) });
      if (outcome.stop) waiting = true;
    }
    cutOff();
    if (waiting) return { steps: step, inputTokens, outputTokens, end: 'waiting' };
  }
  return { steps: maxSteps, inputTokens, outputTokens, end: 'limit' };
}

function parseArguments(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: text.trim() ? JSON.parse(text) : {} };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object schema under optional, nullable and default wrappers, if there is one. */
function objectShape(schema: unknown): Record<string, unknown> | undefined {
  let current = schema;
  for (let depth = 0; depth < 4; depth++) {
    if (current instanceof z.ZodObject) return current.shape as Record<string, unknown>;
    const unwrap = (current as { unwrap?: () => unknown } | undefined)?.unwrap;
    if (typeof unwrap !== 'function') return undefined;
    current = unwrap.call(current);
  }
  return undefined;
}

/**
 * JSON a model wrote, even when it left the last brackets open: they are closed in the order
 * they were opened. Null when it still does not read.
 */
export function lenientJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const open: string[] = [];
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (char === '\\') index++;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') open.push('}');
      else if (char === '[') open.push(']');
      else if (char === '}' || char === ']') open.pop();
    }
    if (quoted || !open.length) return null;
    try {
      return JSON.parse(text + open.reverse().join(''));
    } catch {
      return null;
    }
  }
}

/** A value with every string of JSON in it read as what it says, at any depth. */
function unstrung(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    const read = lenientJson(value);
    return read === null ? value : unstrung(read, depth + 1);
  }
  if (Array.isArray(value)) return value.map((item) => unstrung(item, depth + 1));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, unstrung(item, depth + 1)]),
    );
  return value;
}

/**
 * Arguments as the model meant them. Open models often send a nested object as a string of
 * JSON, or spread its fields over the top level; both are read back into the object before the
 * schema judges them. Anything else is left for the schema to reject with its reasons.
 */
export function mendedArguments(schema: z.ZodType, value: unknown): unknown {
  const shape = objectShape(schema);
  if (!isRecord(value) || !shape) return value;
  const out = unstrung(value) as Record<string, unknown>;
  for (const [key, field] of Object.entries(shape)) {
    if (out[key] !== undefined) continue;
    const inner = objectShape(field);
    if (!inner) continue;
    const spread = Object.keys(inner).filter((name) => name in out && !(name in shape));
    if (!spread.length) continue;
    out[key] = Object.fromEntries(spread.map((name) => [name, out[name]]));
    for (const name of spread) delete out[name];
  }
  return out;
}

async function runTool(
  tool: ChatTool | undefined,
  input: { ok: true; value: unknown } | { ok: false },
  context: ToolContext,
): Promise<ToolOutcome> {
  if (!tool) return { output: { error: 'There is no such tool here.' }, failed: true };
  if (!input.ok) return { output: { error: 'The arguments are not valid JSON.' }, failed: true };
  let parsed = tool.input.safeParse(input.value);
  if (!parsed.success) {
    // The mended reading is what the model meant: its errors are the ones worth reporting.
    parsed = tool.input.safeParse(mendedArguments(tool.input, input.value));
  }
  if (!parsed.success) {
    return {
      output: { error: 'Invalid arguments.', issues: z.treeifyError(parsed.error) },
      failed: true,
    };
  }
  try {
    return await tool.run(parsed.data, context);
  } catch (error) {
    context.signal.throwIfAborted();
    return {
      output: { error: error instanceof Error ? error.message : 'The tool failed.' },
      failed: true,
    };
  }
}

/** How much of the conversation the model rereads; older tool results give way first. */
const HISTORY_BUDGET_CHARS = 90000;

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
  return fitHistory(history);
}

function fitHistory(history: ModelMessage[]): ModelMessage[] {
  let size = history.reduce((total, message) => total + message.content.length, 0);
  return history.map((message) => {
    if (size <= HISTORY_BUDGET_CHARS || message.role !== 'tool') return message;
    const omitted = '{"omitted":"An older tool result, left out to save room."}';
    size -= message.content.length - omitted.length;
    return { ...message, content: omitted };
  });
}
