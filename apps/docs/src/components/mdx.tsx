import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Callout } from 'fumadocs-ui/components/callout';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';
import { ApiConsole } from '@/components/api-console-frame';
import { MediaSlot } from '@/components/media-slot';

function Note({
  type,
  title,
  children,
}: {
  type: 'info' | 'idea' | 'warn' | 'error';
  title: string;
  children: ReactNode;
}) {
  return (
    <Callout type={type} title={title}>
      {children}
    </Callout>
  );
}

export function Info({ children }: { children: ReactNode }) {
  return (
    <Note type="info" title="Информация">
      {children}
    </Note>
  );
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <Note type="idea" title="Совет">
      {children}
    </Note>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <Note type="warn" title="Предупреждение">
      {children}
    </Note>
  );
}

export function Limitation({ children }: { children: ReactNode }) {
  return (
    <Note type="error" title="Ограничение">
      {children}
    </Note>
  );
}

export function ReviewNote() {
  return (
    <Warning>
      Текст перенесён из черновика портала внутри приложения. Перед опорой на детали сверьте их с
      текущим кодом: ближайшие изменения продукта эту страницу ещё не учитывают.
    </Warning>
  );
}

export function Figure({
  src,
  alt,
  caption,
  width = 960,
  height = 540,
}: {
  src: string;
  alt: string;
  caption: string;
  width?: number;
  height?: number;
}) {
  return (
    <figure className="my-6">
      <ImageZoom
        src={src}
        alt={alt}
        width={width}
        height={height}
        className="h-auto rounded-lg border border-fd-border bg-fd-card"
      />
      <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

/** Keeps the dynamic Swagger import assignable to an MDX component. */
function ApiConsoleMdx() {
  return <ApiConsole />;
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    ApiConsole: ApiConsoleMdx,
    Figure,
    Info,
    MediaSlot,
    Limitation,
    ReviewNote,
    Step,
    Steps,
    Tab,
    Tabs,
    Tip,
    Warning,
    ...components,
  };
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
