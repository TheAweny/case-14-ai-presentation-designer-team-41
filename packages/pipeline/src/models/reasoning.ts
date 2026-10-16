/**
 * Enable thinking for Qwen3 chat templates, including Qwen3.5-27B. Do not send this
 * runtime-specific field to unrelated or opaque model ids: their server keeps its defaults.
 * Instruct-2507 and VL-Instruct are non-thinking checkpoints, unlike the hybrid Qwen3 models.
 * Sources: https://huggingface.co/Qwen/Qwen3.5-27B
 * https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507
 * https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct
 */
export function reasoningRequestFields(model: string): Record<string, unknown> {
  if (!/(?:^|[^a-z0-9])qwen3(?:[.:-]|$)/i.test(model)) return {};
  if (/instruct[-_:]?2507|qwen3[-_:]vl.*instruct/i.test(model)) return {};
  return { chat_template_kwargs: { enable_thinking: true } };
}
