import { z } from 'zod';

const valueSchema = z.object({
  value: z.number().refine((value) => Number.isFinite(value), 'Value must be a finite number.'),
  unit: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(300).optional(),
});

export const calculationInputSchema = z.object({
  operation: z.enum(['sum', 'difference', 'product', 'ratio', 'percentage_change', 'payback']),
  values: z.array(valueSchema).min(1).max(50),
  period: z.string().trim().min(1).max(40).optional(),
});

export type CalculationInput = z.infer<typeof calculationInputSchema>;

export type CalculationDirection = 'increase' | 'decrease' | 'unchanged';

export type CalculationResult = {
  operation: CalculationInput['operation'];
  result: { value: number; unit: string };
  direction?: CalculationDirection;
  formula: string;
  inputs: Array<{ value: number; unit: string; source?: string }>;
};

type CalculationError = Error & { code: string };

function reject(code: string, message: string): never {
  const error = new Error(message) as CalculationError;
  error.name = 'CalculationError';
  error.code = code;
  throw error;
}

function invalidInput(error: z.ZodError): never {
  reject(
    'invalid_input',
    JSON.stringify({
      code: 'invalid_input',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }),
  );
}

function unitsMatch(values: CalculationInput['values']): boolean {
  const expected = values[0]?.unit;
  return expected !== undefined && values.every((item) => item.unit === expected);
}

function assertFinite(value: number): number {
  if (!Number.isFinite(value)) {
    reject('overflow', 'Результат не является конечным числом.');
  }
  return value;
}

function currencyCodes(): ReadonlySet<string> {
  const fallback = ['RUB', 'USD', 'EUR'];
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return new Set(Intl.supportedValuesOf('currency').map((code) => code.toUpperCase()));
    }
  } catch {
    return new Set(fallback);
  }
  return new Set(fallback);
}

const CURRENCIES = currencyCodes();

function assertCurrency(unit: string): string {
  const code = unit.trim().toUpperCase();
  if (!CURRENCIES.has(code)) {
    reject('invalid_currency', 'Единица не является валютой.');
  }
  return code;
}

function assertPeriod(period: string | undefined): string {
  if (!period || !period.trim()) {
    reject('missing_period', 'Для срока окупаемости нужен период денежного эффекта.');
  }
  return period.trim();
}

function provenance(values: CalculationInput['values']): CalculationResult['inputs'] {
  return values.map((item) =>
    item.source
      ? { value: item.value, unit: item.unit, source: item.source }
      : { value: item.value, unit: item.unit },
  );
}

function rawList(values: CalculationInput['values']): string {
  return values.map((item) => String(item.value)).join(', ');
}

function finish(result: CalculationResult): CalculationResult {
  if (JSON.stringify(result).length >= 10_000) {
    reject('payload_limit', 'Ответ расчёта превышает 10000 символов.');
  }
  return result;
}

function exactlyTwo(
  values: CalculationInput['values'],
  code: string,
  message: string,
): [CalculationInput['values'][number], CalculationInput['values'][number]] {
  const left = values[0];
  const right = values[1];
  if (values.length !== 2 || left === undefined || right === undefined) reject(code, message);
  return [left, right];
}

export function calculate(input: unknown): CalculationResult {
  const parsed = calculationInputSchema.safeParse(input);
  if (!parsed.success) invalidInput(parsed.error);
  const { operation, values, period } = parsed.data;
  const inputs = provenance(values);

  if (operation === 'sum') {
    if (!unitsMatch(values)) {
      reject('unit_mismatch', 'Слагаемые должны быть в одной единице измерения.');
    }
    const first = values[0];
    if (first === undefined) reject('invalid_count', 'Для суммы нужно хотя бы одно значение.');
    const total = assertFinite(values.reduce((sum, item) => assertFinite(sum + item.value), 0));
    return finish({
      operation,
      result: { value: total, unit: first.unit },
      formula: 'sum(' + rawList(values) + ')',
      inputs,
    });
  }

  if (operation === 'difference') {
    const [left, right] = exactlyTwo(
      values,
      'invalid_count',
      'Разность считается ровно по двум значениям.',
    );
    if (left.unit.trim() !== right.unit.trim()) {
      reject('unit_mismatch', 'Уменьшаемое и вычитаемое должны быть в одной единице измерения.');
    }
    return finish({
      operation,
      result: { value: assertFinite(left.value - right.value), unit: left.unit },
      formula: left.value + ' - ' + right.value,
      inputs,
    });
  }

  if (operation === 'product') {
    if (values.length < 2) {
      reject('invalid_count', 'Произведение считается минимум по двум значениям.');
    }
    const product = assertFinite(
      values.reduce((total, item) => assertFinite(total * item.value), 1),
    );
    return finish({
      operation,
      result: { value: product, unit: values.map((item) => item.unit).join('*') },
      formula: 'product(' + rawList(values) + ')',
      inputs,
    });
  }

  if (operation === 'ratio') {
    const [left, right] = exactlyTwo(
      values,
      'invalid_count',
      'Отношение считается ровно по двум значениям.',
    );
    if (right.value === 0) reject('division_by_zero', 'Деление на ноль невозможно.');
    const unit = left.unit === right.unit ? '1' : left.unit + '/' + right.unit;
    return finish({
      operation,
      result: { value: assertFinite(left.value / right.value), unit },
      formula: left.value + ' / ' + right.value,
      inputs,
    });
  }

  if (operation === 'percentage_change') {
    const [previous, next] = exactlyTwo(
      values,
      'invalid_count',
      'Изменение в процентах считается ровно по двум значениям: было и стало.',
    );
    if (previous.unit !== next.unit) {
      reject('unit_mismatch', 'Было и стало должны быть в одной единице измерения.');
    }
    if (previous.value === 0)
      reject('division_by_zero', 'Нельзя посчитать изменение от нулевой базы.');
    const base = Math.abs(previous.value);
    const value = assertFinite(((next.value - previous.value) / base) * 100);
    const direction: CalculationDirection =
      value < 0 ? 'decrease' : value > 0 ? 'increase' : 'unchanged';
    return finish({
      operation,
      result: { value, unit: '%' },
      direction,
      formula: '(' + next.value + ' - ' + previous.value + ') / abs(' + previous.value + ') * 100',
      inputs,
    });
  }

  const [investment, effect] = exactlyTwo(
    values,
    'missing_monetary_effect',
    'Для окупаемости нужны инвестиция и денежный эффект за период.',
  );
  const investmentUnit = assertCurrency(investment.unit);
  const effectUnit = assertCurrency(effect.unit);
  if (investmentUnit !== effectUnit) {
    reject('unit_mismatch', 'Инвестиция и денежный эффект должны быть в одной валюте.');
  }
  if (investment.value < 0) {
    reject('invalid_investment', 'Инвестиция не может быть отрицательной.');
  }
  const resolvedPeriod = assertPeriod(period);
  if (effect.value === 0) reject('division_by_zero', 'Денежный эффект за период равен нулю.');
  if (effect.value < 0) {
    reject('missing_monetary_effect', 'Денежный эффект за период должен быть положительным.');
  }
  return finish({
    operation,
    result: { value: assertFinite(investment.value / effect.value), unit: resolvedPeriod },
    formula:
      investment.value +
      ' ' +
      investmentUnit +
      ' / ' +
      effect.value +
      ' ' +
      effectUnit +
      ' per ' +
      resolvedPeriod,
    inputs,
  });
}
