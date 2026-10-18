/**
 * Shared menu metrics. Context and dropdown rows must compute the same
 * height, font, padding and radius; panels share the same surface.
 * Checkbox and radio rows keep their own indicator padding.
 */
export const menuItemClass =
  "relative flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-2 text-[0.8125rem]/relaxed outline-hidden select-none transition-colors duration-100 motion-reduce:transition-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7.5 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 data-[variant=destructive]:*:[svg]:text-destructive";

export const menuSurfaceClass =
  'z-[5000] rounded-xl bg-popover p-1.5 text-popover-foreground shadow-xl shadow-black/10 ring-1 ring-foreground/10';
