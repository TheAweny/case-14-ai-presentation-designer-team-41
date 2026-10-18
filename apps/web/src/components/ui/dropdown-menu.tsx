'use client';

import * as React from 'react';
import { cn } from 'cn';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { CheckIcon, ChevronRightIcon } from '@/components/ui/icons';
import { menuItemClass, menuSurfaceClass } from '@/components/ui/menu-styles';

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 8,
  glow = false,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  /** Sliding row highlight from the prompt-bar prototype. */
  glow?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        collisionPadding={12}
        className={cn(
          menuSurfaceClass,
          'max-h-(--radix-dropdown-menu-content-available-height) w-[max(var(--radix-dropdown-menu-trigger-width),11rem)] min-w-32 max-w-[min(20rem,calc(100vw-2rem))] origin-bottom overflow-x-hidden overflow-y-auto data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left',
          glow && 'menu-glow-root',
          className,
        )}
        {...props}
      >
        {glow ? <SlidingHighlight>{children}</SlidingHighlight> : children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

/** The highlight slides between rows instead of swapping backgrounds. */
function SlidingHighlight({ children }: { children: React.ReactNode }) {
  const root = React.useRef<HTMLDivElement>(null);
  const mark = React.useRef<HTMLSpanElement>(null);
  const fresh = React.useRef(true);
  const frame = React.useRef(0);
  React.useLayoutEffect(() => {
    const el = root.current;
    const glow = mark.current;
    if (!el || !glow) return;
    const place = (instant = false) => {
      const row = el.querySelector<HTMLElement>('[data-highlighted]');
      if (!row) {
        glow.style.opacity = '0';
        return;
      }
      const box = row.getBoundingClientRect();
      const base = el.getBoundingClientRect();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const snap = fresh.current || instant || reduce;
      glow.style.transition = snap
        ? 'none'
        : 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms ease';
      glow.style.transform = `translateY(${box.top - base.top + el.scrollTop}px)`;
      glow.style.height = `${box.height}px`;
      glow.style.clipPath = clipToAncestors(row, el, box);
      glow.style.opacity = '1';
      fresh.current = false;
    };
    place();
    const observer = new MutationObserver(() => place(false));
    observer.observe(el, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-highlighted'],
    });
    const onScroll = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => place(true));
    };
    el.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', onScroll);
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => place(true));
    });
    resize.observe(el);
    for (const node of el.querySelectorAll<HTMLElement>('*')) {
      if (node.scrollHeight > node.clientHeight + 1) resize.observe(node);
    }
    return () => {
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame.current);
      motionQuery.removeEventListener('change', onScroll);
      el.removeEventListener('scroll', onScroll, true);
    };
  }, []);
  return (
    <div ref={root} className="relative">
      <span ref={mark} aria-hidden className="menu-glow" />
      {children}
    </div>
  );
}

function clipToAncestors(row: HTMLElement, root: HTMLElement, box: DOMRect) {
  let top = 0;
  let bottom = 0;
  for (let node = row.parentElement; node && node !== root; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowY} ${style.overflow}`)) continue;
    if (node.scrollHeight <= node.clientHeight + 1) continue;
    const view = node.getBoundingClientRect();
    top = Math.max(top, view.top - box.top);
    bottom = Math.max(bottom, box.bottom - view.bottom);
  }
  return top > 0 || bottom > 0 ? `inset(${top}px 0 ${bottom}px 0)` : '';
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(menuItemClass, 'group/dropdown-menu-item cursor-pointer', className)}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex min-h-9 cursor-pointer items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-[0.8125rem] outline-hidden select-none transition-colors duration-100 motion-reduce:transition-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7.5 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex min-h-9 cursor-pointer items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-[0.8125rem] outline-hidden select-none transition-colors duration-100 motion-reduce:transition-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7.5 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn('px-2 py-1.5 text-xs text-muted-foreground data-inset:pl-7.5', className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border/50', className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'ml-auto text-[0.625rem] tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        menuItemClass,
        'cursor-pointer data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        menuSurfaceClass,
        'min-w-32 origin-bottom overflow-hidden data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left',
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
