import { test, expect, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sessionCookie } from './session';

const DECK = 'run-00000000-0000-4000-8000-0000000000c1';
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/contracts/fixtures/${name}.json`, import.meta.url),
      'utf8',
    ),
  ).valid[0].payload;

/** Цвет после перехода: у кнопки 100 мс, и снимок посередине не совпадает с итоговым. */
async function background(locator: Locator): Promise<string> {
  let previous = '';
  let current = '';
  await expect
    .poll(async () => {
      previous = current;
      current = await locator.evaluate((element) => getComputedStyle(element).backgroundColor);
      return previous !== '' && previous === current;
    })
    .toBe(true);
  return current;
}

test('selected tool stays visible and its variant group still opens', async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Expected fixture base URL');
  const slide = fixture('DeckImportResponse').slides[0];
  await request.post('http://127.0.0.1:3121/__reset-models');
  await request.post('http://127.0.0.1:3121/__set-generation-deck', {
    data: {
      runId: DECK,
      title: 'Rail',
      variant: 'balanced',
      designSystem: fixture('GenerationProfile').designSystem,
      templateIr: fixture('CompositionExportResponse').templateIr,
      slides: [{ ...slide, elements: [] }],
    },
  });
  const value = await sessionCookie('chat-e2e-user');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
  await page.goto(`/decks/${DECK}`);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

  const rail = page.getByRole('toolbar', { name: 'Инструменты' });
  const pointer = rail.getByRole('radio', { name: 'Выбор' });
  const text = rail.getByRole('radio', { name: 'Текст' });
  const rectangle = rail.getByRole('radio', { name: 'Прямоугольник' });
  await expect(pointer).toBeVisible();

  await expect(pointer).toHaveAttribute('aria-checked', 'true');
  await expect(text).toHaveAttribute('aria-checked', 'false');
  const selected = await background(pointer);
  const idle = await background(text);
  expect(selected).not.toBe(idle);

  await pointer.hover();
  expect(await background(pointer)).toBe(selected);

  await rectangle.click();
  await expect(rectangle).toHaveAttribute('aria-checked', 'true');
  await expect(pointer).toHaveAttribute('aria-checked', 'false');
  const shape = await background(rectangle);
  expect(shape).not.toBe(await background(text));
  await rectangle.hover();
  expect(await background(rectangle)).toBe(shape);

  const variants = rail.getByRole('button', { name: 'Варианты: Фигуры' });
  const menu = page.getByRole('menu', { name: 'Фигуры' });
  await variants.click();
  await expect(menu.getByRole('menuitemradio', { name: /Эллипс/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await rectangle.click();
  await expect(menu.getByRole('menuitemradio', { name: /Эллипс/ })).toBeVisible();
  await menu.getByRole('menuitemradio', { name: /Эллипс/ }).click();
  const ellipse = rail.getByRole('radio', { name: 'Эллипс' });
  await expect(ellipse).toHaveAttribute('aria-checked', 'true');
  expect(await background(ellipse)).toBe(shape);
  await expect(menu).toBeHidden();
});
