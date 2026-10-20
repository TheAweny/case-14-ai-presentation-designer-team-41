// swagger-ui-dist ships no types. Only the options this page passes are described.
declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
  interface SwaggerRequest {
    headers: Record<string, string>;
  }
  interface SwaggerUIOptions {
    domNode: HTMLElement;
    spec: object;
    deepLinking?: boolean;
    docExpansion?: 'list' | 'full' | 'none';
    defaultModelsExpandDepth?: number;
    defaultModelExpandDepth?: number;
    displayRequestDuration?: boolean;
    filter?: boolean;
    tryItOutEnabled?: boolean;
    persistAuthorization?: boolean;
    syntaxHighlight?: { activated: boolean; theme: string };
    requestInterceptor?: (request: SwaggerRequest) => SwaggerRequest;
    onComplete?: () => void;
  }
  const SwaggerUI: (options: SwaggerUIOptions) => unknown;
  export default SwaggerUI;
}
