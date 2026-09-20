import { z } from 'zod';

/**
 * ContentPack — the source material a deck is allowed to draw on.
 *
 * Every factual claim in a DeckPlan names an item from here, and the audit checks the claim
 * against this text and nothing else. That makes the pack a boundary rather than a convenience:
 * if a figure is not in the pack, no agent is entitled to put it on a slide.
 *
 * The organisers hand over a template and nothing else, so in practice the pack is assembled
 * from whatever the user supplies — a brief typed into a form, a pasted document, an upload. The
 * shape is the same in all three cases, which is what lets the audit be written once.
 */

/** What a piece of source material is, which decides how a planner may use it. */
export const contentItemKindSchema = z.enum(['brief', 'text', 'table', 'figure', 'link']);

export const contentItemSchema = z.object({
  itemId: z
    .string()
    .min(1)
    .describe('What a sourceRef points at. Unique within the pack and stable across a run.'),
  kind: contentItemKindSchema,
  title: z.string().describe('Heading of the passage. Empty when it has none.'),
  text: z
    .string()
    .min(1)
    .describe('The material itself as plain text, in the form a quote can be taken from.'),
  origin: z.string().describe('File name or URL it came from. Empty when the user typed it in.'),
});

export const contentPackSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  packId: z.string().min(1),
  briefId: z
    .string()
    .min(1)
    .describe('Identifies the request this pack answers. A DeckPlan names it back.'),
  language: z.string().min(2).describe('BCP 47 tag of the source material.'),
  goal: z.string().min(1).describe('What the deck has to achieve, in one sentence.'),
  audience: z.string().describe('Who it is for. Empty when the user did not say.'),
  items: z
    .array(contentItemSchema)
    .describe('Can be empty: a brief alone is a valid pack, and then nothing else may be cited.'),
});

export type ContentItemKind = z.infer<typeof contentItemKindSchema>;
export type ContentItem = z.infer<typeof contentItemSchema>;
export type ContentPack = z.infer<typeof contentPackSchema>;
