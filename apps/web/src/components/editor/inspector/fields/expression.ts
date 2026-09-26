/**
 * Арифметика в числовых полях панели: `100+20`, `50*2`, `(10+5)/3`, `-4`.
 *
 * Свой разбор рекурсивным спуском, без `eval`: в поле попадает что угодно, и выполнять это как
 * код нельзя. Запятая равноправна с точкой, пробелы между цифрами склеивают разряды (`1 024`),
 * единица после числа (`12pt`, `45°`, `50%`) пропускается — её пишут по привычке, смысла она
 * не меняет. Всё, что не разобралось, и деление на ноль дают `null`: поле вернёт прежнее значение.
 */

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'op'; readonly op: '+' | '-' | '*' | '/' | '(' | ')' };

/** Длиннее в поле панели ничего осмысленного не пишут, а разбор остаётся дешёвым. */
const MAX_LENGTH = 200;
/** Скобки глубже — наверняка мусор; предел заодно защищает стек. */
const MAX_DEPTH = 32;

const SYMBOLS: Readonly<Record<string, string>> = {
  '−': '-',
  '–': '-',
  '×': '*',
  '·': '*',
  '÷': '/',
  ',': '.',
};

/** Приводит похожие знаки к ASCII и склеивает разряды, разделённые пробелами. */
export function normalizeExpression(text: string): string {
  let result = '';
  for (const char of text) result += SYMBOLS[char] ?? char;
  return result.replace(/(\d)\s+(?=\d)/g, '$1').trim();
}

const NUMBER = /^(\d+\.?\d*|\.\d+)/;
/** Единица после числа: буквы любого алфавита, градусы, проценты, штрихи. */
const UNIT = /^\s*[\p{L}°%"'′″]+/u;
const OPERATORS = new Set(['+', '-', '*', '/', '(', ')']);

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let rest = source;
  while (rest.length > 0) {
    const space = /^\s+/.exec(rest);
    if (space) {
      rest = rest.slice(space[0].length);
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      rest = rest.slice(number[0].length);
      const unit = UNIT.exec(rest);
      if (unit) rest = rest.slice(unit[0].length);
      continue;
    }
    const char = rest[0];
    if (char !== undefined && OPERATORS.has(char)) {
      tokens.push({ kind: 'op', op: char as '+' | '-' | '*' | '/' | '(' | ')' });
      rest = rest.slice(1);
      continue;
    }
    return null;
  }
  return tokens;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number | null {
    const value = this.expression();
    if (value === null || this.index !== this.tokens.length) return null;
    return Number.isFinite(value) ? value : null;
  }

  private peekOp(): string | null {
    const token = this.tokens[this.index];
    return token?.kind === 'op' ? token.op : null;
  }

  // expression := term (('+' | '-') term)*
  private expression(): number | null {
    let left = this.term();
    while (left !== null) {
      const op = this.peekOp();
      if (op !== '+' && op !== '-') break;
      this.index += 1;
      const right = this.term();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  // term := unary (('*' | '/') unary)*
  private term(): number | null {
    let left = this.unary();
    while (left !== null) {
      const op = this.peekOp();
      if (op !== '*' && op !== '/') break;
      this.index += 1;
      const right = this.unary();
      if (right === null) return null;
      if (op === '/' && right === 0) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  // unary := ('+' | '-') unary | primary
  private unary(): number | null {
    const op = this.peekOp();
    if (op === '+' || op === '-') {
      this.index += 1;
      const value = this.nested(() => this.unary());
      if (value === null) return null;
      return op === '-' ? -value : value;
    }
    return this.primary();
  }

  // primary := number | '(' expression ')'
  private primary(): number | null {
    const token = this.tokens[this.index];
    if (!token) return null;
    if (token.kind === 'number') {
      this.index += 1;
      return token.value;
    }
    if (token.op !== '(') return null;
    this.index += 1;
    const value = this.nested(() => this.expression());
    if (value === null || this.peekOp() !== ')') return null;
    this.index += 1;
    return value;
  }

  private nested(read: () => number | null): number | null {
    if (this.depth >= MAX_DEPTH) return null;
    this.depth += 1;
    try {
      return read();
    } finally {
      this.depth -= 1;
    }
  }
}

/** Значение выражения или `null`, если это не выражение, деление на ноль или бесконечность. */
export function evaluateExpression(text: string): number | null {
  if (text.length > MAX_LENGTH) return null;
  const source = normalizeExpression(text);
  if (source === '') return null;
  const tokens = tokenize(source);
  if (!tokens || tokens.length === 0) return null;
  const value = new Parser(tokens).parse();
  // `-0` в поле смотрится как ошибка.
  return value === null ? null : value + 0;
}
