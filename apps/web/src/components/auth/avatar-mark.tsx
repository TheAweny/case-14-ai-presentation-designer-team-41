import type { ReactNode } from 'react';

/**
 * Десять абстрактных знаков для аватаров: плоская геометрия в духе плакатов Баухауса. У каждого
 * свой набор красок, подобранный руками, а не случайный цвет: так знаки читаются и в 24 px в
 * сайдбаре, и в 56 px в настройках, на светлой и на тёмной теме. Поле 48×48, круг обрезает
 * обёртка.
 */
const MARKS: readonly ReactNode[] = [
  // 0. Восход: солнце встаёт над горизонтом.
  <>
    <rect width="48" height="48" fill="#F2C14E" />
    <circle cx="24" cy="34" r="15" fill="#E4572E" />
    <rect y="34" width="48" height="14" fill="#1F2A44" />
  </>,
  // 1. Орбита: кольцо и спутник на нём.
  <>
    <rect width="48" height="48" fill="#1F2A44" />
    <circle cx="24" cy="24" r="12" fill="none" stroke="#8FB8DE" strokeWidth="4" />
    <circle cx="34.4" cy="18" r="5" fill="#F2C14E" />
  </>,
  // 2. Лепестки: четверти кругов из углов сходятся к центру.
  <>
    <rect width="48" height="48" fill="#DCE8D5" />
    <circle cx="0" cy="0" r="22" fill="#3E7C59" />
    <circle cx="48" cy="48" r="22" fill="#3E7C59" />
    <circle cx="48" cy="0" r="22" fill="#9CC5A1" />
    <circle cx="0" cy="48" r="22" fill="#9CC5A1" />
  </>,
  // 3. Волна: три гребня.
  <>
    <rect width="48" height="48" fill="#E8EEF7" />
    {[14, 24, 34].map((y, at) => (
      <path
        key={y}
        d={`M-4 ${y} q7 -7 14 0 t14 0 t14 0 t14 0`}
        fill="none"
        stroke={at === 1 ? '#E4572E' : '#3D5A98'}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
    ))}
  </>,
  // 4. Сплит: диагональ делит поле, круг держит центр.
  <>
    <rect width="48" height="48" fill="#F4EDE1" />
    <path d="M0 0H48L0 48Z" fill="#E4572E" />
    <circle cx="24" cy="24" r="8" fill="#1F2A44" />
  </>,
  // 5. Арки: радуга из трёх полос.
  <>
    <rect width="48" height="48" fill="#F4EDE1" />
    <circle cx="24" cy="40" r="22" fill="#C8553D" />
    <circle cx="24" cy="40" r="15" fill="#F28F3B" />
    <circle cx="24" cy="40" r="8" fill="#588B8B" />
    <rect y="40" width="48" height="8" fill="#F4EDE1" />
  </>,
  // 6. Россыпь: точки сетки 3×3, крупнее к одному углу.
  <>
    <rect width="48" height="48" fill="#2E294E" />
    {[0, 1, 2].flatMap((row) =>
      [0, 1, 2].map((col) => (
        <circle
          key={`${row}-${col}`}
          cx={12 + col * 12}
          cy={12 + row * 12}
          r={1.6 + (row + col) * 0.9}
          fill="#F5D547"
        />
      )),
    )}
  </>,
  // 7. Блоки: четыре квадранта и четверть круга.
  <>
    <rect width="24" height="24" fill="#3D5A98" />
    <rect x="24" width="24" height="24" fill="#F2C14E" />
    <rect y="24" width="24" height="24" fill="#F4EDE1" />
    <rect x="24" y="24" width="24" height="24" fill="#E4572E" />
    <path d="M24 24H48A24 24 0 0 1 24 48Z" fill="#1F2A44" />
  </>,
  // 8. Капля: большой круг сдвинут, в нём маленький.
  <>
    <rect width="48" height="48" fill="#8FB8DE" />
    <circle cx="30" cy="30" r="16" fill="#1F2A44" />
    <circle cx="25" cy="25" r="5" fill="#F4EDE1" />
  </>,
  // 9. Луна: полумесяц и звезда.
  <>
    <rect width="48" height="48" fill="#13213A" />
    <circle cx="22" cy="24" r="12" fill="#F4EDE1" />
    <circle cx="28" cy="20" r="11" fill="#13213A" />
    <circle cx="35" cy="33" r="2" fill="#F2C14E" />
  </>,
];

/** Знак номер `index`, во весь свой контейнер. */
export function AvatarMark({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden focusable="false" className="block size-full">
      {MARKS[index] ?? MARKS[0]}
    </svg>
  );
}
