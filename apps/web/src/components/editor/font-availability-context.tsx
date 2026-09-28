'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { browserMeasurer, checkFonts, type FontAvailability } from '@/lib/font-availability';

const UNKNOWN: FontAvailability = new Map();

const FontAvailabilityContext = createContext<FontAvailability>(UNKNOWN);

/**
 * Какие шрифты шаблона есть на этом компьютере. Карта считается один раз, когда веб-шрифты
 * загружены (`fontsReady`): раньше незагруженный шрифт померился бы как отсутствующий. До того
 * и на сервере карта пуста — ни о каком шрифте ничего не известно, предупреждений нет.
 */
export function FontAvailabilityProvider({
  families,
  fontsReady,
  children,
}: {
  families: readonly string[];
  fontsReady: boolean;
  children: ReactNode;
}) {
  // Готовность становится true только в браузере и больше не сбрасывается: замер — там же.
  const availability = useMemo(() => {
    if (!fontsReady) return UNKNOWN;
    const measure = browserMeasurer();
    return measure ? checkFonts(families, measure) : UNKNOWN;
  }, [families, fontsReady]);

  return (
    <FontAvailabilityContext.Provider value={availability}>
      {children}
    </FontAvailabilityContext.Provider>
  );
}

/** Доступность шрифтов шаблона; без провайдера — пустая карта. */
export function useFontAvailability(): FontAvailability {
  return useContext(FontAvailabilityContext);
}
