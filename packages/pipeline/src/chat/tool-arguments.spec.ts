import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatTool, ToolContext } from './agent.js';
import { mendedArguments } from './tool-arguments.js';
import { ChatToolDispatcher } from './tool-runtime.js';

const UUID = '00000000-0000-4000-8000-000000000000';

function outline() {
  return {
    title: 'Умный квартал',
    slides: Array.from({ length: 10 }, (_, index) => ({
      title: `Слайд ${index + 1}`,
      points: ['Тезис'],
    })),
  };
}

describe('mendedArguments', () => {
  it('turns the exact string null into JSON null when the field accepts null', () => {
    const schema = z.object({ templateId: z.string().uuid().nullable() });
    expect(mendedArguments(schema, { templateId: 'null' })).toEqual({ templateId: null });
    expect(schema.safeParse(mendedArguments(schema, { templateId: 'null' })).success).toBe(true);
  });

  it('keeps the string null when a uuid field is not nullable', () => {
    const schema = z.object({ templateId: z.string().uuid() });
    expect(mendedArguments(schema, { templateId: 'null' })).toEqual({ templateId: 'null' });
    expect(schema.safeParse(mendedArguments(schema, { templateId: 'null' })).success).toBe(false);
  });

  it('leaves a plain string field that does not accept null as the string null', () => {
    const schema = z.object({ note: z.string() });
    expect(mendedArguments(schema, { note: 'null' })).toEqual({ note: 'null' });
    expect(schema.parse(mendedArguments(schema, { note: 'null' }))).toEqual({ note: 'null' });
  });

  it('accepts null through optional and default wrappers around a nullable field', () => {
    const schema = z.object({
      templateId: z.string().uuid().nullable().default(null),
      otherId: z.string().uuid().nullable().optional(),
    });
    expect(mendedArguments(schema, { templateId: 'null', otherId: 'null' })).toEqual({
      templateId: null,
      otherId: null,
    });
    expect(schema.parse(mendedArguments(schema, { templateId: 'null', otherId: 'null' }))).toEqual({
      templateId: null,
      otherId: null,
    });
  });

  it('leaves a valid uuid unchanged', () => {
    const schema = z.object({ templateId: z.string().uuid().nullable().default(null) });
    expect(mendedArguments(schema, { templateId: UUID })).toEqual({ templateId: UUID });
    expect(schema.parse(mendedArguments(schema, { templateId: UUID }))).toEqual({
      templateId: UUID,
    });
  });

  it('does not invent a uuid or drop a malformed one', () => {
    const schema = z.object({ templateId: z.string().uuid().nullable() });
    const malformed = { templateId: 'not-a-uuid' };
    expect(mendedArguments(schema, malformed)).toEqual(malformed);
    expect(schema.safeParse(mendedArguments(schema, malformed)).success).toBe(false);
  });

  it('does not coerce empty, undefined or None into null', () => {
    const schema = z.object({ templateId: z.string().uuid().nullable() });
    expect(mendedArguments(schema, { templateId: '' })).toEqual({ templateId: '' });
    expect(mendedArguments(schema, { templateId: 'None' })).toEqual({ templateId: 'None' });
    expect(mendedArguments(schema, {})).toEqual({});
    expect(schema.safeParse(mendedArguments(schema, { templateId: '' })).success).toBe(false);
    expect(schema.safeParse(mendedArguments(schema, { templateId: 'None' })).success).toBe(false);
  });

  it('does not convert the string null when the outer field forbids null', () => {
    const schema = z.object({
      templateId: z
        .string()
        .uuid()
        .nullable()
        .refine((value) => value !== null),
    });
    expect(mendedArguments(schema, { templateId: 'null' })).toEqual({ templateId: 'null' });
    expect(schema.safeParse(mendedArguments(schema, { templateId: 'null' })).success).toBe(false);
  });

  it('still reads a nested object sent as JSON or spread over the top level', () => {
    const schema = z.object({
      outline: z.object({ title: z.string(), slides: z.array(z.string()).min(1) }),
      templateId: z.string().nullable(),
    });
    const meant = { outline: { title: 'Умный квартал', slides: ['Пилот'] }, templateId: null };
    const asString = { outline: JSON.stringify(meant.outline), templateId: 'null' };
    expect(schema.parse(mendedArguments(schema, asString))).toEqual(meant);
    const spread = { title: 'Умный квартал', slides: ['Пилот'], templateId: 'null' };
    expect(schema.parse(mendedArguments(schema, spread))).toEqual(meant);
  });
});

describe('ChatToolDispatcher propose_plan', () => {
  it('dispatches propose_plan when templateId is the string null', async () => {
    const run = vi.fn(async (input: { templateId: string | null }) => ({
      output: { planId: 'p1', templateId: input.templateId },
    }));
    const tool: ChatTool = {
      name: 'propose_plan',
      modes: ['plan', 'auto'],
      input: z.object({
        outline: z.object({ title: z.string(), slides: z.array(z.unknown()).min(1) }),
        templateId: z.string().uuid().nullable().default(null),
      }),
      run,
    };
    const dispatcher = new ChatToolDispatcher({
      tools: [tool],
      specs: [{ name: 'propose_plan', description: 'Show a plan.', parameters: {} }],
      mode: 'plan',
    });
    const context: ToolContext = {
      signal: new AbortController().signal,
      callId: 'c1',
      show: () => 0,
      update: () => undefined,
    };
    const argumentsText = JSON.stringify({ outline: outline(), templateId: 'null' });
    const outcome = await dispatcher.dispatch('propose_plan', argumentsText, context);
    expect(outcome).toEqual({ output: { planId: 'p1', templateId: null } });
    expect(run).toHaveBeenCalledWith({ outline: outline(), templateId: null }, context);
  });
});
