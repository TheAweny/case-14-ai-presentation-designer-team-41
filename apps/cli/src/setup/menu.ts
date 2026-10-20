import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as p from './ui.js';
import { EnvFile } from './env-file.js';
import { doctor, stack, user } from './commands.js';
import { onboard } from './onboard.js';
import { repoRoot, runningServices } from './stack.js';
import { publicUrl } from './settings.js';
import { ask, Cancelled } from './terminal.js';
import { usersMenu } from './user-command.js';
import { backupCommand, updateCommand } from './maintenance.js';
import { mediaCommand } from './media.js';
import { limitsCommand } from './limits.js';

export async function menu(): Promise<number> {
  const root = repoRoot();
  if (!existsSync(join(root, '.env'))) return onboard();
  p.intro('LCT · Дизайнер презентаций');
  while (true) {
    const env = EnvFile.open(join(root, '.env'));
    const running = runningServices();
    const online = ['api', 'web', 'engine', 'postgres'].every((name) => running.includes(name));
    p.log.info(
      `${online ? '● Сервисы запущены' : running.length ? '◐ Запущена часть сервисов' : '○ Сервисы остановлены'}\n${publicUrl(env)}`,
    );
    const action = await ask(() =>
      p.select({
        message: 'Управление сервисом',
        options: [
          { value: 'address', label: 'Адрес приложения' },
          { value: 'start', label: 'Запустить сервис' },
          { value: 'stop', label: 'Остановить сервис' },
          { value: 'users', label: 'Пользователи', hint: 'создание, роли, доступ' },
          { value: 'model', label: 'Модель и подключение' },
          { value: 'speech', label: 'Голосовой ввод', hint: 'провайдер и модель распознавания' },
          { value: 'image', label: 'Генерация изображений', hint: 'провайдер и модель' },
          { value: 'limits', label: 'Лимиты генерации', hint: 'параллелизм и время' },
          { value: 'settings', label: 'Настройки установки', hint: 'домен, порты, возможности' },
          { value: 'logs', label: 'Последние логи' },
          { value: 'doctor', label: 'Диагностика' },
          { value: 'backup', label: 'Резервная копия' },
          { value: 'update', label: 'Обновить сервис' },
          { value: 'admin', label: 'Восстановить администратора' },
          { value: 'refresh', label: 'Обновить состояние' },
          { value: 'exit', label: 'Выход' },
        ],
        maxItems: 7,
      }),
    );
    try {
      if (action === 'exit') {
        p.outro('До встречи');
        return 0;
      }
      if (action === 'address') p.note(publicUrl(env), 'Откройте в браузере');
      if (action === 'start') await stack.start();
      if (
        action === 'stop' &&
        (await ask(() =>
          p.confirm({
            message: 'Остановить сервис?',
            active: 'Остановить',
            inactive: 'Назад',
            initialValue: false,
          }),
        ))
      )
        await stack.stop();
      if (action === 'users') await usersMenu();
      if (action === 'speech' || action === 'image') await mediaCommand(action);
      if (action === 'limits') await limitsCommand();
      if (action === 'admin') await user(['admin'], {});
      if (action === 'settings' || action === 'model') await onboard({ section: action });
      if (action === 'logs') await stack.logs(undefined, false);
      if (action === 'doctor') await doctor();
      if (action === 'backup') await backupCommand();
      if (
        action === 'update' &&
        (await ask(() =>
          p.confirm({
            message: 'Создать резервную копию и обновить сервис?',
            active: 'Обновить',
            inactive: 'Назад',
            initialValue: false,
          }),
        ))
      )
        await updateCommand();
    } catch (error) {
      if (error instanceof Cancelled) p.log.info('Возврат в меню');
      else p.log.error(error instanceof Error ? error.message : String(error));
    }
  }
}
