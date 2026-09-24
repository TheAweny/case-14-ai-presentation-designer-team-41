import type { Box, ImageCrop, SlideElement } from '@lct/contracts';

type ImageElement = Extract<SlideElement, { kind: 'image' }>;

/**
 * Кадрирование картинки (F-31) — чистая геометрия, как в Google Slides и Keynote: рамка кадра
 * поверх всей картинки. Всё в EMU и в системе самой картинки, без поворота: холст переводит
 * в неё сдвиги указателя и ставит итог обратно с поворотом (`placeRotated`).
 */

/** Прямоугольник в EMU. Дробный: округляет только запись в колоду. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
}

/** Где лежит вся картинка и какую её часть показывает рамка кадра. */
export interface CropState {
  readonly image: Rect;
  readonly frame: Rect;
}

/** Размер файла в пикселях: по нему — пропорции всей картинки. */
export interface NaturalSize {
  readonly width: number;
  readonly height: number;
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type CropCorner = 'nw' | 'ne' | 'se' | 'sw';

export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const CROP_CORNERS: readonly CropCorner[] = ['nw', 'ne', 'se', 'sw'];

/** Картинку можно увеличить в кадре не больше чем во столько раз от её рамки. */
const MAX_SCALE = 20;

function right(rect: Rect): number {
  return rect.x + rect.cx;
}

function bottom(rect: Rect): number {
  return rect.y + rect.cy;
}

function centred(box: Box, cx: number, cy: number): Rect {
  return { x: box.x + (box.cx - cx) / 2, y: box.y + (box.cy - cy) / 2, cx, cy };
}

/**
 * С чего начинается кадрирование. Уже обрезанная картинка раскрывается из своей рамки по
 * `crop`. Необрезанная ложится так, как её сейчас видно: «Заполнить» — вся картинка вокруг рамки,
 * «Вписать» — рамка сжимается до самой картинки. Размер файла неизвестен — вся картинка и есть
 * рамка.
 */
export function cropStart(element: ImageElement, natural: NaturalSize | null): CropState {
  const { box, crop } = element;
  if (crop) {
    const restX = 1 - crop.l - crop.r;
    const restY = 1 - crop.t - crop.b;
    if (restX > 0 && restY > 0) {
      const cx = box.cx / restX;
      const cy = box.cy / restY;
      return { image: { x: box.x - crop.l * cx, y: box.y - crop.t * cy, cx, cy }, frame: box };
    }
  }
  if (!natural || natural.width <= 0 || natural.height <= 0 || box.cx <= 0 || box.cy <= 0) {
    return { image: box, frame: box };
  }
  const scaleX = box.cx / natural.width;
  const scaleY = box.cy / natural.height;
  if (element.fit === 'cover') {
    const scale = Math.max(scaleX, scaleY);
    return { image: centred(box, natural.width * scale, natural.height * scale), frame: box };
  }
  const scale = Math.min(scaleX, scaleY);
  const image = centred(box, natural.width * scale, natural.height * scale);
  return { image, frame: image };
}

/** Что записать в колоду: доли, срезанные с каждой стороны, и рамка кадра. */
export function cropResult(state: CropState): { crop: ImageCrop; frame: Rect } {
  const { image, frame } = state;
  const share = (value: number, whole: number) => Math.max(0, whole > 0 ? value / whole : 0);
  return {
    crop: {
      l: share(frame.x - image.x, image.cx),
      t: share(frame.y - image.y, image.cy),
      r: share(right(image) - right(frame), image.cx),
      b: share(bottom(image) - bottom(frame), image.cy),
    },
    frame,
  };
}

/**
 * Тянут ручку рамки: её стороны идут за указателем, но не дальше краёв картинки и не ближе
 * `min` друг к другу. Сдвиг — от рамки на начало жеста.
 */
export function resizeFrame(
  state: CropState,
  handle: CropHandle,
  dx: number,
  dy: number,
  min: number,
): CropState {
  const { image, frame } = state;
  let left = frame.x;
  let top = frame.y;
  let rightEdge = right(frame);
  let bottomEdge = bottom(frame);
  if (handle.includes('w')) left = Math.min(Math.max(frame.x + dx, image.x), rightEdge - min);
  if (handle.includes('e')) {
    rightEdge = Math.max(Math.min(rightEdge + dx, right(image)), left + min);
  }
  if (handle.includes('n')) top = Math.min(Math.max(frame.y + dy, image.y), bottomEdge - min);
  if (handle.includes('s')) {
    bottomEdge = Math.max(Math.min(bottomEdge + dy, bottom(image)), top + min);
  }
  return { image, frame: { x: left, y: top, cx: rightEdge - left, cy: bottomEdge - top } };
}

/** Картинку двигают под рамкой: кадр остаётся на месте и не выходит за картинку. */
export function moveImage(state: CropState, dx: number, dy: number): CropState {
  const { image, frame } = state;
  const x = Math.min(Math.max(image.x + dx, right(frame) - image.cx), frame.x);
  const y = Math.min(Math.max(image.y + dy, bottom(frame) - image.cy), frame.y);
  return { frame, image: { ...image, x, y } };
}

/**
 * Угол картинки: она растёт или сжимается с сохранением пропорций от противоположного угла и
 * всегда закрывает рамку кадра целиком.
 */
export function scaleImage(
  state: CropState,
  corner: CropCorner,
  dx: number,
  dy: number,
): CropState {
  const { image, frame } = state;
  if (image.cx <= 0 || image.cy <= 0) return state;
  const east = corner.includes('e');
  const south = corner.includes('s');
  const anchorX = east ? image.x : right(image);
  const anchorY = south ? image.y : bottom(image);
  const wanted = Math.max(
    (image.cx + (east ? dx : -dx)) / image.cx,
    (image.cy + (south ? dy : -dy)) / image.cy,
  );
  // Меньше нельзя: картинка перестала бы закрывать рамку с этой стороны.
  const least = Math.max(
    (east ? right(frame) - anchorX : anchorX - frame.x) / image.cx,
    (south ? bottom(frame) - anchorY : anchorY - frame.y) / image.cy,
  );
  const factor = Math.min(Math.max(wanted, least), (MAX_SCALE * frame.cx) / image.cx);
  const cx = image.cx * factor;
  const cy = image.cy * factor;
  return {
    frame,
    image: { x: east ? anchorX : anchorX - cx, y: south ? anchorY : anchorY - cy, cx, cy },
  };
}

/** «Сбросить»: в кадре снова вся картинка. */
export function resetCrop(state: CropState): CropState {
  return { image: state.image, frame: state.image };
}

/** Сдвиг указателя на экране в систему картинки, повёрнутой на `rotation` градусов. */
export function toLocal(dx: number, dy: number, rotation: number): { dx: number; dy: number } {
  if (!rotation) return { dx, dy };
  const angle = (-rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
}

/**
 * Рамка кадра на слайде. Поворот идёт вокруг центра рамки, а он при кадрировании сдвигается:
 * новая рамка встаёт так, чтобы на слайде кадр остался ровно там, где его видели.
 */
export function placeRotated(original: Box, rotation: number, frame: Rect): Rect {
  const centreX = original.x + original.cx / 2;
  const centreY = original.y + original.cy / 2;
  const offsetX = frame.x + frame.cx / 2 - centreX;
  const offsetY = frame.y + frame.cy / 2 - centreY;
  const angle = ((rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = centreX + offsetX * cos - offsetY * sin;
  const y = centreY + offsetX * sin + offsetY * cos;
  return { x: x - frame.cx / 2, y: y - frame.cy / 2, cx: frame.cx, cy: frame.cy };
}
