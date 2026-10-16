import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.MOTION_LAB_BROWSER,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const checks = [];
  const check = (name, condition) => {
    assert.ok(condition, name);
    checks.push(name);
  };
  try {
    await page.goto('http://127.0.0.1:4314/');
    await page.locator('.scene').waitFor();
    const scene = page.getByTestId('scene-prompt');
    const modePicker = scene.getByRole('button', { name: 'Режим', exact: true });
    const reasoningPicker = scene.getByRole('button', {
      name: 'Модель и размышление',
      exact: true,
    });
    const chooseModel = async (name) => {
      await reasoningPicker.click();
      await scene.getByRole('option', { name, exact: true }).click();
      await reasoningPicker.click();
    };
    const chooseMode = async (mode) => {
      await modePicker.click();
      await scene
        .getByRole('option', {
          name: new RegExp('^' + { chat: 'Чат', plan: 'План', auto: 'Авто' }[mode]),
        })
        .click();
    };
    check(
      'default mode matches the application plan mode',
      (await modePicker.textContent()).includes('План'),
    );
    check(
      'empty prompt cannot send',
      await scene.getByRole('button', { name: 'Отправить', exact: true }).isDisabled(),
    );
    await scene.getByRole('textbox').fill('/п');
    await scene.getByRole('option', { name: /\/план/ }).waitFor();
    await scene.getByRole('textbox').press('Enter');
    check(
      'Cyrillic slash commands support keyboard selection',
      (await scene.getByRole('textbox').inputValue()).startsWith('/план'),
    );
    await scene.getByRole('textbox').fill('');
    const chooser = page.waitForEvent('filechooser');
    await scene.getByRole('button', { name: 'Прикрепить файлы', exact: true }).click();
    await (
      await chooser
    ).setFiles([
      { name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('Квартальные результаты') },
    ]);
    await scene.getByRole('button', { name: 'Убрать brief.txt' }).waitFor();
    check(
      'attachments can be chosen locally',
      await scene.getByRole('button', { name: 'Отправить', exact: true }).isEnabled(),
    );
    await chooseModel('Qwen3.5 27B');
    await chooseMode('chat');
    check(
      'attachments survive model and mode changes',
      await scene.getByRole('button', { name: 'Убрать brief.txt' }).isVisible(),
    );
    await scene.getByRole('button', { name: 'Убрать brief.txt' }).click();
    await reasoningPicker.click();
    check(
      'fixed reasoning does not expose unsupported effort',
      (await scene.getByRole('slider').count()) === 0,
    );
    await scene.getByRole('textbox').click();
    await chooseModel('GPT OSS 20B');
    await reasoningPicker.click();
    const slider = scene.getByRole('slider');
    await slider.focus();
    await slider.press('Home');
    await page.waitForTimeout(260);
    const thumb = scene.locator('.prompt-bar__effort-thumb');
    const initialX = await thumb.evaluate((element) => element.getBoundingClientRect().x);
    await slider.press('End');
    check(
      'keyboard can select maximum effort',
      (await slider.getAttribute('aria-valuenow')) === '2',
    );
    check(
      'maximum effort activates spark state',
      (await scene.locator('.prompt-bar').getAttribute('data-max')) === '',
    );
    await page.waitForTimeout(70);
    const betweenX = await thumb.evaluate((element) => element.getBoundingClientRect().x);
    const targetX = await slider.evaluate((element) => element.getBoundingClientRect().right - 20);
    check(
      'effort thumb moves through intermediate positions',
      betweenX > initialX + 1 && betweenX < targetX - 0.2,
    );
    await page.waitForTimeout(220);
    check(
      'effort thumb settles at the selected step',
      Math.abs((await thumb.evaluate((element) => element.getBoundingClientRect().x)) - targetX) <
        0.5,
    );
    await slider.press('Home');
    await page.waitForTimeout(45);
    await slider.press('End');
    await page.waitForTimeout(260);
    check(
      'rapid effort changes settle on the latest level',
      Math.abs((await thumb.evaluate((element) => element.getBoundingClientRect().x)) - targetX) <
        0.5,
    );
    await slider.press('Escape');
    await scene.getByRole('textbox').fill('Итоги третьего квартала');
    await page.waitForTimeout(200);
    const countPixels = () =>
      scene.locator('canvas').evaluate((canvas) => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
        return count;
      });
    check('spark canvas draws real particles', (await countPixels()) > 0);
    await page.getByRole('switch', { name: 'Меньше движения' }).click();
    await page.waitForTimeout(200);
    check('reduced motion clears particles', (await countPixels()) === 0);
    await reasoningPicker.click();
    await slider.focus();
    await slider.press('Home');
    const reducedPosition = await thumb.evaluate((element) => element.getBoundingClientRect().x);
    const reducedTarget = await slider.evaluate((element) => element.getBoundingClientRect().x + 4);
    check(
      'reduced motion changes effort without travel',
      Math.abs(reducedPosition - reducedTarget) < 0.5,
    );
    await slider.press('End');
    await slider.press('Escape');
    await page.getByRole('switch', { name: 'Меньше движения' }).click();
    await chooseMode('auto');
    await scene.getByRole('textbox').press('Enter');
    await page.locator('.scene .thought-line[data-working]').waitFor();
    check(
      'send starts thought line',
      await scene.getByRole('button', { name: 'Остановить' }).isVisible(),
    );
    await page.locator('.scene .lattice-loader[data-status="working"]').waitFor();
    check(
      'thought automatically folds before layout',
      (await page.locator('.scene .thought-line__head').getAttribute('aria-expanded')) === 'false',
    );
    await page.locator('.scene .lattice-loader[data-status="done"]').waitFor();
    check(
      'simulation completes with result',
      await page.locator('.scene .result-strip').isVisible(),
    );
    await page.getByRole('button', { name: 'Сначала', exact: true }).click();
    await scene.getByRole('textbox').fill('Проверка остановки');
    await scene.getByRole('textbox').press('Enter');
    await scene.getByRole('button', { name: 'Остановить' }).click();
    await page.waitForTimeout(4400);
    check(
      'stop cancels delayed stage changes',
      (await page.locator('.scene .stopped').isVisible()) &&
        (await page.locator('.scene .lattice-loader').count()) === 0,
    );
    for (const model of ['GPT OSS 20B', 'Qwen3.5 27B']) {
      await chooseModel(model);
      for (const mode of ['chat', 'plan', 'auto']) {
        await chooseMode(mode);
        await scene.getByRole('textbox').fill('Обсуди материалы');
        await scene.getByRole('textbox').press('Enter');
        await page.locator('.scene .thought-line[data-working]').waitFor();
        check(
          'selected model is part of the submitted request: ' + model,
          (await page.locator('.conversation').getAttribute('data-model')) ===
            (model === 'Qwen3.5 27B' ? 'Qwen/Qwen3.5-27B' : 'openai/gpt-oss-20b'),
        );
        check(
          'thinking and attachment control stay available: ' + model + ' ' + mode,
          await scene.getByRole('button', { name: 'Прикрепить файлы', exact: true }).isVisible(),
        );
        await scene.getByRole('button', { name: 'Остановить', exact: true }).click();
      }
    }
    await page.getByRole('button', { name: 'Сначала', exact: true }).click();
    await chooseMode('chat');
    await scene.getByRole('textbox').fill('Обсудим структуру');
    await scene.getByRole('textbox').press('Enter');
    await page.locator('.scene .chat-result').waitFor();
    check(
      'chat responds without starting a build',
      (await page.locator('.scene .lattice-loader').count()) === 0,
    );
    await page.getByRole('button', { name: 'Сначала', exact: true }).click();
    await chooseMode('plan');
    const planChooser = page.waitForEvent('filechooser');
    await scene.getByRole('button', { name: 'Прикрепить файлы', exact: true }).click();
    await (
      await planChooser
    ).setFiles([
      { name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('Материалы для плана') },
    ]);
    await scene.getByRole('button', { name: 'Убрать plan.txt' }).waitFor();
    await scene.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.locator('.scene .plan-result').waitFor();
    check(
      'attachment-only request keeps its files after send',
      await page.locator('.scene .sent-attachments').getByText('plan.txt').isVisible(),
    );
    check(
      'plan waits for approval before building',
      (await page.locator('.scene .lattice-loader').count()) === 0,
    );
    await page.getByRole('button', { name: 'Собрать по плану', exact: true }).click();
    await page.locator('.scene .lattice-loader[data-status="working"]').waitFor();
    check(
      'plan approval starts the build',
      await page.locator('.scene .lattice-loader').isVisible(),
    );
    await scene.getByRole('button', { name: 'Остановить', exact: true }).click();
    const sample = page.locator('.thought-example');
    await page.getByRole('button', { name: 'Завершить мысль' }).click();
    check(
      'finished trace collapses',
      (await sample.locator('button').getAttribute('aria-expanded')) === 'false',
    );
    await sample.locator('button').click();
    check(
      'finished trace can reopen',
      (await sample.locator('button').getAttribute('aria-expanded')) === 'true',
    );
    await page.getByRole('button', { name: 'В одну строку', exact: true }).click();
    check(
      'inline thought variant hides steps',
      (await sample.locator('.thought-line__trace').count()) === 0,
    );
    await page.getByRole('button', { name: 'Точка', exact: true }).click();
    check('dot thought variant', (await sample.locator('.thought-line__dot').count()) === 1);
    await page.getByRole('button', { name: 'С этапами', exact: true }).click();
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    const loader = page.locator('.loader-examples .lattice-loader').first();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    const frozen = await loader.locator('.lattice-loader__timer').textContent();
    await page.waitForTimeout(180);
    check(
      'loader freezes timer on completion',
      frozen === (await loader.locator('.lattice-loader__timer').textContent()) &&
        frozen !== '0.0s',
    );
    await page.getByRole('button', { name: 'Ошибка', exact: true }).click();
    check('loader error state', (await loader.getAttribute('data-status')) === 'error');
    await page.getByRole('button', { name: 'Рисунок', exact: true }).click();
    await page.getByRole('option', { name: 'Snake', exact: true }).click();
    await page.getByRole('button', { name: 'Max effort', exact: true }).click();
    check(
      'maximum effort variant activates particles',
      (await scene.locator('.prompt-bar').getAttribute('data-max')) === '',
    );
    await page.getByRole('button', { name: 'В панели', exact: true }).click();
    check(
      'panel variant uses compact width',
      (await scene.evaluate((element) => element.getBoundingClientRect().width)) <= 360,
    );
    await page.getByRole('button', { name: 'В чате', exact: true }).click();
    await mkdir('tmp/motion-lab-checks', { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const variant of ['В чате', 'В панели', 'Max effort']) {
        await page.getByRole('button', { name: variant, exact: true }).click();
        await page.waitForTimeout(100);
        check(
          'no horizontal overflow: ' + width + 'px ' + variant,
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        );
        for (const label of ['Режим', 'Модель и размышление']) {
          await scene.getByRole('button', { name: label, exact: true }).click();
          const menu = scene.getByRole(label === 'Режим' ? 'listbox' : 'dialog', {
            name: label,
            exact: true,
          });
          const menuBounds = await menu.boundingBox();
          check(
            'menu fits viewport: ' +
              width +
              'px ' +
              variant +
              ' ' +
              label +
              ' ' +
              JSON.stringify(menuBounds),
            await menu.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0;
            }),
          );
          check(
            'menu rows contain their text: ' + width + 'px ' + label,
            await menu.locator('.choice-picker__row').evaluateAll((rows) =>
              rows.every((row) => {
                const rect = row.getBoundingClientRect();
                const copy = row.querySelector('.choice-picker__copy').getBoundingClientRect();
                return copy.top >= rect.top + 8 && copy.bottom <= rect.bottom - 8;
              }),
            ),
          );
          await page.screenshot({
            path:
              'tmp/motion-lab-checks/menu-' +
              width +
              '-' +
              (label === 'Режим' ? 'mode' : 'model') +
              '.png',
          });
          await scene.getByRole('button', { name: label, exact: true }).click();
          if (label === 'Модель и размышление') {
            await reasoningPicker.click();
            const models = scene.getByRole('listbox', { name: 'Модели', exact: true });
            check(
              'model list fits viewport: ' + width + 'px ' + variant,
              await models.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return rect.left >= 0 && rect.right <= innerWidth;
              }),
            );
            await reasoningPicker.click();
          }
        }
      }
      await page.screenshot({
        path: 'tmp/motion-lab-checks/components-' + width + '.png',
        fullPage: true,
      });
    }
    await modePicker.press('ArrowDown');
    const modeMenu = scene.getByRole('listbox', { name: 'Режим', exact: true });
    await page.keyboard.press('Home');
    check(
      'keyboard focuses first mode without selecting it',
      await modeMenu
        .getByRole('option')
        .first()
        .evaluate((element) => element === document.activeElement),
    );
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    check(
      'keyboard commits mode and restores trigger focus',
      (await modePicker.textContent()).includes('Авто') &&
        (await modePicker.evaluate((element) => element === document.activeElement)),
    );
    await modePicker.press('ArrowDown');
    await page.keyboard.press('Escape');
    check(
      'Escape dismisses picker and restores focus',
      (await modePicker.getAttribute('aria-expanded')) === 'false' &&
        (await modePicker.evaluate((element) => element === document.activeElement)),
    );
    await modePicker.click();
    await reasoningPicker.click();
    check(
      'model and mode menus are mutually exclusive',
      (await scene.getByRole('dialog').count()) === 1 &&
        (await modePicker.getAttribute('aria-expanded')) === 'false',
    );
    await scene.getByRole('textbox').click();
    check('clicking outside dismisses picker', (await scene.getByRole('dialog').count()) === 0);
    await page.getByRole('button', { name: 'В чате', exact: true }).focus();
    await page.keyboard.press('Enter');
    check(
      'native variant buttons work from keyboard',
      (await page
        .getByRole('button', { name: 'В чате', exact: true })
        .getAttribute('aria-pressed')) === 'true',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Max effort', exact: true }).click();
    await page.waitForTimeout(200);
    check('system reduced motion disables particles', (await countPixels()) === 0);
    check('no browser runtime errors', errors.length === 0);
    await page.locator('#prompt').screenshot({ path: 'tmp/motion-lab-checks/composer-final.png' });
    console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
