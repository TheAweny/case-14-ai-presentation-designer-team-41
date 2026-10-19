'use client';

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * A guide article. HTML from the file is not executed: react-markdown drops it. Decisions are
 * split on `##` headings and drawn as cards; the other articles stay one column of prose.
 */
const components: Components = {
  p: ({ node: _node, ...props }) => (
    <p className="my-3 leading-6 first:mt-0 last:mb-0" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="my-3 list-disc space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="my-3 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />
  ),
  li: ({ node: _node, ...props }) => <li className="pl-0.5" {...props} />,
  h2: ({ node: _node, ...props }) => (
    <h2 className="mt-8 mb-2 text-base font-semibold first:mt-0" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="mt-6 mb-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  strong: ({ node: _node, ...props }) => <strong className="font-semibold" {...props} />,
  a: ({ node: _node, href, ...props }) => {
    const external = typeof href === 'string' && /^https?:/.test(href);
    return (
      <a
        href={href}
        className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
        {...props}
      />
    );
  },
  code: ({ node: _node, className, ...props }) => (
    <code
      className={[
        'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]',
        className?.startsWith('language-') ? 'block overflow-x-auto bg-transparent p-0' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className="my-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5"
      {...props}
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th
      className="border-b border-border px-2 py-1.5 text-left text-xs font-medium text-muted-foreground"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border-b border-border/70 px-2 py-1.5 align-top" {...props} />
  ),
};

function GuideBody({ text }: { text: string }) {
  return (
    <div className="text-sm text-foreground">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}

function splitGuide(text: string): { intro: string; sections: string[] } {
  const chunks = text
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n(?=## )/);
  if (chunks[0]?.startsWith('## ')) return { intro: '', sections: chunks };
  return { intro: chunks[0] ?? '', sections: chunks.slice(1) };
}

export function GuideMarkdown({ text, cards = false }: { text: string; cards?: boolean }) {
  if (!cards) return <GuideBody text={text} />;
  const { intro, sections } = splitGuide(text);
  return (
    <div>
      {intro ? <GuideBody text={intro} /> : null}
      <div className="mt-4 space-y-3">
        {sections.map((section) => (
          <section
            key={section.slice(0, 48)}
            className="rounded-xl bg-card/40 px-4 py-3 ring-1 ring-border/70 backdrop-blur-sm"
          >
            <GuideBody text={section} />
          </section>
        ))}
      </div>
    </div>
  );
}
