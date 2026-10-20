/** Original user text only. Model drafts, approved paraphrases and preparation are not sources. */
export function sourceBriefTexts(brief: string, depth = 0): string[] {
  if (depth > 4) return [];
  let value: unknown;
  try {
    value = JSON.parse(brief);
  } catch {
    return [brief];
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const envelope = value as Record<string, unknown>;
  if (Array.isArray(envelope.userRequirements))
    return envelope.userRequirements.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const source = entry as Record<string, unknown>;
      return typeof source.messageId === 'string' && typeof source.text === 'string'
        ? [source.text]
        : [];
    });
  if (typeof envelope.userRequirements === 'string') return [envelope.userRequirements];
  if (typeof envelope.brief === 'string') return sourceBriefTexts(envelope.brief, depth + 1);
  return [];
}
