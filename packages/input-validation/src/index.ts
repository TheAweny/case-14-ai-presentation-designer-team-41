import { createHash } from 'node:crypto';
import { accessSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { constants } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type { RunConfig } from '@lct/contracts';

const MAX_TEMPLATE_BYTES = 50 * 1024 * 1024;
const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const CONTENT_EXTENSIONS = new Set(['.json', '.md', '.txt', '.yaml', '.yml']);

export type InputValidationCode =
  | 'content-empty'
  | 'content-too-large'
  | 'content-type'
  | 'input-missing'
  | 'input-not-file'
  | 'output-not-directory'
  | 'pptx-archive-limit'
  | 'pptx-invalid'
  | 'pptx-type';

export class LocalInputValidationError extends Error {
  constructor(
    readonly code: InputValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'LocalInputValidationError';
  }
}

export interface LocalInputFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ValidatedLocalInputs {
  template: LocalInputFile;
  content: LocalInputFile;
  outputDir: string;
}

export function validateLocalRunInputs(
  config: Pick<RunConfig, 'contentPath' | 'outputDir' | 'templatePath'>,
): ValidatedLocalInputs {
  const template = validateTemplate(config.templatePath);
  const content = validateContent(config.contentPath);
  const outputDir = validateOutputDirectory(config.outputDir);
  return { template, content, outputDir };
}

function validateTemplate(path: string): LocalInputFile {
  if (extname(path).toLowerCase() !== '.pptx') {
    throw new LocalInputValidationError('pptx-type', 'Template must have a .pptx extension.');
  }
  const file = validateFile(path, MAX_TEMPLATE_BYTES, 'template');
  const archive = readFileSync(file.path);
  const entries = zipEntries(archive);
  if (!entries.has('[Content_Types].xml') || !entries.has('ppt/presentation.xml')) {
    throw new LocalInputValidationError(
      'pptx-invalid',
      'Template is a ZIP archive but not a PowerPoint .pptx package.',
    );
  }
  return file;
}

function validateContent(path: string): LocalInputFile {
  if (!CONTENT_EXTENSIONS.has(extname(path).toLowerCase())) {
    throw new LocalInputValidationError(
      'content-type',
      `Content must be one of: ${[...CONTENT_EXTENSIONS].join(', ')}.`,
    );
  }
  const file = validateFile(path, MAX_CONTENT_BYTES, 'content');
  if (readFileSync(file.path, 'utf8').trim().length === 0) {
    throw new LocalInputValidationError('content-empty', 'Content file must not be empty.');
  }
  return file;
}

function validateFile(path: string, maxBytes: number, label: string): LocalInputFile {
  const absolutePath = resolve(path);
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(absolutePath);
    accessSync(absolutePath, constants.R_OK);
  } catch {
    throw new LocalInputValidationError(
      'input-missing',
      `${label} file was not found: ${absolutePath}`,
    );
  }
  if (!stats.isFile()) {
    throw new LocalInputValidationError(
      'input-not-file',
      `${label} path is not a file: ${absolutePath}`,
    );
  }
  if (stats.size > maxBytes) {
    const code = label === 'template' ? 'pptx-archive-limit' : 'content-too-large';
    throw new LocalInputValidationError(code, `${label} exceeds the ${maxBytes} byte limit.`);
  }
  const bytes = readFileSync(absolutePath);
  return {
    path: absolutePath,
    bytes: stats.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function validateOutputDirectory(path: string): string {
  const outputDir = resolve(path);
  try {
    mkdirSync(outputDir, { recursive: true });
  } catch {
    throw new LocalInputValidationError(
      'output-not-directory',
      `Output path is not a directory: ${outputDir}`,
    );
  }
  if (!statSync(outputDir).isDirectory()) {
    throw new LocalInputValidationError(
      'output-not-directory',
      `Output path is not a directory: ${outputDir}`,
    );
  }
  try {
    accessSync(outputDir, constants.W_OK);
  } catch {
    throw new LocalInputValidationError(
      'output-not-directory',
      `Output directory is not writable: ${outputDir}`,
    );
  }
  return outputDir;
}

function zipEntries(archive: Buffer): Set<string> {
  const eocdOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0 || eocdOffset + 22 > archive.length) {
    throw new LocalInputValidationError('pptx-invalid', 'Template is not a readable ZIP archive.');
  }
  const entries = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  let offset = archive.readUInt32LE(eocdOffset + 16);
  if (entries > MAX_ARCHIVE_ENTRIES || centralDirectorySize > archive.length - offset) {
    throw new LocalInputValidationError(
      'pptx-archive-limit',
      'Template ZIP has too many files or an invalid directory.',
    );
  }

  let uncompressedBytes = 0;
  const names = new Set<string>();
  for (let index = 0; index < entries; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new LocalInputValidationError(
        'pptx-invalid',
        'Template ZIP central directory is malformed.',
      );
    }
    const uncompressed = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nextOffset = nameStart + nameLength + extraLength + commentLength;
    if (nextOffset > archive.length) {
      throw new LocalInputValidationError(
        'pptx-invalid',
        'Template ZIP contains a truncated entry.',
      );
    }
    uncompressedBytes += uncompressed;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new LocalInputValidationError(
        'pptx-archive-limit',
        'Template expands beyond the 200 MiB limit.',
      );
    }
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8');
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new LocalInputValidationError(
        'pptx-invalid',
        `Template ZIP contains an unsafe entry: ${basename(name)}`,
      );
    }
    names.add(name);
    offset = nextOffset;
  }
  return names;
}
