/** I negotiate transport features only after an explicit request-parameter refusal. */
export class CompatibleRequests {
  private format: 'schema' | 'object' | 'off' = 'schema';
  private readonly omitted = new Set<string>();
  private completionTokens = false;
  private buffered = false;

  constructor(private readonly fetchImpl?: typeof fetch) {}

  async post(
    endpoint: string,
    init: Omit<RequestInit, 'body' | 'method'>,
    original: Readonly<Record<string, unknown>>,
  ): Promise<Response> {
    // I bound negotiation independently of busy/network retries and the caller's deadline.
    for (let attempt = 0; ; attempt++) {
      init.signal?.throwIfAborted();
      const body = { ...original };
      for (const field of this.omitted) delete body[field];
      if (this.completionTokens && 'max_tokens' in body) {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
      }
      if (this.buffered && body.stream === true) body.stream = false;
      const format = body.response_format as { type?: string } | undefined;
      if (format && this.format === 'off') delete body.response_format;
      else if (format?.type === 'json_schema' && this.format === 'object')
        body.response_format = { type: 'json_object' };
      const response = await (this.fetchImpl ?? fetch)(endpoint, {
        ...init,
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (![400, 422, 501].includes(response.status) || attempt >= 8) return response;
      const detail = await response
        .clone()
        .text()
        .catch(() => '');
      if (!this.adapt(body, detail)) return response;
      await response.body?.cancel();
    }
  }

  private adapt(body: Record<string, unknown>, detail: string): boolean {
    let param = '';
    let message = detail.toLowerCase();
    try {
      const error = (JSON.parse(detail) as { error?: { param?: unknown; message?: unknown } })
        .error;
      if (typeof error?.param === 'string') param = error.param.toLowerCase();
      if (typeof error?.message === 'string') message = error.message.toLowerCase();
    } catch {
      // I also handle gateways that return plain-text parameter errors.
    }
    const rejected =
      /unsupported|not supported|not support|unrecognized|unknown|not allowed|only.*supported|invalid.*schema/.test(
        message,
      );
    const schema = param === 'text.format.schema' || param.startsWith('response_format');
    if (
      body.response_format &&
      (schema || (rejected && /response_format|json_schema|json_object/.test(message)))
    ) {
      const format = body.response_format as { type?: string };
      if (format.type !== 'json_schema') this.format = 'off';
      else if (this.format === 'schema') this.format = 'object';
      return true;
    }
    if (!rejected) return false;
    const mentions = (field: string) =>
      param === field || new RegExp(`\\b${field}\\b`).test(message);
    for (const field of ['seed', 'temperature', 'top_p']) {
      if (field in body && mentions(field)) {
        this.omitted.add(field);
        return true;
      }
    }
    if ('max_tokens' in body && mentions('max_tokens')) {
      this.completionTokens = true;
      return true;
    }
    if (body.stream === true && mentions('stream')) {
      this.buffered = true;
      return true;
    }
    return false;
  }
}

/** I expose only a validated parameter name, never the raw provider body or credentials. */
export function refusedParameter(detail: string): string {
  try {
    const error = (JSON.parse(detail) as { error?: { param?: unknown } }).error;
    return typeof error?.param === 'string' && /^[a-zA-Z0-9_.[\]-]{1,100}$/.test(error.param)
      ? `; rejected parameter: ${error.param}`
      : '';
  } catch {
    return '';
  }
}
