import type { ReactNode } from 'react';

/**
 * A reserved frame for a later screenshot or a short recording.
 * The article names what should be shown. The file is added when the picture exists.
 */
export function MediaSlot({
  kind,
  title,
  src,
  children,
}: {
  kind: 'image' | 'video';
  title: string;
  /** File under `public/`, for example `/images/guide/editor.gif`. */
  src?: string;
  children?: ReactNode;
}) {
  if (src) {
    return (
      <figure className="my-6">
        <img
          src={src}
          alt={title}
          className="w-full rounded-lg border border-fd-border bg-fd-card"
        />
        <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">
          {title}
        </figcaption>
      </figure>
    );
  }
  const label = kind === 'video' ? 'Видео' : 'Снимок';
  return (
    <figure className="my-6" data-media-slot={kind}>
      <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-fd-border bg-fd-card px-6 py-8 text-center">
        <p className="text-xs font-medium tracking-wide text-fd-muted-foreground">{label}</p>
        <p className="max-w-lg text-sm">{title}</p>
        {children ? (
          <div className="max-w-lg text-sm text-fd-muted-foreground">{children}</div>
        ) : null}
      </div>
      <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">{title}</figcaption>
    </figure>
  );
}
