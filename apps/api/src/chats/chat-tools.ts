import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  auditReportSchema,
  chatQuestionOptionSchema,
  deckOutlineSchema,
  storedTemplateIndexSchema,
  type ChatMessage,
  type ChatMode,
  type ChatPart,
  type DeckOutline,
  type LayoutVariant,
  type ModelRef,
} from '@lct/contracts';
import type { ChatTool, ToolContext, ToolOutcome } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import { visibleFile } from '../files/template-visibility.js';
import { GenerationService } from '../generation/generation.service.js';

/** What a tool may know and change of the chat whose turn it runs in. */
export interface ChatToolScope {
  readonly account: Account;
  readonly chatId: string;
  readonly projectId: string | null;
  readonly mode: ChatMode;
  /** The model the person picked for the chat; the deck is written with it too. */
  readonly model: ModelRef | null;
  /** The chat as it is now, the answer of this turn included. */
  messages(): readonly ChatMessage[];
  /** Replace a part of an earlier message: a plan superseded or approved. */
  updatePart(messageId: string, index: number, part: ChatPart): void;
  /** Decks the chat produced, and the one it leads to. */
  addDecks(deckIds: readonly string[], primary: string | null): void;
}

type BuildPart = Extract<ChatPart, { type: 'build' }>;

/** A plan of the chat with where it is, so it can be replaced in place. */
function plansOf(messages: readonly ChatMessage[]) {
  return messages.flatMap((message) =>
    message.role === 'assistant'
      ? message.parts.flatMap((part, index) =>
          part.type === 'plan' ? [{ messageId: message.id, index, part }] : [],
        )
      : [],
  );
}

/** Decks built in the chat, by the result parts of its builds. */
export function chatDecks(messages: readonly ChatMessage[]): Set<string> {
  return new Set(
    messages.flatMap((message) =>
      message.role === 'assistant'
        ? message.parts.flatMap((part) =>
            part.type === 'result' ? part.variants.map((variant) => variant.deckId) : [],
          )
        : [],
    ),
  );
}

/** What the person said in the chat: every fact the deck may use is in there. */
function peopleSaid(messages: readonly ChatMessage[]): string {
  return messages
    .flatMap((message) => (message.role === 'user' && message.text.trim() ? [message.text] : []))
    .join('\n\n');
}

/** Order the agent recommends variants in when their audit is equal. */
const PREFERENCE: readonly LayoutVariant[] = ['balanced', 'dense', 'airy'];

interface VariantOutcome {
  readonly variant: LayoutVariant;
  readonly deckId: string;
  readonly errors: number;
  readonly warnings: number;
}

/** Fewer errors first, then fewer warnings, then the balanced one. */
export function recommend(variants: readonly VariantOutcome[]): LayoutVariant {
  const best = [...variants].sort(
    (a, b) =>
      a.errors - b.errors ||
      a.warnings - b.warnings ||
      PREFERENCE.indexOf(a.variant) - PREFERENCE.indexOf(b.variant),
  )[0];
  if (!best) throw new Error('No variants to recommend.');
  return best.variant;
}

const TEXT_FILE = /\.(txt|md|csv|tsv)$/i;
const MAX_FILE_CHARS = 20000;

/**
 * The tools of the chat agent for one turn. They read and build through the same services as the
 * generation endpoints, and see only what the account may use.
 */
export function chatTools(generation: GenerationService, scope: ChatToolScope): ChatTool[] {
  const { pool } = generation;
  const account = scope.account;

  const templateRow = async (templateId: string) => {
    const result = await pool.query<{
      id: string;
      name: string;
      profile: {
        generation?: unknown;
        index?: unknown;
        designSystem?: { palette?: { role?: string; hex?: string }[] };
      } | null;
    }>(
      `SELECT id, COALESCE(display_name, file_name) AS name, profile FROM stored_files
       WHERE id = $1 AND kind = 'template' AND ${visibleFile(2)}`,
      [templateId, account.id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('There is no such template in the library.');
    return row;
  };

  const layoutKinds = (index: unknown) => {
    const parsed = storedTemplateIndexSchema.safeParse(index);
    if (!parsed.success) return null;
    const kinds: Record<string, number> = {};
    for (const note of parsed.data.notes) {
      if (!note.skip) kinds[note.kind] = (kinds[note.kind] ?? 0) + 1;
    }
    return kinds;
  };

  const chatDeck = async (deckId: string) => {
    if (
      !chatDecks(scope.messages()).has(deckId) ||
      !(await generation.library.visible(deckId, account.id))
    )
      throw new Error('This deck was not built in this chat.');
    return generation.directory(deckId);
  };

  const auditOf = async (deckId: string) => {
    const report = auditReportSchema.parse(
      JSON.parse(
        await readFile(join(generation.directory(deckId), 'audit-deterministic.json'), 'utf8'),
      ),
    );
    const errors = report.findings.filter(
      (f) => f.severity === 'blocker' || f.severity === 'major',
    );
    return { report, errors: errors.length, warnings: report.findings.length - errors.length };
  };

  const listTemplates: ChatTool = {
    name: 'list_templates',
    input: z.object({}),
    modes: ['chat', 'plan', 'auto'],
    async run() {
      const result = await pool.query<{
        id: string;
        name: string;
        profile: { generation?: unknown; index?: unknown } | null;
        attached: boolean;
      }>(
        `SELECT f.id, COALESCE(f.display_name, f.file_name) AS name, f.profile,
                EXISTS (SELECT 1 FROM library_project_templates t
                        WHERE t.template_id = f.id AND t.project_id = $2) AS attached
         FROM stored_files f
         WHERE f.kind = 'template' AND ${visibleFile(1, 'f')}
         ORDER BY attached DESC, f.created_at DESC LIMIT 40`,
        [account.id, scope.projectId],
      );
      return {
        output: {
          templates: result.rows.map((row) => ({
            templateId: row.id,
            name: row.name,
            attachedToProject: row.attached,
            layoutsByKind: layoutKinds(row.profile?.index),
          })),
        },
      };
    },
  };

  const describeTemplate: ChatTool = {
    name: 'describe_template',
    input: z.object({ templateId: z.string().uuid() }),
    modes: ['chat', 'plan', 'auto'],
    async run(input) {
      const { templateId } = input as { templateId: string };
      const row = await templateRow(templateId);
      const index = storedTemplateIndexSchema.safeParse(row.profile?.index);
      const layouts = index.success
        ? index.data.notes
            .filter((note) => !note.skip)
            .map((note) => ({
              kind: note.kind,
              title: note.title,
              useFor: note.useFor,
              items: note.items,
              ...(note.special ? { special: true } : {}),
            }))
        : null;
      return {
        output: {
          templateId,
          name: row.name,
          colors: (row.profile?.designSystem?.palette ?? [])
            .slice(0, 10)
            .map((entry) => ({ role: entry.role, hex: entry.hex })),
          layouts,
          ...(layouts
            ? {}
            : { note: 'The template is not prepared yet: it is when a deck is built.' }),
        },
      };
    },
  };

  const readFileTool: ChatTool = {
    name: 'read_file',
    input: z.object({ fileId: z.string().uuid() }),
    modes: ['chat', 'plan', 'auto'],
    async run(input) {
      const { fileId } = input as { fileId: string };
      const result = await pool.query<{ file_name: string; storage_path: string }>(
        `SELECT file_name, storage_path FROM stored_files
         WHERE id = $1 AND kind = 'content' AND ${visibleFile(2)}`,
        [fileId, account.id],
      );
      const row = result.rows[0];
      if (!row) throw new Error('There is no such file.');
      if (!TEXT_FILE.test(row.storage_path))
        throw new Error('Only text, Markdown and CSV/TSV files can be read.');
      const text = await readFile(row.storage_path, 'utf8');
      return {
        output: {
          name: row.file_name,
          text: text.slice(0, MAX_FILE_CHARS),
          ...(text.length > MAX_FILE_CHARS ? { cut: true, length: text.length } : {}),
        },
      };
    },
  };

  const readDeck: ChatTool = {
    name: 'read_deck',
    input: z.object({ deckId: z.string() }),
    modes: ['chat', 'plan', 'auto'],
    async run(input) {
      const directory = await chatDeck((input as { deckId: string }).deckId);
      const written = z
        .array(
          z.object({
            index: z.number(),
            title: z.string().optional(),
            slide: z.object({ texts: z.array(z.object({ text: z.string() })) }),
          }),
        )
        .parse(JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8')));
      return {
        output: {
          title: written[0]?.title ?? '',
          slides: written
            .sort((a, b) => a.index - b.index)
            .map((slide) => ({
              slide: slide.index + 1,
              texts: slide.slide.texts.map((text) => text.text).filter(Boolean),
            })),
        },
      };
    },
  };

  const readAudit: ChatTool = {
    name: 'read_audit',
    input: z.object({ deckId: z.string() }),
    modes: ['chat', 'plan', 'auto'],
    async run(input) {
      const deckId = (input as { deckId: string }).deckId;
      await chatDeck(deckId);
      const { report, errors, warnings } = await auditOf(deckId);
      return {
        output: {
          errors,
          warnings,
          findings: report.findings.slice(0, 40).map((finding) => ({
            slide: finding.target.slideId,
            severity: finding.severity,
            title: finding.title,
          })),
        },
      };
    },
  };

  const askUser: ChatTool = {
    name: 'ask_user',
    input: z.object({
      question: z.string().trim().min(1).max(500),
      options: z.array(chatQuestionOptionSchema).max(6).default([]),
      multiSelect: z.boolean().default(false),
    }),
    modes: ['plan', 'auto'],
    async run(input, context) {
      const question = input as {
        question: string;
        options: { label: string; description: string }[];
        multiSelect: boolean;
      };
      const questionId = crypto.randomUUID();
      context.show({
        type: 'question',
        callId: context.callId,
        questionId,
        question: question.question,
        options: question.options,
        multiSelect: question.multiSelect,
        answer: null,
      });
      return {
        output: { questionId, status: 'Asked. The answer comes as the next message.' },
        stop: true,
      };
    },
  };

  const proposePlan: ChatTool = {
    name: 'propose_plan',
    input: z.object({
      outline: deckOutlineSchema,
      templateId: z.string().uuid().nullable().default(null),
    }),
    modes: ['plan', 'auto'],
    async run(input, context) {
      const { outline, templateId } = input as { outline: DeckOutline; templateId: string | null };
      if (templateId !== null) await templateRow(templateId);
      for (const plan of plansOf(scope.messages())) {
        if (plan.part.status === 'proposed')
          scope.updatePart(plan.messageId, plan.index, { ...plan.part, status: 'superseded' });
      }
      const planId = crypto.randomUUID();
      context.show({
        type: 'plan',
        callId: context.callId,
        planId,
        outline,
        templateId,
        status: 'proposed',
      });
      return scope.mode === 'plan'
        ? {
            output: {
              planId,
              status: 'Shown to the person. The turn waits for their approval or edits.',
            },
            stop: true,
          }
        : { output: { planId, status: 'Shown. Build it now with build_deck.' } };
    },
  };

  const buildDeck: ChatTool = {
    name: 'build_deck',
    input: z.object({
      templateId: z.string().uuid(),
      planId: z.string().uuid().nullable().default(null),
      brief: z.string().trim().max(8000).default(''),
      fileIds: z.array(z.string().uuid()).max(10).default([]),
    }),
    modes: ['plan', 'auto'],
    async run(input, context) {
      const request = input as {
        templateId: string;
        planId: string | null;
        brief: string;
        fileIds: string[];
      };
      const plan = plansOf(scope.messages()).find((item) => item.part.planId === request.planId);
      if (scope.mode === 'plan') {
        if (!plan)
          throw new Error('In the plan mode a deck is built only from a plan: propose one.');
        if (plan.part.status !== 'approved')
          throw new Error('This plan is not approved. Wait for the person to approve it.');
      }
      if (request.planId !== null && !plan) throw new Error('There is no plan with this planId.');
      if (plan && plan.part.status !== 'approved')
        scope.updatePart(plan.messageId, plan.index, { ...plan.part, status: 'approved' });
      return runBuild(generation, scope, context, {
        templateId: request.templateId,
        outline: plan?.part.outline ?? null,
        brief: request.brief,
        fileIds: request.fileIds,
      });
    },
  };

  return [
    listTemplates,
    describeTemplate,
    readFileTool,
    readDeck,
    readAudit,
    askUser,
    proposePlan,
    buildDeck,
  ].filter((tool) => tool.modes.includes(scope.mode));
}

/**
 * Build a deck and wait for it: prepare the template if it has not been, start the three
 * variants, follow them in a build part, and put their result into the chat. Stopping the turn
 * stops the build.
 */
export async function runBuild(
  generation: GenerationService,
  scope: ChatToolScope,
  context: ToolContext,
  request: {
    templateId: string;
    outline: DeckOutline | null;
    brief: string;
    fileIds: readonly string[];
  },
): Promise<ToolOutcome> {
  const template = await generation.template(request.templateId, scope.account);
  const startedAt = Date.now();
  let part: BuildPart = {
    type: 'build',
    callId: context.callId,
    buildId: crypto.randomUUID(),
    templateId: request.templateId,
    templateName: template.file_name,
    runId: null,
    variantRunIds: [],
    startedAt,
    finishedAt: null,
    status: 'preparing',
    error: null,
  };
  const index = context.show(part);
  const set = (patch: Partial<BuildPart>) => {
    part = { ...part, ...patch };
    context.update(index, part);
  };
  try {
    if (!GenerationService.prepared(template)) {
      await generation.prepare(request.templateId, scope.model, scope.account);
      context.signal.throwIfAborted();
    }
    const brief = [request.brief, peopleSaid(scope.messages()), request.outline?.title ?? '']
      .map((text) => text.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 50000)
      .padEnd(10, '.');
    const build = await generation.start(
      {
        templateId: request.templateId,
        brief,
        slideCount: null,
        outline: request.outline,
        projectId: scope.projectId,
        contentIds: [...request.fileIds],
        seed: 42,
        model: scope.model,
      },
      scope.account,
    );
    set({
      status: 'running',
      runId: build.runId,
      variantRunIds: build.variants.map((variant) => variant.runId),
      startedAt: Date.now(),
    });
    const stop = () => generation.cancel(build.runId);
    context.signal.addEventListener('abort', stop, { once: true });
    const settled = await build.settled.finally(() =>
      context.signal.removeEventListener('abort', stop),
    );
    context.signal.throwIfAborted();
    const done = settled.filter((variant) => variant.state === 'done');
    if (done.length === 0) {
      set({ status: 'failed', finishedAt: Date.now(), error: 'Сборка не удалась.' });
      return { output: { status: 'failed', error: 'No variant was built.' }, failed: true };
    }
    const outcomes: VariantOutcome[] = [];
    let audited = true;
    for (const variant of done) {
      const audit = await readAuditCounts(generation, variant.runId);
      if (!audit) audited = false;
      outcomes.push({
        variant: variant.variant,
        deckId: variant.runId,
        errors: audit?.errors ?? 0,
        warnings: audit?.warnings ?? 0,
      });
    }
    const recommended = recommend(outcomes);
    const finishedAt = Date.now();
    set({ status: 'done', finishedAt });
    context.show({
      type: 'result',
      buildId: part.buildId,
      variants: outcomes.map(({ variant, deckId }) => ({ variant, deckId })),
      reviews: audited
        ? Object.fromEntries(
            outcomes.map(({ deckId, errors, warnings }) => [deckId, { errors, warnings }]),
          )
        : null,
      recommended,
      elapsedMs: finishedAt - part.startedAt,
    });
    scope.addDecks(
      outcomes.map((outcome) => outcome.deckId),
      outcomes.find((outcome) => outcome.variant === recommended)?.deckId ?? null,
    );
    return {
      output: {
        status: 'done',
        variants: outcomes,
        recommended,
        failedVariants: settled.filter((v) => v.state === 'failed').map((v) => v.variant),
      },
    };
  } catch (error) {
    if (context.signal.aborted) {
      set({ status: 'cancelled', finishedAt: Date.now() });
      throw error;
    }
    const message = error instanceof Error ? error.message : 'The build failed.';
    set({ status: 'failed', finishedAt: Date.now(), error: message });
    throw error;
  }
}

async function readAuditCounts(generation: GenerationService, deckId: string) {
  try {
    const report = auditReportSchema.parse(
      JSON.parse(
        await readFile(join(generation.directory(deckId), 'audit-deterministic.json'), 'utf8'),
      ),
    );
    const errors = report.findings.filter(
      (finding) => finding.severity === 'blocker' || finding.severity === 'major',
    ).length;
    return { errors, warnings: report.findings.length - errors };
  } catch {
    return null;
  }
}
