import { describe, expect, it } from 'vitest';
import { modelDetailsOf } from './model-details.js';

describe('modelDetailsOf', () => {
  it('reads the VK AI Space description', () => {
    const details = modelDetailsOf({
      data: [
        {
          id: 'chat-model',
          model_type: 'llm',
          tasks: ['chat-completion'],
          input_modalities: ['text'],
          output_modalities: ['text'],
        },
        {
          id: 'sees-and-thinks',
          model_type: 'vlm',
          tasks: ['chat-completion'],
          input_modalities: ['text', 'image'],
          tags: ['thinking-mode', 'reasoning'],
        },
        { id: 'ears', model_type: 'stt', tasks: ['transcription'], input_modalities: ['audio'] },
        { id: 'vectors', model_type: 'embedding', tasks: ['embedding'] },
      ],
    });
    expect(details).toEqual({
      'chat-model': { kinds: ['text'] },
      'sees-and-thinks': {
        kinds: ['text', 'vision'],
        reasoning: { toggle: 'enable-thinking', levels: false },
      },
      ears: { kinds: ['speech'] },
      vectors: { kinds: [] },
    });
  });

  it('reads the OpenRouter description', () => {
    const details = modelDetailsOf({
      data: [
        {
          id: 'vendor/model',
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          supported_parameters: ['max_tokens', 'reasoning', 'include_reasoning'],
        },
        {
          id: 'vendor/painter',
          architecture: { input_modalities: ['text'], output_modalities: ['image'] },
        },
      ],
    });
    expect(details['vendor/model']).toEqual({
      kinds: ['text', 'vision'],
      reasoning: { toggle: 'reasoning-effort', levels: true },
    });
    expect(details['vendor/painter']).toEqual({ kinds: ['image'] });
  });

  it('reads the endpoint types of a new-api gateway', () => {
    const details = modelDetailsOf({
      data: [
        { id: 'talker', supported_endpoint_types: ['openai', 'anthropic'] },
        { id: 'painter', supported_endpoint_types: ['image-generation', 'openai'] },
        { id: 'film', supported_endpoint_types: ['openai', 'video'] },
      ],
    });
    // It does not say whether a chat model sees pictures, so it is offered for them too.
    expect(details).toEqual({
      talker: { kinds: ['text', 'vision'] },
      painter: { kinds: ['image'] },
      film: { kinds: [] },
    });
  });

  it('takes a type that names no kind for saying nothing', () => {
    const details = modelDetailsOf({
      data: [
        { id: 'claude', type: 'model', display_name: 'Claude' },
        {
          id: 'mistral-large',
          type: 'base',
          capabilities: { completion_chat: true, function_calling: true, vision: true },
        },
      ],
    });
    expect(details).toEqual({ 'mistral-large': { kinds: ['text', 'vision'] } });
  });

  it('says nothing about models described only by id', () => {
    expect(modelDetailsOf({ data: [{ id: 'm', object: 'model', owned_by: 'me' }] })).toEqual({});
  });
});
