import { describe, expect, it } from 'vitest';
import type { SlideElement } from '@lct/contracts';
import {
  cropResult,
  cropStart,
  moveImage,
  placeRotated,
  resetCrop,
  resizeFrame,
  scaleImage,
  toLocal,
  type CropState,
} from './image-crop';

type ImageElement = Extract<SlideElement, { kind: 'image' }>;

const photo: ImageElement = {
  kind: 'image',
  elementId: 'photo',
  role: 'image',
  box: { x: 1000, y: 1000, cx: 400, cy: 200 },
  sourceShapeId: null,
  mediaPart: 'upload/photo.png',
  fit: 'cover',
};

/** Картинка 400 × 400 под рамкой 400 × 200: сверху и снизу срезано по четверти. */
const square = { width: 1000, height: 1000 };

describe('cropStart', () => {
  it('lays a covered picture around its box and a contained one inside it', () => {
    expect(cropStart(photo, square)).toEqual({
      image: { x: 1000, y: 900, cx: 400, cy: 400 },
      frame: photo.box,
    });
    const contained = cropStart({ ...photo, fit: 'contain' }, square);
    expect(contained.image).toEqual({ x: 1100, y: 1000, cx: 200, cy: 200 });
    expect(contained.frame).toEqual(contained.image);
  });

  it('opens a cropped picture from its crop, and the box itself with no size known', () => {
    const cropped = cropStart({ ...photo, crop: { l: 0.2, t: 0, r: 0.3, b: 0.5 } }, null);
    expect(cropped.image).toEqual({ x: 840, y: 1000, cx: 800, cy: 400 });
    expect(cropStart(photo, null)).toEqual({ image: photo.box, frame: photo.box });
  });

  it('comes back to the same crop it started from', () => {
    const crop = { l: 0.2, t: 0.1, r: 0.3, b: 0.4 };
    const result = cropResult(cropStart({ ...photo, crop }, square));
    expect(result.crop.l).toBeCloseTo(0.2);
    expect(result.crop.t).toBeCloseTo(0.1);
    expect(result.crop.r).toBeCloseTo(0.3);
    expect(result.crop.b).toBeCloseTo(0.4);
    expect(result.frame).toEqual(photo.box);
  });
});

describe('crop gestures', () => {
  const start: CropState = cropStart(photo, square);

  it('moves a frame edge with the pointer, never past the picture or through the other edge', () => {
    expect(resizeFrame(start, 'e', -100, 0, 10).frame).toEqual({
      x: 1000,
      y: 1000,
      cx: 300,
      cy: 200,
    });
    expect(resizeFrame(start, 'n', 0, -500, 10).frame).toEqual({
      x: 1000,
      y: 900,
      cx: 400,
      cy: 300,
    });
    expect(resizeFrame(start, 'sw', 1000, 50, 10).frame).toEqual({
      x: 1390,
      y: 1000,
      cx: 10,
      cy: 250,
    });
  });

  it('moves the picture under the frame, keeping the frame covered', () => {
    expect(moveImage(start, 50, 60).image).toEqual({ x: 1000, y: 960, cx: 400, cy: 400 });
    expect(moveImage(start, 0, -500).image.y).toBe(800);
    expect(moveImage(start, 0, -500).frame).toEqual(start.frame);
  });

  it('scales the picture from the opposite corner and never below the frame', () => {
    const grown = scaleImage(start, 'se', 200, 0);
    expect(grown.image).toEqual({ x: 1000, y: 900, cx: 600, cy: 600 });
    // Уже нельзя: картинка перестала бы закрывать рамку справа.
    const shrunk = scaleImage(start, 'se', -300, -300);
    expect(shrunk.image.cx).toBe(400);
    const west = scaleImage(start, 'nw', -100, 0);
    expect(west.image).toEqual({ x: 900, y: 800, cx: 500, cy: 500 });
  });

  it('turns the crop into shares cut off each side, and a reset cuts nothing', () => {
    const narrowed = resizeFrame(start, 'e', -100, 0, 10);
    expect(cropResult(narrowed).crop).toEqual({ l: 0, t: 0.25, r: 0.25, b: 0.25 });
    expect(cropResult(resetCrop(narrowed)).crop).toEqual({ l: 0, t: 0, r: 0, b: 0 });
    expect(resetCrop(narrowed).frame).toEqual(start.image);
  });
});

describe('rotation', () => {
  it('turns a pointer drag into the frame of a rotated picture', () => {
    const local = toLocal(10, 0, 90);
    expect(local.dx).toBeCloseTo(0);
    expect(local.dy).toBeCloseTo(-10);
    expect(toLocal(3, 4, 0)).toEqual({ dx: 3, dy: 4 });
  });

  it('keeps an unrotated frame where it is and moves a rotated one about the old centre', () => {
    const frame = { x: 1000, y: 1000, cx: 200, cy: 200 };
    expect(placeRotated(photo.box, 0, frame)).toEqual(frame);
    // Левая половина рамки, повёрнутой на 180°, на слайде оказывается справа.
    const turned = placeRotated(photo.box, 180, frame);
    expect(turned.x).toBeCloseTo(1200);
    expect(turned.y).toBeCloseTo(1000);
  });
});
