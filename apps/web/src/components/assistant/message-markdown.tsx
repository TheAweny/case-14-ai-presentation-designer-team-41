'use client';

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Разметка ответов агента в ленте: абзацы, списки, выделение, код и таблицы. Заголовки не крупнее
 * текста — ответ читается как реплика, а не как документ. Ссылки открываются в новой вкладке.
 * HTML из ответа не исполняется: react-markdown его не пропускает.
 */
const components: Components = {
  p: ({ node: _node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />
  ),
  li: ({ node: _node, ...props }) => <li className="pl-0.5" {...props} />,
  h1: ({ node: _node, ...props }) => <p className="mt-3 mb-1.5 font-semibold" {...props} />,
  h2: ({ node: _node, ...props }) => <p className="mt-3 mb-1.5 font-semibold" {...props} />,
  h3: ({ node: _node, ...props }) => <p className="mt-3 mb-1.5 font-medium" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a
      className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code
      className={cn(
        'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]',
        className?.startsWith('language-') && 'block overflow-x-auto bg-transparent p-0',
        className,
      )}
      {...props}
    />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-[0.8125rem]" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground" {...props} />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[0.9em]" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th className="border-b border-border px-2 py-1 font-medium" {...props} />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border-b border-border/60 px-2 py-1 align-top" {...props} />
  ),
  hr: () => <hr className="my-3 border-border" />,
};

export function MessageMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('min-w-0 text-foreground [overflow-wrap:anywhere]', className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
