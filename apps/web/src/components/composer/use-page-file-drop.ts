'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Page fallback: an editor canvas or a dialog's own drop zone gets first refusal. */
export function usePageFileDrop(
  root: RefObject<HTMLElement | null>,
  onFiles: ((files: File[]) => void) | undefined,
  enabled: boolean,
) {
  const latest = useRef(onFiles);
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    latest.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    if (!enabled) return;
    const reset = () => setDragging(false);
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const blockedByDialog = () => {
      const dialog = document.querySelector('[role="dialog"][data-state="open"]');
      return Boolean(dialog && !dialog.contains(root.current));
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Native file navigation is prevented even while attachments are unavailable.
      if (event.defaultPrevented) {
        reset();
        return;
      }
      event.preventDefault();
      const allowed = Boolean(latest.current) && !blockedByDialog();
      if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
      setDragging(allowed);
    };
    const leave = (event: DragEvent) => {
      if (
        event.relatedTarget === null &&
        (event.clientX <= 0 ||
          event.clientY <= 0 ||
          event.clientX >= window.innerWidth ||
          event.clientY >= window.innerHeight)
      )
        reset();
    };
    const drop = (event: DragEvent) => {
      reset();
      if (!hasFiles(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (blockedByDialog()) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length && latest.current) {
        latest.current(files);
        root.current?.querySelector('textarea')?.focus({ preventScroll: true });
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    document.addEventListener('dragenter', over);
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', drop);
    document.addEventListener('dragend', reset);
    document.addEventListener('keydown', escape);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('dragenter', over);
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', drop);
      document.removeEventListener('dragend', reset);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('blur', reset);
    };
  }, [enabled, root]);
  return dragging;
}
