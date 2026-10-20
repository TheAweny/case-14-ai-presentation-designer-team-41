import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatPart } from '@lct/contracts';
import messages from '../../i18n/messages/ru/deck-chat.json';
import { ModelErrorCard } from './model-error-card';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) =>
    key
      .split('.')
      .reduce<unknown>(
        (value, part) => (value as Record<string, unknown>)[part],
        messages.failure,
      ) as string,
}));
vi.mock('../composer/model-menu', () => ({
  ModelMenu: () => createElement('span', null, 'CHAT_MODEL_PICKER'),
}));
vi.mock('../settings/model-settings-store', () => ({
  useWriterModels: () => null,
  useModelSettingsSnapshot: () => ({
    connections: [{ connectionId: 'planner-connection', managed: false, editable: true }],
  }),
}));
vi.mock('./session', () => ({
  chatStore: {},
  useChat: () => ({
    model: null,
    draft: { text: '', files: [] },
    running: false,
    pending: null,
    recovery: null,
  }),
}));
vi.mock('../ui/animated-collapse', () => ({ AnimatedCollapse: () => null }));

describe('preparation model recovery card', () => {
  function render(role?: 'planner') {
    const part: Extract<ChatPart, { type: 'error' }> = {
      type: 'error',
      message: 'Preparation failed',
      failure: {
        kind: 'unsupported',
        modelId: 'actual-planner-model',
        connectionId: 'planner-connection',
        stage: 'template-index',
        httpStatus: 400,
        ...(role ? { role } : {}),
      },
    };
    return renderToStaticMarkup(
      createElement(ModelErrorCard, {
        part,
        chatId: 'chat',
        messageId: 'message',
        retryable: false,
        active: true,
        onRefine: () => undefined,
      }),
    );
  }
  it('exposes stage, model and planner recovery without offering an ineffective chat replacement', () => {
    const html = render('planner');
    expect(html).toContain('Не удалось подготовить шаблон');
    expect(html).toContain('actual-planner-model');
    expect(html).toContain('Настроить модель планирования');
    expect(html).toContain('Повторить после настройки');
    expect(html).not.toContain('CHAT_MODEL_PICKER');
    expect(html).not.toContain('Продолжить в чате');
  });
  it('keeps the chat model selector when preparation actually used the chat fallback', () => {
    const html = render();
    expect(html).toContain('выбранная модель чата');
    expect(html).toContain('CHAT_MODEL_PICKER');
    expect(html).not.toContain('Настроить модель планирования');
  });
});
