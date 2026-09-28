import { describe, expect, it } from 'vitest';
import { parseExpandedProjects } from './sidebar-expanded';

describe('parseExpandedProjects', () => {
  it('пустое хранилище — не предпочтение, а его отсутствие', () => {
    expect(parseExpandedProjects(null)).toBeNull();
  });

  it('пустой список — человек свернул все проекты', () => {
    expect(parseExpandedProjects('[]')).toEqual([]);
  });

  it('оставляет id как есть', () => {
    expect(parseExpandedProjects('["hackathon","sales"]')).toEqual(['hackathon', 'sales']);
  });

  it('чужое значение не принимается', () => {
    expect(parseExpandedProjects('{"hackathon":true}')).toBeNull();
    expect(parseExpandedProjects('[1]')).toBeNull();
    expect(parseExpandedProjects('не json')).toBeNull();
  });
});
