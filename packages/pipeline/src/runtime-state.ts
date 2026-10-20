/** Trusted runtime facts are refreshed at dispatch; the surrounding registry policy stays stable. */
export function stableRuntimeInstructions(instructions: string): string {
  return instructions.replace(/\n\n<runtime-state>\n[\s\S]*?\n<\/runtime-state>/gu, '');
}
