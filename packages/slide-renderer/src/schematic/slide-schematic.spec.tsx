import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { elementRoleSchema, slideIrSchema, type SlideIr } from '@lct/contracts';
import { CONTENT, COVER, TEST_SLIDES, box } from '../testing/deck.js';
import { SlideSchematic } from './slide-schematic.js';

function render(slide: SlideIr): string {
  return renderToStaticMarkup(
    <SlideSchematic slide={slide} aria-label={`Slide ${slide.index + 1}`} />,
  );
}

function attribute(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((match) => match[1] ?? '');
}

describe('test slides', () => {
  it('are valid SlideIR and cover every kind and every role', () => {
    for (const slide of TEST_SLIDES) slideIrSchema.parse(slide);
    const elements = TEST_SLIDES.flatMap((slide) => slide.elements);
    expect(new Set(elements.map((element) => element.kind))).toEqual(
      new Set(['text', 'image', 'table', 'chart', 'decor']),
    );
    expect(new Set(elements.map((element) => element.role))).toEqual(
      new Set(elementRoleSchema.options),
    );
  });
});

describe('SlideSchematic', () => {
  it('draws every element in paint order', () => {
    for (const slide of TEST_SLIDES) {
      const html = render(slide);
      expect(attribute(html, 'data-element-id')).toEqual(
        slide.elements.map((element) => element.elementId),
      );
      expect(attribute(html, 'data-kind')).toEqual(slide.elements.map((element) => element.kind));
    }
  });

  it('draws every chart type', () => {
    const html = render(CONTENT);
    for (const chartType of ['bar', 'column', 'line', 'area', 'pie']) {
      expect(html).toContain(`data-element-id="content-chart-${chartType}"`);
    }
    expect(html).toContain('<polyline');
    expect(html).toContain('<polygon');
    expect(html).toContain('<path');
  });

  it('is an image named by the host with its insides hidden', () => {
    const html = render(COVER);
    expect(html).toMatch(/^<div role="img" aria-label="Slide 1"/);
    expect(html).toContain('aria-hidden="true"');
  });

  it('renders the same slide to the same markup', () => {
    for (const slide of TEST_SLIDES) expect(render(slide)).toBe(render(structuredClone(slide)));
  });

  it('uses no literal colours and no pixels beyond minimum thicknesses', () => {
    for (const slide of TEST_SLIDES) {
      const html = render(slide);
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(html).not.toMatch(/rgba?\(|hsla?\(|oklch\(/i);
      expect(html.replaceAll('max(1px,', '')).not.toMatch(/\dpx/);
      expect(html).toContain('currentColor');
    }
  });

  it('keeps line shapes without height and skips boxes without area', () => {
    const slide: SlideIr = {
      ...COVER,
      elements: [
        {
          kind: 'decor',
          elementId: 'line',
          role: 'decoration',
          box: box(48, 100, 400, 0),
          sourceShapeId: 5,
        },
        {
          kind: 'image',
          elementId: 'empty',
          role: 'image',
          box: box(48, 200, 0, 0),
          sourceShapeId: 6,
          mediaPart: 'media/x.png',
          fit: 'cover',
        },
      ],
    };
    const html = render(slide);
    expect(attribute(html, 'data-element-id')).toEqual(['line']);
    expect(html).toContain('height:max(1px,');
  });

  it('ends lines of copy round and leaves table and chart labels square-ish', () => {
    const only = (elementId: string): SlideIr => ({
      ...CONTENT,
      elements: CONTENT.elements.filter((element) => element.elementId === elementId),
    });
    const round = 'border-radius:calc(max(1px,';
    expect(render(only('content-title'))).toContain(round);
    expect(render(only('content-table'))).not.toContain(round);
    expect(render(only('content-chart-column'))).not.toContain(round);
  });

  it('follows the slide proportions rather than 16:9', () => {
    const standard: SlideIr = { ...COVER, slideCx: 9_144_000, slideCy: 6_858_000 };
    expect(render(standard)).toContain('aspect-ratio:9144000 / 6858000');
  });
});
