'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { formatElapsed } from './elapsed';
import {
  durationMs,
  isCardTool,
  isReadTool,
  type ActivityChipView,
  type ToolChipView,
} from './tool-activity';
import styles from './tool-call-chip.module.css';

type ToolText = ReturnType<typeof useTranslations<'deckChat.tools'>>;

function agentName(name: string, t: ToolText): string | null {
  switch (name) {
    case 'planner':
      return t('agentNames.planner');
    case 'writer':
      return t('agentNames.writer');
    case 'critic':
      return t('agentNames.critic');
    case 'rewriter':
      return t('agentNames.rewriter');
    case 'illustrator':
      return t('agentNames.illustrator');
    case 'web-researcher':
      return t('agentNames.webResearcher');
    case 'material-researcher':
      return t('agentNames.materialResearcher');
    default:
      return null;
  }
}

function cardLabel(
  name: 'ask_user' | 'propose_plan' | 'build_deck' | 'edit_slide',
  t: ToolText,
): string {
  switch (name) {
    case 'ask_user':
      return t('ask_user');
    case 'propose_plan':
      return t('propose_plan');
    case 'build_deck':
      return t('build_deck');
    case 'edit_slide':
      return t('edit_slide');
  }
}

export function toolChipLabel(name: string, state: ToolChipView['state'], t: ToolText): string {
  if (state === 'preparing') return t('preparing');
  const plain = isReadTool(name)
    ? t(name)
    : isCardTool(name)
      ? cardLabel(name, t)
      : (agentName(name, t) ?? name);
  if (state === 'cancelled') return t('cancelledTool', { name: plain });
  if (state === 'failed') return t('failed', { name: plain });
  if (state === 'running' && isReadTool(name)) return t(`running.${name}`);
  if (state === 'running' && isCardTool(name)) {
    switch (name) {
      case 'ask_user':
        return t('running.ask_user');
      case 'propose_plan':
        return t('running.propose_plan');
      case 'build_deck':
        return t('running.build_deck');
      case 'edit_slide':
        return t('running.edit_slide');
    }
  }
  return plain;
}

export function ToolCallChip({ chip, now }: { chip: ToolChipView; now: number }) {
  const t = useTranslations('deckChat.tools');
  const live = chip.state === 'running' || chip.state === 'preparing';
  const elapsed = live
    ? durationMs(chip.startedAt, null, now)
    : chip.finishedAt === null
      ? null
      : durationMs(chip.startedAt, chip.finishedAt, now);
  const detail = chip.state === 'preparing' ? null : chip.detail;
  return (
    <div className={styles.chip} data-tool-call={chip.callId} data-call-state={chip.state}>
      <CallDetails detail={chip.fullDetail} error={chip.error} name={chip.name}>
        <div className={styles.row}>
          <CallGlyph state={chip.state} />
          <span className={styles.name}>
            {toolChipLabel(chip.name, chip.state === 'failed' ? 'done' : chip.state, t)}
          </span>
          {detail ? <span className={styles.detail}>{detail}</span> : null}
          {elapsed === null ? null : <time className={styles.time}>{formatElapsed(elapsed)}</time>}
        </div>
      </CallDetails>
      {chip.activities.length > 0 ? (
        <ul className={styles.children}>
          {chip.activities.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} now={now} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActivityRow({ activity, now }: { activity: ActivityChipView; now: number }) {
  const t = useTranslations('deckChat.tools');
  const elapsed =
    activity.state === 'running'
      ? durationMs(activity.startedAt, null, now)
      : activity.finishedAt === null
        ? null
        : durationMs(activity.startedAt, activity.finishedAt, now);
  return (
    <li
      className={styles.childRow}
      data-activity-id={activity.id}
      data-activity-kind={activity.kind}
      data-call-state={activity.state}
    >
      <CallDetails detail={activity.fullDetail} error={activity.error} name={activity.name}>
        <div className={styles.row}>
          <CallGlyph state={activity.state} />
          <span className={styles.name}>
            {toolChipLabel(activity.name, activity.state === 'failed' ? 'done' : activity.state, t)}
          </span>
          {activity.detail ? <span className={styles.detail}>{activity.detail}</span> : null}
          {elapsed === null ? null : <time className={styles.time}>{formatElapsed(elapsed)}</time>}
        </div>
      </CallDetails>
      {activity.children.length > 0 ? (
        <ul className={styles.children}>
          {activity.children.map((child) => (
            <ActivityRow key={child.id} activity={child} now={now} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CallDetails({
  detail,
  error,
  name,
  children,
}: {
  detail: string | null;
  error: string | null;
  name: string;
  children: ReactNode;
}) {
  const t = useTranslations('deckChat.tools');
  const reason = presentedError(error, t);
  if (!detail && !reason) return children;
  return (
    <details className={styles.more}>
      <summary aria-label={t('detailsFor', { name })}>{children}</summary>
      {detail ? <p>{detail}</p> : null}
      {reason ? <p className={styles.error}>{reason}</p> : null}
    </details>
  );
}

const MACHINE_CODE = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i;
const MACHINE_TOKEN = /^[a-z0-9_-]{1,64}$/i;

function presentedError(error: string | null, t: ToolText): string | null {
  if (error === null) return null;
  const trimmed = error.trim();
  if (trimmed === '') return null;
  if (trimmed === 'cancelled') return t('errors.cancelled');
  if (
    trimmed === 'web_budget_exhausted' ||
    /web.*(?:call limit|budget)|budget.*exhausted/i.test(trimmed)
  ) {
    return t('errors.budget');
  }
  if (trimmed === 'operation_failed' || MACHINE_CODE.test(trimmed) || MACHINE_TOKEN.test(trimmed)) {
    return t('errors.operation');
  }
  return trimmed;
}

function CallGlyph({ state }: { state: ToolChipView['state'] }) {
  const live = state === 'running' || state === 'preparing';
  const visible = live ? 'loading' : state === 'done' ? 'check' : 'error';
  return (
    <span className={styles.glyph} aria-hidden data-glyph-state={state}>
      <svg
        viewBox="0 0 20 20"
        className={styles.glyphLayer}
        data-glyph="loading"
        data-visible={visible === 'loading' ? 'true' : 'false'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <circle className={styles.spinner} cx="10" cy="10" r="6" strokeDasharray="24 14" />
      </svg>
      <svg
        viewBox="0 0 20 20"
        className={styles.glyphLayer}
        data-glyph="check"
        data-visible={visible === 'check' ? 'true' : 'false'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 10 3.3 3.3L15 6.7" />
      </svg>
      <svg
        viewBox="0 0 20 20"
        className={styles.glyphLayer}
        data-glyph="error"
        data-visible={visible === 'error' ? 'true' : 'false'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        {state === 'cancelled' ? (
          <path d="M6 10h8" />
        ) : (
          <>
            <path d="M10 4v7" />
            <circle cx="10" cy="15" r=".6" />
          </>
        )}
      </svg>
    </span>
  );
}
