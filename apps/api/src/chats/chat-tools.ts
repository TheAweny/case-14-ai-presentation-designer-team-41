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
import {
  GenerationService,
  type StartedBuild,
  type VariantEnd,
} from '../generation/generation.service.js';

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

/**
 * The object of a deck the person attached from the editor, as it was when they sent it: the
 * latest attachment of that slide that names it. The agent edits only what it was shown.
 */
export function pointedElement(
  messages: readonly ChatMessage[],
  target: { deckId: string; slideNumber: number; elementId: string },
): { kind: string; text: string } | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue;
    for (const attachment of message.attachments) {
      if (
        attachment.kind !== 'slides' ||
        attachment.deckId !== target.deckId ||
        attachment.slideNumber !== target.slideNumber
      )
        continue;
      const element = attachment.elements.find((item) => item.elementId === target.elementId);
      if (element) return { kind: element.kind, text: element.text };
    }
  }
  return null;
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
  readonly errors: number | null;
  readonly warnings: number | null;
}

/** Fewer errors first, then fewer warnings, then the balanced one. */
export function recommend(variants: readonly VariantOutcome[]): LayoutVariant {
  const audited = variants.every((variant) => variant.errors !== null && variant.warnings !== null);
  const best = [...variants].sort(
    (a, b) =>
      (audited ? (a.errors ?? 0) - (b.errors ?? 0) || (a.warnings ?? 0) - (b.warnings ?? 0) : 0) ||
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
              ...(note.requiredContent.length ? { requiredContent: note.requiredContent } : {}),
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
      // A model may list the template among the materials; as content it would fail the build.
      const templates = new Set([
        request.templateId,
        ...scope
          .messages()
          .flatMap((message) =>
            message.role === 'user'
              ? message.attachments.flatMap((item) =>
                  item.kind === 'template' ? [item.templateId] : [],
                )
              : [],
          ),
      ]);
      return runBuild(generation, scope, context, {
        templateId: request.templateId,
        outline: plan?.part.outline ?? null,
        brief: request.brief,
        fileIds: request.fileIds.filter((id) => !templates.has(id)),
      });
    },
  };

  const editSlide: ChatTool = {
    name: 'edit_slide',
    input: z.object({
      deckId: z.string().min(1).max(100),
      slideNumber: z.number().int().positive(),
      elementId: z.string().min(1).max(100),
      text: z.string().max(4000),
    }),
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      const edit = input as {
        deckId: string;
        slideNumber: number;
        elementId: string;
        text: string;
      };
      const pointed = pointedElement(scope.messages(), edit);
      if (!pointed)
        throw new Error(
          'The person has not pointed at this object: only objects attached from the editor ' +
            'can be edited. Ask them to select it on the slide and attach it to the message.',
        );
      if (pointed.kind !== 'text')
        throw new Error('Only the text of a text object can be changed with edit_slide.');
      const editId = crypto.randomUUID();
      context.show({
        type: 'slide-edit',
        callId: context.callId,
        editId,
        deckId: edit.deckId,
        slideNumber: edit.slideNumber,
        elementId: edit.elementId,
        before: pointed.text,
        text: edit.text,
      });
      return {
        output: {
          editId,
          status:
            'Sent to the editor: it writes the text into the draft, where the person sees it and ' +
            'can undo it.',
        },
      };
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
    editSlide,
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
    const settled = await settleWithGrace(build).finally(() =>
      context.signal.removeEventListener('abort', stop),
    );
    context.signal.throwIfAborted();
    const done = settled.filter((variant) => variant.state === 'done');
    if (done.length === 0) {
      const reasons = await failureReasons(
        generation,
        settled.map((variant) => variant.runId),
      );
      set({ status: 'failed', finishedAt: Date.now(), error: reasons[0] ?? null });
      return {
        output: { status: 'failed', error: 'No variant was built.', reasons },
        failed: true,
      };
    }
    const outcomes: VariantOutcome[] = [];
    let audited = true;
    for (const variant of done) {
      const audit = await readAuditCounts(generation, variant.runId);
      if (!audit) audited = false;
      outcomes.push({
        variant: variant.variant,
        deckId: variant.runId,
        errors: audit?.errors ?? null,
        warnings: audit?.warnings ?? null,
      });
    }
    const recommended = recommend(outcomes);
    const finishedAt = Date.now();
    set({ status: 'done', finishedAt });
    // A variant that failed stays in the result, so the person sees it and can build it again.
    const failed = await Promise.all(
      settled
        .filter((variant) => variant.state === 'failed')
        .map(async ({ variant, runId }) => ({
          variant,
          runId,
          status: 'failed' as const,
          reason: await failureReason(generation, runId),
        })),
    );
    context.show({
      type: 'result',
      buildId: part.buildId,
      ...(failed.length ? { failed } : {}),
      variants: outcomes.map(({ variant, deckId }) => ({ variant, deckId })),
      reviews: audited
        ? Object.fromEntries(
            outcomes.map(({ deckId, errors, warnings }) => [
              deckId,
              { errors: errors ?? 0, warnings: warnings ?? 0 },
            ]),
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
        auditAvailable: audited,
        failedVariants: settled.filter((v) => v.state === 'failed').map((v) => v.variant),
        unfinishedVariants: settled.filter((v) => v.state === 'running').map((v) => v.variant),
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

/** How long the other variants may keep the person waiting once the balanced one is ready. */
const VARIANT_GRACE_MS = 60000;

/**
 * Wait for the variants of a build, but not for a straggler: once the balanced variant is done,
 * the others get a minute more. One still running then is reported as running and left to finish
 * in the library.
 */
export async function settleWithGrace(
  build: Pick<StartedBuild, 'runId' | 'variants' | 'each'>,
  graceMs = VARIANT_GRACE_MS,
): Promise<{ variant: LayoutVariant; runId: string; state: 'done' | 'failed' | 'running' }[]> {
  const ended = new Map<string, VariantEnd>();
  for (const pending of build.each) void pending.then((end) => ended.set(end.runId, end));
  const primary = build.each[build.variants.findIndex((item) => item.runId === build.runId)];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = primary
    ? primary.then((end) =>
        end.state === 'done'
          ? new Promise<void>((resolve) => (timer = setTimeout(resolve, graceMs)))
          : new Promise<void>(() => undefined),
      )
    : new Promise<void>(() => undefined);
  await Promise.race([Promise.all(build.each), grace]);
  clearTimeout(timer);
  return build.variants.map(
    (item) =>
      ended.get(item.runId) ?? { variant: item.variant, runId: item.runId, state: 'running' },
  );
}

/** Why the runs of a build failed, as each wrote it down, without repeats. */
async function failureReasons(
  generation: GenerationService,
  runIds: readonly string[],
): Promise<string[]> {
  const reasons = new Set<string>();
  for (const runId of runIds) {
    const reason = await failureReason(generation, runId);
    if (reason) reasons.add(reason);
  }
  return [...reasons];
}

/** Why one run failed, as it wrote it down; null — it wrote no reason. */
export async function failureReason(
  generation: GenerationService,
  runId: string,
): Promise<string | null> {
  try {
    const failure = z
      .object({ message: z.string() })
      .parse(JSON.parse(await readFile(join(generation.directory(runId), 'failure.json'), 'utf8')));
    return failure.message.slice(0, 500);
  } catch {
    return null;
  }
}

export async function readAuditCounts(generation: GenerationService, deckId: string) {
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
