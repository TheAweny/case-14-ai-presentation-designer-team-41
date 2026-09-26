'use client';

import { useCallback } from 'react';
import { useFormatter } from 'next-intl';

const KB = 1024;
const MB = KB * 1024;

/** Размер файла на языке интерфейса: «840 КБ», «12,4 МБ». */
export function useFileSize(): (bytes: number) => string {
  const format = useFormatter();
  return useCallback(
    (bytes: number) => {
      if (bytes < KB) return format.number(bytes, { style: 'unit', unit: 'byte' });
      if (bytes < MB) {
        return format.number(bytes / KB, {
          style: 'unit',
          unit: 'kilobyte',
          maximumFractionDigits: 0,
        });
      }
      return format.number(bytes / MB, {
        style: 'unit',
        unit: 'megabyte',
        maximumFractionDigits: 1,
      });
    },
    [format],
  );
}
