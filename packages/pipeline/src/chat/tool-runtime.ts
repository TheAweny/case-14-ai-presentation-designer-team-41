import { z } from 'zod';
import type { ChatMode } from '@lct/contracts';
import type { ChatTool, ToolContext, ToolOutcome } from './agent.js';
import type { ToolSpec } from './chat-model.js';
import { mendedArguments, parseArguments } from './tool-arguments.js';

export interface ToolDispatcherOptions {
  readonly tools: readonly ChatTool[];
  readonly specs: readonly ToolSpec[];
  readonly mode: ChatMode;
}

/** In-process action boundary. Resource ownership remains the responsibility of each tool. */
export class ChatToolDispatcher {
  private readonly tools: ReadonlyMap<string, ChatTool>;
  private readonly offered: ReadonlySet<string>;

  constructor(private readonly options: ToolDispatcherOptions) {
    this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    if (this.tools.size !== options.tools.length) throw new Error('Tool names must be unique.');
    this.offered = new Set(options.specs.map((spec) => spec.name));
  }

  async dispatch(name: string, argumentsText: string, context: ToolContext): Promise<ToolOutcome> {
    context.signal.throwIfAborted();
    const tool = this.tools.get(name);
    if (!tool || !this.offered.has(name) || !tool.modes.includes(this.options.mode)) {
      return {
        output: { code: 'tool_not_allowed', error: 'This tool is not allowed in this step.' },
        failed: true,
      };
    }
    const input = parseArguments(argumentsText);
    if (!input.ok)
      return {
        output: { code: 'invalid_arguments', error: 'The arguments are not valid JSON.' },
        failed: true,
      };
    let parsed = tool.input.safeParse(input.value);
    if (!parsed.success) parsed = tool.input.safeParse(mendedArguments(tool.input, input.value));
    if (!parsed.success)
      return {
        output: {
          code: 'invalid_arguments',
          error: 'Invalid arguments.',
          issues: z.treeifyError(parsed.error),
        },
        failed: true,
      };
    context.signal.throwIfAborted();
    try {
      const outcome = await tool.run(parsed.data, context);
      context.signal.throwIfAborted();
      return outcome;
    } catch (error) {
      context.signal.throwIfAborted();
      return {
        output: {
          code: 'tool_failed',
          error: error instanceof Error ? error.message : 'The tool failed.',
        },
        failed: true,
      };
    }
  }
}
