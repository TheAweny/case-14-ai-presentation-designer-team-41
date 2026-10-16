// swagger-ui-dist ships no types. Only the options this project passes are described.
declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
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
    syntaxHighlight?: { activated: boolean; theme: string };
    onComplete?: () => void;
  }
  const SwaggerUI: (options: SwaggerUIOptions) => unknown;
  export default SwaggerUI;
}
