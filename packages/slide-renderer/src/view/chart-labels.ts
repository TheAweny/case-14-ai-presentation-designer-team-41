import { textWidthEmu } from '../schematic/text-layout.js';

const ELLIPSIS = '…';

/**
 * A category label broken into lines that fit its slot, as PowerPoint does under columns:
 * words wrap, and whatever still does not fit ends in an ellipsis on the last line. Width and
 * size share one unit, so points in, points out.
 */
export function wrapLabel(text: string, width: number, size: number, maxLines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const fits = (line: string) => textWidthEmu(line, size) <= width;
  const lines: string[] = [];
  let current = '';
  let index = 0;
  for (; index < words.length; index += 1) {
    const word = words[index] ?? '';
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate) || current === '') {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) {
      index += 1;
      break;
    }
  }
  const rest = [current, ...words.slice(index)].filter(Boolean).join(' ');
  lines.push(rest);
  const last = lines.length - 1;
  lines[last] = clip(lines[last] ?? '', width, size);
  // A single word longer than the slot on an earlier line is clipped too.
  return lines.map((line) => (fits(line) ? line : clip(line, width, size)));
}

function clip(line: string, width: number, size: number): string {
  if (textWidthEmu(line, size) <= width) return line;
  let cut = line;
  while (cut.length > 1 && textWidthEmu(`${cut}${ELLIPSIS}`, size) > width) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}${ELLIPSIS}`;
}
