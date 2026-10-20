/** `--key value` and `--flag` into a map, the rest in order. Small on purpose: no dependency. */
export function parseArgs(argv: readonly string[]): {
  args: string[];
  flags: Record<string, string>;
} {
  const args: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--')) {
      const separator = arg.indexOf('=');
      const key = arg.slice(2, separator === -1 ? undefined : separator);
      const inline = separator === -1 ? undefined : arg.slice(separator + 1);
      const next = argv[i + 1];
      if (inline !== undefined) flags[key] = inline;
      else if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else flags[key] = 'true';
    } else {
      args.push(arg);
    }
  }
  return { args, flags };
}
