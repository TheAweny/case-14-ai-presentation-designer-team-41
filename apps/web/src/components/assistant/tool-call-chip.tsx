'use client';

import { useTranslations } from 'next-intl';
import { formatElapsed } from './elapsed';
import { StatusMark } from './status-mark';
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
      <div className={styles.row}>
        <StatusMark status={chip.state === 'preparing' ? 'pending' : chip.state} />
        <span className={styles.name}>{toolChipLabel(chip.name, chip.state, t)}</span>
        {detail ? <span className={styles.detail}>{detail}</span> : null}
        {elapsed === null ? null : <time className={styles.time}>{formatElapsed(elapsed)}</time>}
      </div>
      {chip.error ? <p className={styles.error}>{chip.error}</p> : null}
      {chip.fullDetail && chip.fullDetail !== detail ? (
        <details className={styles.more}>
          <summary>{t('details')}</summary>
          <p>{chip.fullDetail}</p>
        </details>
      ) : null}
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
      className={styles.chip}
      data-activity-id={activity.id}
      data-activity-kind={activity.kind}
      data-call-state={activity.state}
    >
      <div className={styles.row}>
        <StatusMark status={activity.state} />
        <span className={styles.name}>{toolChipLabel(activity.name, activity.state, t)}</span>
        {activity.detail ? <span className={styles.detail}>{activity.detail}</span> : null}
        {elapsed === null ? null : <time className={styles.time}>{formatElapsed(elapsed)}</time>}
      </div>
      {activity.error ? <p className={styles.error}>{activity.error}</p> : null}
      {activity.fullDetail && activity.fullDetail !== activity.detail ? (
        <details className={styles.more}>
          <summary>{t('details')}</summary>
          <p>{activity.fullDetail}</p>
        </details>
      ) : null}
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
