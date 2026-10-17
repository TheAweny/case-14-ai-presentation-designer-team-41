import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import type { ChatMode } from '@lct/contracts';
import {
  IconArrowUpRight,
  IconList,
  IconMessageCircle,
  IconBolt,
  IconFile,
  IconLayout,
  IconRefresh,
} from '@tabler/icons-react';
import PromptBar, { type PromptBarModel } from './components/PromptBar';
import { ChoicePicker } from './components/ChoicePicker';
import LatticeLoader, {
  type LatticePatternName,
  type LatticeStatus,
} from './components/LatticeLoader';
import ThoughtLine from './components/ThoughtLine';
import { LabMotionContext } from './motion-preference';
import './lab.css';

// Concrete model choices for the local simulation, not a list of connected runtimes.
const MODELS: (PromptBarModel & { effortSupport: 'available' | 'unavailable' })[] = [
  {
    key: 'Qwen/Qwen3.5-27B',
    name: 'Qwen3.5 27B',
    effortSupport: 'unavailable',
  },
  {
    key: 'openai/gpt-oss-20b',
    name: 'GPT OSS 20B',
    effortSupport: 'available',
  },
];
const MODES: { value: ChatMode; label: string }[] = [
  { value: 'chat', label: 'Чат' },
  { value: 'plan', label: 'План' },
  { value: 'auto', label: 'Авто' },
];
interface DemoRequest {
  text: string;
  attachments: string[];
  mode: ChatMode;
  model: string;
  reasoning: true;
  effort?: string;
}
const EFFORTS = ['Низкое', 'Среднее', 'Высокое'];
const STEPS = ['Изучаю материалы', 'Составляю план слайдов', 'Проверяю структуру'];
type PromptVariant = 'chat' | 'panel' | 'max';
type ThoughtVariant = 'trace' | 'inline' | 'dot';

function Variants<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="variants" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Section({
  id,
  title,
  source,
  variants,
  children,
}: {
  id: string;
  title: string;
  source: string;
  variants: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="component-section" aria-label={title}>
      <div className="section-header">
        <h2>
          {title}
          <a
            href={source}
            target="_blank"
            rel="noreferrer"
            aria-label={`${title} в React Bits`}
            title="Оригинал в React Bits"
          >
            <IconArrowUpRight size={16} />
          </a>
        </h2>
        {variants}
      </div>
      {children}
    </section>
  );
}

function chooseFiles(): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pptx,.potx,.pdf,.docx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg';
    input.onchange = () => resolve(Array.from(input.files ?? [], (file) => file.name));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function DemoPrompt({
  variant,
  busy,
  onSend,
  onStop,
}: {
  variant: PromptVariant;
  busy: boolean;
  onSend: (request: DemoRequest) => void;
  onStop: () => void;
}) {
  const defaultModel = variant === 'max' ? MODELS[1].key : MODELS[0].key;
  const [model, setModel] = useState(defaultModel);
  const [mode, setMode] = useState<ChatMode>('plan');
  const effortAvailable = MODELS.find((item) => item.key === model)?.effortSupport === 'available';
  return (
    <div className={`demo-prompt variant-${variant}`} data-testid="scene-prompt">
      <PromptBar
        modes={MODES.map((item) => ({
          key: item.value,
          name: item.label,
          icon:
            item.value === 'chat' ? (
              <IconMessageCircle size={16} aria-hidden />
            ) : item.value === 'plan' ? (
              <IconList size={16} aria-hidden />
            ) : (
              <IconBolt size={16} aria-hidden />
            ),
        }))}
        mode={mode}
        onModeChange={(key) => {
          const next = MODES.find((item) => item.value === key);
          if (next) setMode(next.value);
        }}
        placeholder={variant === 'panel' ? 'Что изменить на слайде?' : 'Что хотите создать?'}
        models={MODELS}
        defaultModel={defaultModel}
        onModelChange={(next) => setModel(next.key)}
        efforts={effortAvailable ? EFFORTS : []}
        defaultEffort="Высокое"
        sources={[
          {
            key: 'files',
            name: 'Загрузить материалы',
            description: 'С вашего устройства',
            icon: <IconFile size={17} />,
            attach: true,
          },
          {
            key: 'template',
            name: 'Шаблон',
            description: 'Добавить файл оформления',
            icon: <IconLayout size={17} />,
            attach: true,
          },
        ]}
        commands={[
          { key: 'plan', name: '/план', description: 'Согласовать структуру' },
          { key: 'build', name: '/создать', description: 'Собрать презентацию' },
          { key: 'shorten', name: '/сократить', description: 'Оставить главное' },
        ]}
        background="#27272a"
        color="#f5f5f5"
        menuBackground="#323236"
        sparkColor="#d4d4d8"
        sparkBoost={1}
        width={variant === 'panel' ? 360 : 640}
        radius={16}
        morphDuration={240}
        busy={busy}
        onAttach={chooseFiles}
        attachmentButton="direct"
        onSend={(message, detail) =>
          onSend({
            text: message,
            attachments: detail.attachments,
            mode,
            model: detail.model?.key ?? model,
            reasoning: true,
            ...(detail.effort ? { effort: detail.effort } : {}),
          })
        }
        onStop={onStop}
      />
    </div>
  );
}

function Thought({
  working,
  step = 3,
  elapsed,
  kind = 'trace',
  mode = 'plan',
}: {
  working: boolean;
  step?: number;
  elapsed?: number;
  kind?: ThoughtVariant;
  mode?: ChatMode;
}) {
  return (
    <ThoughtLine
      label={mode === 'chat' ? 'Продумываю ответ' : 'Продумываю структуру'}
      doneLabel={mode === 'chat' ? 'Ответ продуман за' : 'Структура продумана за'}
      steps={
        kind === 'trace'
          ? (mode === 'chat'
              ? ['Читаю запрос и материалы', 'Сопоставляю факты', 'Формулирую ответ']
              : STEPS
            ).slice(0, step)
          : []
      }
      glyph={kind === 'dot' ? 'dot' : 'sparkle'}
      collapsible={kind === 'trace'}
      working={working}
      elapsed={elapsed}
      fontSize={15}
      color="#d4d4d8"
      glyphColor="#d4d4d8"
      settleDuration={240}
      settleBlur={2}
    />
  );
}

function PromptDemo() {
  const [variant, setVariant] = useState<PromptVariant>('chat');
  const [phase, setPhase] = useState<
    'idle' | 'thinking' | 'planned' | 'chatDone' | 'building' | 'done' | 'stopped'
  >('idle');
  const [request, setRequest] = useState<DemoRequest | null>(null);
  const [step, setStep] = useState(1);
  const [run, setRun] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);
  const busy = phase === 'thinking' || phase === 'building';
  useEffect(() => {
    if (!run || !request) return;
    started.current = performance.now();
    const timers = [
      window.setTimeout(() => setStep(2), 1000),
      window.setTimeout(() => setStep(3), 2100),
      window.setTimeout(() => {
        setElapsed((performance.now() - started.current) / 1000);
        setPhase(
          request.mode === 'chat' ? 'chatDone' : request.mode === 'plan' ? 'planned' : 'building',
        );
      }, 3400),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [run, request]);
  useEffect(() => {
    if (phase !== 'building') return;
    const timer = window.setTimeout(() => setPhase('done'), 3600);
    return () => window.clearTimeout(timer);
  }, [phase]);
  const reset = () => {
    setRun(0);
    setPhase('idle');
    setRequest(null);
    setStep(1);
  };
  const send = (message: DemoRequest) => {
    if (busy) return;
    setRequest(message);
    setStep(1);
    setPhase('thinking');
    setRun((value) => value + 1);
  };
  const stop = () => {
    setRun(0);
    setPhase('stopped');
  };
  return (
    <Section
      id="prompt"
      title="Prompt Bar"
      source="https://reactbits.dev/c/micro/prompt-bar"
      variants={
        <Variants
          label="Вариант поля"
          value={variant}
          options={[
            { value: 'chat', label: 'В чате' },
            { value: 'panel', label: 'В панели' },
            { value: 'max', label: 'Max effort' },
          ]}
          onChange={(value) => {
            reset();
            setVariant(value);
          }}
        />
      }
    >
      <div
        className={`playground scene prompt-playground${phase !== 'idle' ? ' has-response' : ''}`}
      >
        {phase !== 'idle' ? (
          <div
            className="conversation"
            aria-label="Демонстрация ответа"
            data-model={request?.model}
          >
            <div className="user-message">
              {request?.text ? <p>{request.text}</p> : null}
              {request?.attachments.length ? (
                <ul className="sent-attachments" aria-label="Прикреплённые файлы">
                  {request.attachments.map((file, index) => (
                    <li key={file + index}>
                      <IconFile size={14} aria-hidden />
                      {file}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {phase === 'thinking' ? <Thought working step={step} mode={request?.mode} /> : null}
            {phase === 'building' || phase === 'done' ? (
              <div className="build-progress">
                <Thought working={false} elapsed={elapsed} mode={request?.mode} />
                <LatticeLoader
                  label="Собираю презентацию"
                  doneLabel="Презентация готова"
                  status={phase === 'done' ? 'done' : 'working'}
                  pattern="orbit"
                  grid={3}
                  shape="round"
                  cellSize={4}
                  gap={2}
                  color="#d4d4d8"
                  fontSize={15}
                  elapsed={phase === 'done' ? 3.6 : undefined}
                />
                {phase === 'done' ? (
                  <p className="result-strip">8 слайдов, 3 варианта. Это демонстрация состояний.</p>
                ) : null}
              </div>
            ) : null}
            {phase === 'planned' ? (
              <div className="plan-result">
                <Thought working={false} elapsed={elapsed} />
                <ol>
                  <li>Цель и основные выводы</li>
                  <li>Результаты и подтверждающие данные</li>
                  <li>Следующие шаги</li>
                </ol>
                <button className="state-action" onClick={() => setPhase('building')}>
                  Собрать по плану
                </button>
              </div>
            ) : null}
            {phase === 'chatDone' ? (
              <div className="chat-result">
                <Thought working={false} elapsed={elapsed} mode="chat" />
                <p>
                  Можем обсудить материалы, выделить главные тезисы или перейти к плану презентации.
                </p>
              </div>
            ) : null}
            {phase === 'stopped' ? <p className="stopped">Остановлено</p> : null}
          </div>
        ) : null}
        <DemoPrompt key={variant} variant={variant} busy={busy} onSend={send} onStop={stop} />
      </div>
      <div className="component-footer">
        <p>Скрепка — файлы &nbsp; / команды &nbsp; · &nbsp; Enter — отправить</p>
        <button className="reset" onClick={reset}>
          <IconRefresh size={14} /> Сначала
        </button>
      </div>
      <p className="component-note">
        Модели размышляют во всех режимах, если поддерживают это. Глубина зависит от подключения.
      </p>
    </Section>
  );
}

function LoaderDemo() {
  const [status, setStatus] = useState<LatticeStatus>('working');
  const [grid, setGrid] = useState<'3' | '4'>('3');
  const [pattern, setPattern] = useState<LatticePatternName>('orbit');
  const [resetKey, setResetKey] = useState(0);
  return (
    <Section
      id="loader"
      title="Lattice Loader"
      source="https://reactbits.dev/c/micro/lattice-loader"
      variants={
        <Variants
          label="Размер решётки"
          value={grid}
          options={[
            { value: '3', label: '3 × 3' },
            { value: '4', label: '4 × 4' },
          ]}
          onChange={(value) => {
            setGrid(value);
            setStatus('working');
            setPattern(value === '4' ? 'sweep' : 'orbit');
          }}
        />
      }
    >
      <div className="playground status-playground loader-examples">
        <LatticeLoader
          key={`${grid}-${pattern}-${resetKey}`}
          label="Анализирую материалы"
          doneLabel="Материалы изучены"
          errorLabel="Не удалось прочитать файл"
          grid={grid === '3' ? 3 : 4}
          pattern={pattern}
          status={status}
          color="#e4e4e7"
          fontSize={15}
          cellSize={grid === '3' ? 5 : 4}
          gap={2}
          shape={grid === '3' ? 'round' : 'square'}
        />
      </div>
      <div className="component-footer">
        <Variants
          label="Состояние загрузчика"
          value={status}
          options={[
            { value: 'working', label: 'Работа' },
            { value: 'done', label: 'Готово' },
            { value: 'error', label: 'Ошибка' },
          ]}
          onChange={setStatus}
        />
        <div className="loader-settings">
          <span className="loader-settings__label">Рисунок</span>
          <ChoicePicker
            label="Рисунок"
            value={pattern}
            onChange={(key) => setPattern(key as LatticePatternName)}
            options={(grid === '3'
              ? ['orbit', 'ripple', 'snake', 'spiral']
              : ['sweep', 'spin', 'rain', 'pulse']
            ).map((key) => ({ key, name: key[0].toUpperCase() + key.slice(1) }))}
          />
          <button
            className="reset"
            onClick={() => {
              setResetKey((value) => value + 1);
              setStatus('working');
            }}
            aria-label="Повторить загрузку"
            title="Повторить"
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </div>
    </Section>
  );
}

function ThoughtDemo() {
  const [kind, setKind] = useState<ThoughtVariant>('trace');
  const [working, setWorking] = useState(true);
  const [run, setRun] = useState(0);
  return (
    <Section
      id="thought"
      title="Thought Line"
      source="https://reactbits.dev/c/micro/thought-line"
      variants={
        <Variants
          label="Вид строки размышления"
          value={kind}
          options={[
            { value: 'trace', label: 'С этапами' },
            { value: 'inline', label: 'В одну строку' },
            { value: 'dot', label: 'Точка' },
          ]}
          onChange={setKind}
        />
      }
    >
      <div className="playground thought-playground">
        <div className="thought-example">
          <Thought key={`${run}-${kind}`} kind={kind} working={working} />
        </div>
      </div>
      <div className="component-footer">
        <button className="state-action" onClick={() => setWorking((value) => !value)}>
          {working ? 'Завершить мысль' : 'Продолжить'}
        </button>
        <button
          className="reset"
          onClick={() => {
            setRun((value) => value + 1);
            setWorking(true);
          }}
        >
          <IconRefresh size={14} /> Повторить
        </button>
      </div>
    </Section>
  );
}

function App() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.reduced = String(reduced);
  }, [reduced]);
  return (
    <LabMotionContext.Provider value={reduced}>
      <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
        <div className="lab">
          <a className="skip-link" href="#prompt">
            К компонентам
          </a>
          <header className="lab-header">
            <a href="#prompt" className="page-title">
              Компоненты <span>/ демо</span>
            </a>
            <label className="motion-control">
              <input
                type="checkbox"
                role="switch"
                aria-label="Меньше движения"
                checked={reduced}
                onChange={(event) => setReduced(event.currentTarget.checked)}
              />{' '}
              Меньше движения
            </label>
          </header>
          <main>
            <PromptDemo />
            <LoaderDemo />
            <ThoughtDemo />
          </main>
          <footer>
            <span>React Bits · Локальное демо</span>
            <span>Запросы к модели не отправляются.</span>
          </footer>
        </div>
      </MotionConfig>
    </LabMotionContext.Provider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Motion lab root element is missing');
createRoot(root).render(<App />);
