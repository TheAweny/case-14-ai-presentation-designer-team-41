import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

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
    this.lines = text.replace(/\r\n/g, '\n').split('\n');
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
    const prefix = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`);
    const value = this.lines.findLast((line) => prefix.test(line))?.match(prefix)?.[1];
    if (value === undefined) return undefined;
    const quote = value[0];
    if (quote === "'" || quote === '"') {
      let decoded = '';
      let escaped = false;
      for (const character of value.slice(1)) {
        if (escaped) {
          decoded += character === quote ? character : `\\${character}`;
          escaped = false;
        } else if (character === '\\') escaped = true;
        else if (character === quote) {
          if (quote === "'") return decoded;
          return this.literal(
            key,
            decoded.replace(
              /\\([nrt\\])/g,
              (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c,
            ),
          );
        } else decoded += character;
      }
      throw new Error(`Незакрытая кавычка в ${key}. Проверьте .env.`);
    }
    return this.literal(key, value.replace(/\s+#.*$/, '').trimEnd());
  }

  private literal(key: string, value: string): string {
    // Generated values use $$ for literal dollars. Refuse unresolved interpolation rather than
    // accidentally replace an existing encryption key with the text of its variable reference.
    if (/(?<!\$)\$(?!\$)(?:\{|[A-Za-z_])/.test(value))
      throw new Error(
        `${key}: для CLI укажите буквальное значение в одинарных кавычках вместо ссылки на переменную.`,
      );
    return value.replaceAll('$$', '$');
  }

  set(key: string, value: string): void {
    if (/[\n\r]/.test(value)) throw new Error(`${key} cannot hold a line break.`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Invalid environment key.');
    // Double quotes escape backslashes (including a trailing one); $$ is a literal dollar in Compose.
    const encoded = /^[A-Za-z0-9_./:@,+%=~-]*$/.test(value)
      ? value
      : JSON.stringify(value.replaceAll('$', () => '$$'));
    const prefix = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const index = this.lines.findLastIndex((line) => prefix.test(line));
    if (index >= 0) {
      this.lines[index] = `${key}=${encoded}`;
    } else {
      const end = this.lines.at(-1) === '' ? this.lines.length - 1 : this.lines.length;
      this.lines.splice(end, 0, `${key}=${encoded}`);
    }
  }

  text(): string {
    return this.lines.join('\n');
  }

  /** Written readable by the owner only: it holds keys and passwords. */
  save(): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, this.text().endsWith('\n') ? this.text() : `${this.text()}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
