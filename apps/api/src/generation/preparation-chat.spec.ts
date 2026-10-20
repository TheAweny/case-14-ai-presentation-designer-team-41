import { describe, expect, it, vi } from 'vitest';
import type { ChatPart, ChatToolActivity } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import { chatTools, type ChatToolScope } from '../chats/chat-tools.js';
import type { GenerationService } from './generation.service.js';

describe('chat preparation visibility and Stop before run ids exist', () => {
  it.each(['template', 'materials'] as const)(
    'cancels during %s preparation through the existing chat caller',
    async (stage) => {
      const account = { id: 'owner', role: 'user' } as Account;
      const controller = new AbortController();
      const parts: ChatPart[] = [];
      const activities: ChatToolActivity[] = [];
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let rejectMaterial: (reason: unknown) => void = () => undefined;
      const prepare = vi.fn(
        async (_template: string, _model: unknown, _owner: Account, signal: AbortSignal) => {
          entered();
          await new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        },
      );
      const cancelPreparation = vi.fn(() => rejectMaterial(controller.signal.reason));
      const start = vi.fn(async () => {
        entered();
        await new Promise<never>((_, reject) => {
          rejectMaterial = reject;
        });
        throw new Error('Cannot start after cancellation');
      });
      const generation = {
        template: async () => ({ file_name: 'Template', profile: {} }),
        templateReady: async () => stage !== 'template',
        prepare,
        start,
        cancelPreparation,
      } as unknown as GenerationService;
      const scope: ChatToolScope = {
        account,
        chatId: 'chat',
        projectId: null,
        mode: 'auto',
        model: null,
        preferredSlideCount: 5,
        messages: () => [
          {
            role: 'user',
            id: crypto.randomUUID(),
            text: 'Сделай ровно пять слайдов',
            attachments: [],
            mode: 'auto',
            createdAt: 1,
          },
        ],
        updatePart: () => undefined,
        addDecks: () => undefined,
      };
      const tools = chatTools(generation, scope, undefined, {
        search: null,
        fetchSource: async () => {
          throw new Error('No network');
        },
      });
      const build = tools.find((tool) => tool.name === 'build_deck');
      if (!build) throw new Error('Missing build tool');
      const context: ToolContext & { activity(activity: ChatToolActivity): void } = {
        signal: controller.signal,
        callId: 'call',
        show: (part) => parts.push(part) - 1,
        update: (index, part) => {
          parts[index] = part;
        },
        activity: (activity) => activities.push(activity),
      };
      const pending = build.run(
        build.input.parse({
          templateId: '00000000-0000-4000-8000-000000000001',
          brief: 'Исследование пилота',
        }),
        context,
      );
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await waiting;
      const part = parts.find((item) => item.type === 'build');
      expect(part?.type === 'build' && part.status).toBe('preparing');
      controller.abort(new DOMException('Stop', 'AbortError'));
      await rejected;
      expect(cancelPreparation).toHaveBeenCalledWith(expect.any(String), account);
      expect(parts.find((item) => item.type === 'build')).toMatchObject({ status: 'cancelled' });
      if (stage === 'template') {
        expect(start).not.toHaveBeenCalled();
        expect(activities.map((activity) => activity.status)).toEqual(['running', 'cancelled']);
      }
    },
  );
});
