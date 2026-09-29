import { z } from 'zod';
import { deckOutlineSchema } from './generation.js';
import { layoutVariantSchema } from './run-config.js';
import { modelRefSchema } from './model-settings.js';

/**
 * A chat with the deck assistant. The API owns the conversation: the web sends a turn, the agent
 * answers it on the server and the answer streams back as events. The stored chat is the list of
 * messages below; the web renders them and never writes them itself.
 *
 * Not part of `contractRegistry`: the engine never sees a chat.
 */

/**
 * How far the agent may go on its own in a turn. `chat` talks and reads, and builds nothing.
 * `plan` shows a deck plan and builds only the plan the person approved. `auto` plans and builds
 * without stopping.
 */
export const CHAT_MODES = ['chat', 'plan', 'auto'] as const;
export const chatModeSchema = z.enum(CHAT_MODES);
export type ChatMode = z.infer<typeof chatModeSchema>;

/** What a person attached to a message. Files are uploaded first; the message carries their ids. */
export const chatAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file'),
    fileId: z.string().uuid(),
    name: z.string().min(1).max(300),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('template'),
    templateId: z.string().uuid(),
    name: z.string().min(1).max(300),
  }),
  /**
   * Objects of a deck open in the editor, or a whole slide, as the person pointed at them: what
   * they are and what they say at the moment of sending.
   */
  z.object({
    kind: z.literal('slides'),
    deckId: z.string().min(1).max(100),
    slideNumber: z.number().int().positive(),
    /** How the chip named it, in the language of the interface. */
    name: z.string().min(1).max(200),
    elements: z
      .array(
        z.object({
          /** The element in the deck's SlideIR: what `edit_slide` names to change its text. */
          elementId: z.string().min(1).max(100).optional(),
          kind: z.string().max(20),
          role: z.string().max(40),
          text: z.string().max(4000).default(''),
        }),
      )
      .max(60),
  }),
]);
export type ChatAttachment = z.infer<typeof chatAttachmentSchema>;

export const chatQuestionOptionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).default(''),
});

export const chatAnswerSchema = z.object({
  /** Labels of the chosen options, empty when the person answered in their own words. */
  optionLabels: z.array(z.string().max(120)).max(8).default([]),
  text: z.string().trim().max(4000).default(''),
});
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;

export const toolStatusSchema = z.enum(['running', 'done', 'failed']);
export const buildStatusSchema = z.enum(['preparing', 'running', 'done', 'failed', 'cancelled']);
export type BuildStatus = z.infer<typeof buildStatusSchema>;

export const variantReviewSchema = z.object({
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
});

/**
 * One piece of an assistant message, in the order the agent produced them. `tool` is every tool
 * call with what the model saw back (`output`), so the next turn replays the conversation exactly;
 * the other parts are what a tool showed the person.
 */
export const chatPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool'),
    callId: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown(),
    status: toolStatusSchema,
    output: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('plan'),
    callId: z.string().min(1),
    planId: z.string().uuid(),
    outline: deckOutlineSchema,
    /** The template the agent means to build with; null — not chosen yet. */
    templateId: z.string().uuid().nullable(),
    status: z.enum(['proposed', 'approved', 'superseded']),
  }),
  z.object({
    type: z.literal('question'),
    callId: z.string().min(1),
    questionId: z.string().uuid(),
    question: z.string().trim().min(1).max(500),
    options: z.array(chatQuestionOptionSchema).max(6),
    multiSelect: z.boolean().default(false),
    answer: chatAnswerSchema.nullable(),
  }),
  z.object({
    type: z.literal('build'),
    callId: z.string().min(1),
    buildId: z.string().uuid(),
    templateId: z.string().uuid(),
    templateName: z.string(),
    /** The balanced run the progress follows, and all three; empty while the template prepares. */
    runId: z.string().nullable(),
    variantRunIds: z.array(z.string()),
    startedAt: z.number().int(),
    finishedAt: z.number().int().nullable(),
    status: buildStatusSchema,
    error: z.string().max(2000).nullable(),
  }),
  z.object({
    type: z.literal('result'),
    buildId: z.string().uuid(),
    variants: z.array(z.object({ variant: layoutVariantSchema, deckId: z.string() })).min(1),
    /** Audit of each variant by deck id; null — the audit could not be read. */
    reviews: z.record(z.string(), variantReviewSchema).nullable(),
    recommended: layoutVariantSchema,
    elapsedMs: z.number().int().nonnegative().nullable(),
  }),
  /**
   * New text for one object of a deck open in the editor. The editor writes it into the draft
   * through its edit journal, so the person sees it on the slide and can undo it. `before` is the
   * text the agent saw: an edit is applied only while the object still says it.
   */
  z.object({
    type: z.literal('slide-edit'),
    callId: z.string().min(1),
    editId: z.string().uuid(),
    deckId: z.string().min(1).max(100),
    slideNumber: z.number().int().positive(),
    elementId: z.string().min(1).max(100),
    before: z.string().max(4000),
    text: z.string().max(4000),
  }),
  z.object({ type: z.literal('error'), message: z.string().max(2000) }),
]);
export type ChatPart = z.infer<typeof chatPartSchema>;
export type SlideEditPart = Extract<ChatPart, { type: 'slide-edit' }>;

export const chatMessageSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('user'),
    id: z.string().uuid(),
    text: z.string(),
    attachments: z.array(chatAttachmentSchema),
    mode: chatModeSchema,
    createdAt: z.number().int(),
  }),
  z.object({
    role: z.literal('assistant'),
    id: z.string().uuid(),
    parts: z.array(chatPartSchema),
    /** `streaming` — the agent is still answering. */
    status: z.enum(['streaming', 'done', 'cancelled', 'failed']),
    createdAt: z.number().int(),
  }),
]);
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type UserChatMessage = Extract<ChatMessage, { role: 'user' }>;
export type AssistantChatMessage = Extract<ChatMessage, { role: 'assistant' }>;

/**
 * What a turn brings: a message, an answer to the agent's question, or an approved plan. An
 * approved plan is built as it is, without asking the model again.
 */
export const chatTurnInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    text: z.string().trim().max(20000),
    attachments: z.array(chatAttachmentSchema).max(12).default([]),
  }),
  z.object({
    type: z.literal('answer'),
    questionId: z.string().uuid(),
    answer: chatAnswerSchema,
  }),
  z.object({
    type: z.literal('approve-plan'),
    planId: z.string().uuid(),
    /** The plan as the person left it in the card: they may have edited it. */
    outline: deckOutlineSchema,
    templateId: z.string().uuid(),
  }),
]);
export type ChatTurnInput = z.infer<typeof chatTurnInputSchema>;

export const chatTurnRequestSchema = z.object({
  mode: chatModeSchema,
  /** The model the agent answers with; null — the model of the assistant role. */
  model: modelRefSchema.nullable().default(null),
  /** The project a new chat belongs to; ignored for a chat that exists. */
  projectId: z.string().nullable().default(null),
  /** How many slides the person usually wants (their setting); null — as the material needs. */
  slideCount: z.number().int().min(10).max(60).nullable().default(null),
  /** The deck a new chat starts from, in the editor: the chat leads to it. */
  deckId: z.string().max(100).nullable().default(null),
  input: chatTurnInputSchema,
});
export type ChatTurnRequest = z.infer<typeof chatTurnRequestSchema>;

/**
 * Events of a turn, numbered within the chat. `message` puts a whole message (new or replaced),
 * `part` puts one part of an assistant message at its index, `text-delta` appends to a text part.
 * `turn-end` closes the stream; `ping` keeps an idle connection open.
 */
export const chatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), seq: z.number().int(), message: chatMessageSchema }),
  z.object({
    type: z.literal('part'),
    seq: z.number().int(),
    messageId: z.string().uuid(),
    index: z.number().int().nonnegative(),
    part: chatPartSchema,
  }),
  z.object({
    type: z.literal('text-delta'),
    seq: z.number().int(),
    messageId: z.string().uuid(),
    index: z.number().int().nonnegative(),
    delta: z.string(),
  }),
  z.object({ type: z.literal('turn-end'), seq: z.number().int() }),
  z.object({ type: z.literal('ping'), seq: z.number().int() }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;

export const chatSummarySchema = z.object({
  chatId: z.string().uuid(),
  title: z.string(),
  projectId: z.string().nullable(),
  deckIds: z.array(z.string()),
  /** The deck the chat leads to: the chosen variant, or the one the agent recommends. */
  deckId: z.string().nullable(),
  mode: chatModeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatSummary = z.infer<typeof chatSummarySchema>;

export const chatDocumentSchema = chatSummarySchema.extend({
  messages: z.array(chatMessageSchema),
  /** A turn is being answered right now: the web attaches to its stream. */
  running: z.boolean(),
});
export type ChatDocument = z.infer<typeof chatDocumentSchema>;
