import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * A .env file edited in place: values change, comments and order stay, so the file a person
 * reads after setup is still the documented .env.example they started from.
 */
export class EnvFile {
  private lines: string[];

  private constructor(
    private readonly path: string,
    text: string,
  ) {
    this.lines = text.split('\n');
  }

  /** Opens `path`, or starts from `template` when the file does not exist yet. */
  static open(path: string, template?: string): EnvFile {
    if (existsSync(path)) return new EnvFile(path, readFileSync(path, 'utf8'));
    return new EnvFile(
      path,
      template && existsSync(template) ? readFileSync(template, 'utf8') : '',
    );
  }

  get(key: string): string | undefined {
    const line = this.lines.find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1);
  }

  set(key: string, value: string): void {
    if (/[\n\r]/.test(value)) throw new Error(`${key} cannot hold a line break.`);
    const index = this.lines.findIndex((l) => l.startsWith(`${key}=`));
    if (index >= 0) {
      this.lines[index] = `${key}=${value}`;
    } else {
      const end = this.lines.at(-1) === '' ? this.lines.length - 1 : this.lines.length;
      this.lines.splice(end, 0, `${key}=${value}`);
    }
  }

  text(): string {
    return this.lines.join('\n');
  }

  /** Written readable by the owner only: it holds keys and passwords. */
  save(): void {
    writeFileSync(this.path, this.text().endsWith('\n') ? this.text() : `${this.text()}\n`, {
      mode: 0o600,
    });
  }
}
