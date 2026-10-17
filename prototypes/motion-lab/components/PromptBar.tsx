// Adapted from React Bits by David Haz. See LICENSE.txt and ../README.md.
'use client';

import React, {
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  animate,
  useMotionValue,
  useMotionValueEvent,
  type AnimationPlaybackControls,
} from 'motion/react';
import { IconChevronDown, IconCheck } from '@tabler/icons-react';
import { useLabReducedMotion as useReducedMotion } from '../motion-preference';
import { HugeiconsIcon, type IconSvgElement } from './icons';
import { ChoicePicker, type ChoiceOption } from './ChoicePicker';
import {
  Attachment01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChartLineData01Icon,
  File02Icon,
  Globe02Icon,
  Mail01Icon,
  Mic01Icon,
  PlusSignIcon,
} from './icons';
import './PromptBar.css';

export interface PromptBarSource {
  key: string;
  name: string;
  description?: string;
  icon?: ReactNode | IconSvgElement;
  attach?: boolean;
}

export interface PromptBarCommand {
  key: string;
  name: string;
  description?: string;
}

export interface PromptBarModel {
  key: string;
  name: string;
  tag?: string;
}

export interface PromptBarSendDetail {
  attachments: string[];
  model?: PromptBarModel;
  effort?: string;
}

export interface PromptBarProps {
  placeholder?: string;
  sources?: PromptBarSource[];
  commands?: PromptBarCommand[];
  models?: PromptBarModel[];
  defaultModel?: string;
  onModelChange?: (model: PromptBarModel) => void;
  efforts?: string[];
  defaultEffort?: string;
  onEffortChange?: (effort: string) => void;
  busy?: boolean;
  onSend?: (text: string, detail: PromptBarSendDetail) => void;
  onStop?: () => void;
  onAttach?: () => string | string[] | void | Promise<string | string[] | void>;
  attachmentButton?: 'menu' | 'direct';
  toolbarStart?: ReactNode;
  modes?: readonly ChoiceOption[];
  mode?: string;
  onModeChange?: (mode: string) => void;
  onDictate?: () => string | void | Promise<string | void>;
  background?: string;
  color?: string;
  menuBackground?: string;
  sparkColor?: string;
  sparkBoost?: number;
  width?: number;
  radius?: number;
  maxRows?: number;
  morphDuration?: number;
  squash?: number;
  tilt?: number;
  pressScale?: number;
  className?: string;
}

type Row = {
  key: string;
  name: string;
  description?: string;
  tag?: string;
  icon?: ReactNode | IconSvgElement;
  attach?: boolean;
};
type Token = { kind: 'at' | 'slash'; query: string; start: number };
type Latest = Pick<
  PromptBarProps,
  'onSend' | 'onStop' | 'onAttach' | 'onDictate' | 'onEffortChange'
>;
type Spark = {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  phase: number;
  life: number;
  span: number;
};

interface SendGlyphProps {
  busy: boolean;
  morphDuration: number;
  squash: number;
  tilt: number;
}

// An open, retraced arrow keeps a thin shaft and two simple strokes at the tip.
// Matching vertices preserve the continuous morph into the filled stop square.
const ARROW_UP = [12, 19, 12, 5, 6, 11, 12, 5, 18, 11];
const SQUARE = [7, 17, 7, 7, 17, 7, 17, 17, 7, 17];
const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1];
const LINE = 22;
const EDGE = 12;

const DEFAULT_SOURCES: PromptBarSource[] = [
  {
    key: 'files',
    name: 'Photos & files',
    description: 'Upload from this device',
    icon: Attachment01Icon,
    attach: true,
  },
  { key: 'web', name: 'Web search', description: 'Live results', icon: Globe02Icon },
  { key: 'sales', name: 'Sales data', description: 'Revenue and churn', icon: ChartLineData01Icon },
  { key: 'docs', name: 'Documents', description: 'Specs, notes, briefs', icon: File02Icon },
  { key: 'mail', name: 'Mail', description: 'Read and draft mail', icon: Mail01Icon },
  {
    key: 'calendar',
    name: 'Calendar',
    description: 'Events and availability',
    icon: Calendar03Icon,
  },
];
const DEFAULT_COMMANDS: PromptBarCommand[] = [
  { key: 'summarize', name: '/summarize', description: 'Digest the thread so far' },
  { key: 'compare', name: '/compare', description: 'Two options side by side' },
  { key: 'draft', name: '/draft', description: 'Write a first version' },
  { key: 'explain', name: '/explain', description: 'A plain-language walkthrough' },
  { key: 'tasks', name: '/tasks', description: 'Turn this into a to-do list' },
];
const DEFAULT_MODELS: PromptBarModel[] = [
  { key: 'nova-3', name: 'Nova 3', tag: 'Flagship' },
  { key: 'nova-mini', name: 'Nova Mini', tag: 'Fast' },
  { key: 'nova-2', name: 'Nova 2', tag: 'Legacy' },
];
const DEFAULT_EFFORTS = ['Low', 'Medium', 'High', 'Extra', 'Max'];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pathAt = (a: number[], b: number[], t: number) => {
  let d = '';
  for (let i = 0; i < a.length; i += 2) {
    d += `${i ? 'L' : 'M'}${mix(a[i], b[i], t).toFixed(2)} ${mix(a[i + 1], b[i + 1], t).toFixed(2)}`;
  }
  return d;
};

const parseToken = (draft: string): Token | null => {
  const m = /(^|\s)([@/])([\p{L}\p{N}_-]*)$/u.exec(draft);
  if (!m) return null;
  return {
    kind: m[2] === '@' ? 'at' : 'slash',
    query: m[3].toLowerCase(),
    start: m.index + m[1].length,
  };
};

const renderIcon = (icon: ReactNode | IconSvgElement, size: number) =>
  isValidElement(icon) ? (
    icon
  ) : (
    <HugeiconsIcon icon={icon as IconSvgElement} size={size} strokeWidth={1.8} />
  );

function SendGlyph({ busy, morphDuration, squash, tilt }: SendGlyphProps) {
  const reduce = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dir = useRef(busy ? 1 : -1);
  const t = useMotionValue(busy ? 1 : 0);

  useEffect(() => {
    const target = busy ? 1 : 0;
    dir.current = busy ? 1 : -1;
    if (t.get() === target) return undefined;
    const controls = animate(
      t,
      target,
      reduce ? { duration: 0 } : { duration: morphDuration / 1000, ease: EASE_IN_OUT },
    );
    return () => controls.stop();
  }, [busy, morphDuration, reduce, t]);

  useMotionValueEvent(t, 'change', (v) => {
    pathRef.current?.setAttribute('d', pathAt(ARROW_UP, SQUARE, v));
    pathRef.current?.setAttribute('fill-opacity', String(v));
    const goo = reduce ? 0 : Math.sin(v * Math.PI);
    const sx = 1 - squash * goo;
    if (svgRef.current) {
      svgRef.current.style.transform = goo
        ? `rotate(${dir.current * tilt * goo}deg) scale(${sx}, ${1 / sx})`
        : '';
    }
  });

  return (
    <svg
      ref={svgRef}
      className="prompt-bar__glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path ref={pathRef} d={pathAt(ARROW_UP, SQUARE, t.get())} fillOpacity={t.get()} />
    </svg>
  );
}

const PromptBar: React.FC<PromptBarProps> = ({
  placeholder = 'Ask anything',
  sources = DEFAULT_SOURCES,
  commands = DEFAULT_COMMANDS,
  models = DEFAULT_MODELS,
  defaultModel = '',
  onModelChange,
  efforts = DEFAULT_EFFORTS,
  defaultEffort = '',
  onEffortChange,
  busy = false,
  onSend,
  onStop,
  onAttach,
  attachmentButton = 'menu',
  toolbarStart,
  modes = [],
  mode = '',
  onModeChange,
  onDictate,
  background = '#27272a',
  color = '#f5f5f5',
  menuBackground = '#323236',
  sparkColor = '#b39dff',
  sparkBoost = 1,
  width = 400,
  radius = 16,
  maxRows = 5,
  morphDuration = 240,
  squash = 0.12,
  tilt = 8,
  pressScale = 0.96,
  className = '',
}) => {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const effortTrackRef = useRef<HTMLDivElement>(null);
  const effortThumbRef = useRef<HTMLSpanElement>(null);
  const effortFillRef = useRef<HTMLSpanElement>(null);
  const lastEffortTrack = useRef<HTMLDivElement | null>(null);
  const typing = useRef({ energy: 0, strokes: 0 });
  const boost = useRef(sparkBoost);
  boost.current = sparkBoost;
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lastOpen = useRef<string | null>(null);
  const dictation = useRef(0);
  const latest = useRef<Latest>({});
  latest.current = { onSend, onStop, onAttach, onDictate, onEffortChange };

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [modelKey, setModelKey] = useState(defaultModel);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortIndex, setEffortIndex] = useState(() => {
    const i = efforts.indexOf(defaultEffort);
    return i >= 0 ? i : Math.max(0, Math.floor((efforts.length - 1) / 2));
  });
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);

  const model = models.find((m) => m.key === modelKey) ?? models[0];
  const token = dismissed ? null : parseToken(draft);
  const open = plusOpen ? 'at' : (token?.kind ?? (effortOpen ? 'effort' : null));
  const query = plusOpen ? '' : (token?.query ?? '');
  const list = useMemo<Row[]>(() => {
    if (open === 'at') return sources.filter((s) => s.name.toLowerCase().includes(query));
    if (open === 'slash')
      return commands.filter((c) => c.name.replace(/^\//, '').toLowerCase().startsWith(query));
    return [];
  }, [open, query, sources, commands]);
  const cursor = Math.min(active, Math.max(0, list.length - 1));
  const canSend = draft.trim().length > 0 || attachments.length > 0;
  const armed = busy || canSend;
  const level = efforts[effortIndex] ?? '';
  const maxed = efforts.length > 1 && effortIndex === efforts.length - 1;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (open !== 'effort' || !menu) return;
    const place = () => {
      const root = rootRef.current?.getBoundingClientRect();
      if (!root) return;
      const above = root.top - menu.offsetHeight - 8 >= 12;
      menu.style.bottom = above ? 'calc(100% + 8px)' : 'auto';
      menu.style.top = above ? 'auto' : 'calc(100% + 8px)';
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    const track = effortTrackRef.current;
    const thumb = effortThumbRef.current;
    const fill = effortFillRef.current;
    if (open !== 'effort' || !track || !thumb || !fill) return;
    let controls: AnimationPlaybackControls[] = [];
    let measuredWidth = track.clientWidth;
    const paint = (smooth: boolean) => {
      controls.forEach((control) => control.stop());
      const width = track.clientWidth;
      const progress = effortIndex / Math.max(1, efforts.length - 1);
      const offset = Math.max(0, width - EDGE * 2) * progress;
      const fraction = progress === 1 ? 1 : Math.min(1, (EDGE + offset + 7) / Math.max(1, width));
      const thumbTransform = `translateX(${offset}px)`;
      const fillTransform = `scaleX(${fraction})`;
      if (!smooth || reduce) {
        thumb.style.transform = thumbTransform;
        fill.style.transform = fillTransform;
        return;
      }
      const transition = {
        duration: 0.22,
        ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
      };
      controls = [
        animate(thumb, { transform: thumbTransform }, transition),
        animate(fill, { transform: fillTransform }, transition),
      ];
    };
    paint(lastEffortTrack.current === track);
    lastEffortTrack.current = track;
    const observer = new ResizeObserver(() => {
      if (track.clientWidth === measuredWidth) return;
      measuredWidth = track.clientWidth;
      paint(false);
    });
    observer.observe(track);
    return () => {
      controls.forEach((control) => control.stop());
      observer.disconnect();
    };
  }, [open, effortIndex, efforts.length, reduce]);

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  const closeMenus = useCallback(() => {
    setPlusOpen(false);
    setModeOpen(false);
    setEffortOpen(false);
  }, []);

  useLayoutEffect(() => {
    const glow = glowRef.current;
    if (!glow || !open) return;
    const row = rowRefs.current[cursor];
    if (!row) {
      glow.style.opacity = '0';
      return;
    }
    const fresh = lastOpen.current !== open;
    lastOpen.current = open;
    if (fresh) glow.style.transition = 'none';
    glow.style.transform = `translateY(${row.offsetTop}px)`;
    glow.style.height = `${row.offsetHeight}px`;
    glow.style.opacity = '1';
    if (fresh) {
      void glow.offsetHeight;
      glow.style.transition = '';
    }
  }, [open, cursor, list]);
  useEffect(() => {
    if (!open) lastOpen.current = null;
  }, [open]);

  useEffect(() => {
    if (!plusOpen && !modeOpen && !effortOpen) return undefined;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenus();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [plusOpen, modeOpen, effortOpen, closeMenus]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const max = LINE * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [draft, maxRows]);

  useEffect(
    () => () => {
      dictation.current += 1;
    },
    [],
  );

  useEffect(() => {
    const canvas = sparkRef.current;
    if (!maxed || reduce || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    typing.current.strokes = 0;
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let due = 0;
    let speed = 1;
    let pulse = 0;
    const parts: Spark[] = [];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = (burst: boolean) => {
      parts.push({
        x: Math.random() * w,
        y: burst ? h * (0.2 + Math.random() * 0.8) : h + 3,
        r: 0.9 + Math.random() * 1.1,
        vy: -(7 + Math.random() * 9),
        sway: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
        life: burst ? Math.random() * 1.2 : 0,
        span: 2.4 + Math.random() * 2.4,
      });
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const typed = typing.current;
      const gain = boost.current;
      typed.energy *= Math.exp(-dt / 0.8);
      pulse *= Math.exp(-dt / 0.16);
      if (typed.strokes > 0) {
        typed.strokes = 0;
        if (gain > 0) pulse = 1;
      }
      const energy = typed.energy * gain;
      speed += (1 + energy * 6 - speed) * (1 - Math.exp(-dt / 0.15));
      due += dt;
      while (due > 0.14) {
        due -= 0.14;
        if (parts.length < 30) spawn(false);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = sparkColor;
      ctx.shadowColor = sparkColor;
      ctx.shadowBlur = 6 + energy * 10 + pulse * 6;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.life += dt;
        if (p.life > p.span) {
          parts.splice(i, 1);
          continue;
        }
        const k = p.life / p.span;
        const twinkle = 0.7 + 0.3 * Math.sin((now / 160) * (1 + energy) + p.phase);
        p.y += p.vy * dt * speed;
        if (p.y < -4) {
          p.y = h + 3;
          p.x = Math.random() * w;
        }
        const edge = Math.min(1, Math.max(0, p.y / 14), Math.max(0, (h - p.y) / 14));
        ctx.globalAlpha =
          Math.min(1, Math.sin(k * Math.PI) * (0.9 + energy * 0.25) * twinkle) * edge;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.sin((now / 900) * (1 + energy * 0.8) + p.phase) * p.sway,
          p.y,
          p.r * twinkle * (1 + energy * 0.35),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    resize();
    for (let i = 0; i < 26; i += 1) spawn(true);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [maxed, reduce, sparkColor]);

  const setEffort = (i: number) => {
    const next = Math.max(0, Math.min(efforts.length - 1, i));
    if (next === effortIndex) return;
    setEffortIndex(next);
    latest.current.onEffortChange?.(efforts[next]);
  };
  const effortFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = (e.clientX - rect.left - EDGE) / Math.max(1, rect.width - 2 * EDGE);
    setEffort(Math.round(k * (efforts.length - 1)));
  };
  const onEffortKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (step) {
      e.preventDefault();
      setEffort(effortIndex + step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setEffort(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setEffort(efforts.length - 1);
    } else if (e.key === 'Escape') {
      setEffortOpen(false);
      focusInput();
    }
  };
  const stepAt = (i: number) =>
    `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${i / Math.max(1, efforts.length - 1)})`;

  const pick = (row: Row) => {
    const head = token ? draft.slice(0, token.start) : draft;
    if (row.attach) {
      setDraft(head);
      Promise.resolve(latest.current.onAttach?.()).then((files) => {
        if (!files) return;
        setAttachments((a) => [...a, ...(Array.isArray(files) ? files : [files])]);
      });
    } else if (open === 'at') {
      setDraft(`${head}@${row.name} `);
    } else {
      setDraft(`${head}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    focusInput();
  };

  const send = () => {
    if (!canSend || busy) return;
    latest.current.onSend?.(draft.trim(), {
      attachments,
      model,
      ...(efforts.length > 0 ? { effort: level } : {}),
    });
    setDraft('');
    setAttachments([]);
    setDismissed(false);
    closeMenus();
    focusInput();
  };

  const toggleListen = () => {
    if (listening) {
      dictation.current += 1;
      setListening(false);
      return;
    }
    const seq = ++dictation.current;
    setListening(true);
    Promise.resolve(latest.current.onDictate?.()).then(
      (text) => {
        if (seq !== dictation.current) return;
        setListening(false);
        if (text) setDraft((d) => (d.trim() ? `${d.trimEnd()} ${text}` : text));
        focusInput();
      },
      () => {
        if (seq === dictation.current) setListening(false);
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((cursor + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(list[cursor]);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
        closeMenus();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !armed) return;
    setPressed(true);
  };
  const up = () => setPressed(false);

  return (
    <div
      ref={rootRef}
      className={`prompt-bar${className ? ` ${className}` : ''}`}
      data-busy={busy ? '' : undefined}
      data-max={maxed ? '' : undefined}
      style={
        {
          '--pb-bg': background,
          '--pb-ink': color,
          '--pb-menu': menuBackground,
          '--pb-w': `${width}px`,
          '--pb-radius': `${radius}px`,
          '--pb-spark': sparkColor,
          '--pb-press': pressScale,
        } as CSSProperties
      }
    >
      {open ? (
        <div
          ref={menuRef}
          className="prompt-bar__menu"
          role={open === 'effort' ? 'dialog' : 'listbox'}
          aria-label={
            open === 'at' ? 'Материалы' : open === 'slash' ? 'Команды' : 'Модель и размышление'
          }
          data-kind={open}
          onKeyDown={(event) => {
            if (open === 'effort' && event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeMenus();
              focusInput();
            }
          }}
        >
          {open === 'effort' ? (
            <>
              <div className="prompt-bar__model-options" role="listbox" aria-label="Модели">
                {models.map((item, index) => (
                  <button
                    type="button"
                    role="option"
                    key={item.key}
                    aria-selected={item.key === model?.key}
                    className="prompt-bar__row"
                    onClick={() => {
                      setModelKey(item.key);
                      onModelChange?.(item);
                    }}
                    onKeyDown={(event) => {
                      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
                      const parent = event.currentTarget.parentElement;
                      if (step && parent) {
                        event.preventDefault();
                        parent
                          .querySelectorAll<HTMLButtonElement>('button')
                          [(index + step + models.length) % models.length]?.focus();
                      }
                    }}
                  >
                    <span className="prompt-bar__row-name">{item.name}</span>
                    {item.key === model?.key ? (
                      <IconCheck className="prompt-bar__model-check" size={15} aria-hidden />
                    ) : null}
                  </button>
                ))}
              </div>
              {efforts.length > 0 ? (
                <div className="prompt-bar__effort-head">
                  <span className="prompt-bar__effort-title">Усилие</span>
                  <span key={level} className="prompt-bar__effort-level prompt-bar__effort-name">
                    {level}
                  </span>
                </div>
              ) : null}
              {efforts.length > 0 ? (
                <div
                  ref={effortTrackRef}
                  className="prompt-bar__effort-track"
                  role="slider"
                  tabIndex={0}
                  aria-label="Effort"
                  aria-valuemin={0}
                  aria-valuemax={efforts.length - 1}
                  aria-valuenow={effortIndex}
                  aria-valuetext={level}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                      // Pointer capture is optional when the browser already released this pointer.
                    }
                    e.currentTarget.focus({ preventScroll: true });
                    effortFromPointer(e);
                  }}
                  onPointerMove={(e) => {
                    if (e.buttons & 1) effortFromPointer(e);
                  }}
                  onKeyDown={onEffortKey}
                >
                  <span ref={effortFillRef} className="prompt-bar__effort-fill" />
                  {efforts.map((label, i) => (
                    <i key={label} className="prompt-bar__effort-dot" style={{ left: stepAt(i) }} />
                  ))}
                  <span ref={effortThumbRef} className="prompt-bar__effort-thumb" />
                </div>
              ) : (
                <p className="prompt-bar__effort-fixed">Размышление включено</p>
              )}
            </>
          ) : (
            <>
              <div>
                <span ref={glowRef} className="prompt-bar__glow" aria-hidden="true" />
                {list.map((row, i) => (
                  <button
                    key={row.key}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={i === cursor}
                    className="prompt-bar__row"
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => pick(row)}
                  >
                    {open === 'at' ? (
                      <span className="prompt-bar__row-icon">{renderIcon(row.icon, 15)}</span>
                    ) : null}
                    <span className="prompt-bar__row-name">{row.name}</span>
                    {row.description ? (
                      <span className="prompt-bar__row-desc">{row.description}</span>
                    ) : null}
                  </button>
                ))}
                {list.length === 0 ? (
                  <div className="prompt-bar__empty">Ничего не найдено по запросу «{query}»</div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      <div
        className="prompt-bar__field"
        role="presentation"
        data-max={maxed ? '' : undefined}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLSelectElement) closeMenus();
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || e.target === inputRef.current) closeMenus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) focusInput();
        }}
      >
        <canvas ref={sparkRef} className="prompt-bar__sparks" aria-hidden="true" />
        {attachments.length > 0 ? (
          <div className="prompt-bar__chips">
            {attachments.map((file, i) => (
              <span key={`${file}-${i}`} className="prompt-bar__chip">
                <HugeiconsIcon icon={File02Icon} size={12} strokeWidth={2} />
                <span className="prompt-bar__chip-name">{file}</span>
                <button
                  type="button"
                  className="prompt-bar__chip-x"
                  aria-label={`Убрать ${file}`}
                  onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          className="prompt-bar__input"
          rows={1}
          value={draft}
          placeholder={listening ? 'Listening…' : placeholder}
          aria-label="Запрос"
          onChange={(e) => {
            setDraft(e.target.value);
            typing.current.energy = Math.min(1.6, typing.current.energy + 0.22);
            typing.current.strokes = Math.min(4, typing.current.strokes + 1);
            setDismissed(false);
            closeMenus();
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />

        <div className="prompt-bar__bar">
          <button
            type="button"
            className="prompt-bar__tool"
            aria-label={attachmentButton === 'direct' ? 'Прикрепить файлы' : 'Добавить материалы'}
            title={attachmentButton === 'direct' ? 'Прикрепить файлы' : 'Добавить материалы'}
            aria-expanded={attachmentButton === 'menu' ? plusOpen : undefined}
            data-on={plusOpen ? '' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (attachmentButton === 'direct') {
                closeMenus();
                Promise.resolve(latest.current.onAttach?.()).then((files) => {
                  if (!files) return;
                  setAttachments((current) => [
                    ...current,
                    ...(Array.isArray(files) ? files : [files]),
                  ]);
                });
                return;
              }
              setModeOpen(false);
              setEffortOpen(false);
              setActive(0);
              setPlusOpen((v) => !v);
              focusInput();
            }}
          >
            <HugeiconsIcon
              icon={attachmentButton === 'direct' ? Attachment01Icon : PlusSignIcon}
              size={16}
              strokeWidth={1.8}
            />
          </button>
          {toolbarStart}
          {modes.length > 0 ? (
            <ChoicePicker
              label="Режим"
              options={modes}
              value={mode}
              compact
              open={modeOpen}
              onOpenChange={(next) => {
                if (next) {
                  closeMenus();
                  setDismissed(true);
                }
                setModeOpen(next);
              }}
              onChange={(key) => onModeChange?.(key)}
            />
          ) : null}
          <span className="prompt-bar__spacer" />
          {models.length > 0 ? (
            <button
              type="button"
              className="prompt-bar__pick prompt-bar__model-pick"
              aria-label="Модель и размышление"
              title={`${model?.name ?? ''}${level ? ' · ' + level : ''}`}
              aria-haspopup="dialog"
              aria-expanded={effortOpen}
              data-on={effortOpen ? '' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setPlusOpen(false);
                setModeOpen(false);
                setDismissed(true);
                setEffortOpen(!effortOpen);
                focusInput();
              }}
            >
              <span className="prompt-bar__model-name">{model?.name}</span>
              {efforts.length > 0 ? (
                <span key={level} className="prompt-bar__effort-name prompt-bar__model-effort">
                  {level}
                </span>
              ) : null}
              <IconChevronDown size={12} aria-hidden />
            </button>
          ) : null}
          {onDictate ? (
            <button
              type="button"
              className="prompt-bar__tool"
              aria-label={listening ? 'Stop dictation' : 'Dictate'}
              aria-pressed={listening}
              data-on={listening ? '' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleListen}
            >
              {listening ? (
                <span className="prompt-bar__eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <HugeiconsIcon icon={Mic01Icon} size={15} strokeWidth={2} />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="prompt-bar__send"
            disabled={!armed}
            aria-label={busy ? 'Остановить' : 'Отправить'}
            data-armed={armed ? '' : undefined}
            data-pressed={pressed ? '' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            onClick={() => {
              if (busy) latest.current.onStop?.();
              else send();
            }}
          >
            <SendGlyph busy={busy} morphDuration={morphDuration} squash={squash} tilt={tilt} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptBar;
