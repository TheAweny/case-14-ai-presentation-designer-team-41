import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateLocalRunInputs } from './index.js';
import type { LocalInputValidationError } from './index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'lct-inputs-'));
  temporaryDirectories.push(directory);
  return directory;
}

function zip(entries: ReadonlyArray<{ name: string; uncompressedBytes?: number }>): Buffer {
  const directory = entries.map(({ name, uncompressedBytes = 0 }) => {
    const nameBytes = Buffer.from(name);
    const record = Buffer.alloc(46 + nameBytes.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(uncompressedBytes, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    nameBytes.copy(record, 46);
    return record;
  });
  const directoryBytes = Buffer.concat(directory);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(directoryBytes.length, 12);
  return Buffer.concat([...directory, footer]);
}

function validConfig(directory: string) {
  const templatePath = join(directory, 'template.pptx');
  const contentPath = join(directory, 'brief.md');
  writeFileSync(
    templatePath,
    zip([{ name: '[Content_Types].xml' }, { name: 'ppt/presentation.xml' }]),
  );
  writeFileSync(contentPath, '# Brief\nUseful source material.');
  return { templatePath, contentPath, outputDir: join(directory, 'runs') };
}

function expectValidation(config: ReturnType<typeof validConfig>, code: string): void {
  expect(() => validateLocalRunInputs(config)).toThrow(
    expect.objectContaining({ code }) as LocalInputValidationError,
  );
}

describe('validateLocalRunInputs', () => {
  it('accepts valid local files and returns reproducible identities', () => {
    const config = validConfig(fixtureDirectory());
    const inputs = validateLocalRunInputs(config);
    expect(inputs.template.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(inputs.content.path).toBe(config.contentPath);
    expect(inputs.outputDir).toBe(config.outputDir);
  });

  it('rejects a missing template', () => {
    const directory = fixtureDirectory();
    const config = validConfig(directory);
    config.templatePath = join(directory, 'missing.pptx');
    expectValidation(config, 'input-missing');
  });

  it('rejects templates without a .pptx extension', () => {
    const config = validConfig(fixtureDirectory());
    config.templatePath = config.templatePath.replace('.pptx', '.zip');
    expectValidation(config, 'pptx-type');
  });

  it('rejects a ZIP that is not a PowerPoint package', () => {
    const directory = fixtureDirectory();
    const config = validConfig(directory);
    writeFileSync(config.templatePath, zip([{ name: 'notes.txt' }]));
    expectValidation(config, 'pptx-invalid');
  });

  it('rejects an archive that expands beyond the limit', () => {
    const directory = fixtureDirectory();
    const config = validConfig(directory);
    writeFileSync(
      config.templatePath,
      zip([
        { name: '[Content_Types].xml' },
        { name: 'ppt/presentation.xml' },
        { name: 'ppt/media/large.bin', uncompressedBytes: 201 * 1024 * 1024 },
      ]),
    );
    expectValidation(config, 'pptx-archive-limit');
  });

  it('rejects empty content', () => {
    const directory = fixtureDirectory();
    const config = validConfig(directory);
    writeFileSync(config.contentPath, '   ');
    expectValidation(config, 'content-empty');
  });

  it('rejects unsupported content types', () => {
    const directory = fixtureDirectory();
    const config = validConfig(directory);
    config.contentPath = join(directory, 'brief.pdf');
    writeFileSync(config.contentPath, 'not a supported source');
    expectValidation(config, 'content-type');
  });

  it('rejects an output path that is already a file', () => {
    const directory = fixtureDirectory();
    const config = validConfig(directory);
    writeFileSync(config.outputDir, 'not a directory');
    expectValidation(config, 'output-not-directory');
  });
});
