import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAnswerFormat, loadCapabilityProbe } from './loader.js';

const root = join(__dirname, '..', '..', '..');
let scratch: string | null = null;

afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
  scratch = null;
});

describe('shared answer prompts', () => {
  it('reads the answer format and the repair request of the registry', async () => {
    const format = await loadAnswerFormat(join(root, 'registry', 'agents'));
    expect(format.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(format.format).toContain('{{schema}}');
    expect(format.repair).toContain('{{problems}}');
  });

  it('reads the question that probes whether a model thinks', async () => {
    const probe = await loadCapabilityProbe(join(root, 'registry', 'agents'));
    for (const prompt of [probe.question, probe.chat, probe.vision, probe.image]) {
      expect(prompt.length).toBeGreaterThan(0);
    }
  });

  it('refuses prompts that lost their placeholder', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'lct-registry-'));
    await mkdir(join(scratch, 'agents'));
    await mkdir(join(scratch, 'shared'));
    await writeFile(
      join(scratch, 'shared', 'shared.yaml'),
      'version: 1.0.0\nanswerFormatFile: format.md\nanswerRepairFile: repair.md\n',
    );
    await writeFile(join(scratch, 'shared', 'format.md'), 'Answer in JSON.');
    await writeFile(join(scratch, 'shared', 'repair.md'), 'Fix: {{problems}}');
    await expect(loadAnswerFormat(join(scratch, 'agents'))).rejects.toThrow(/\{\{schema\}\}/);
  });
});
