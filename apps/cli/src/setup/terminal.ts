import * as p from './ui.js';

export class Cancelled extends Error {
  constructor() {
    super('Действие отменено. Сохранённые настройки доступны в lct.');
    this.name = 'Cancelled';
  }
}

export async function ask<T>(prompt: () => Promise<T | symbol>): Promise<T> {
  if (!process.stdin.isTTY) {
    throw new Error('Нет терминала для вопросов. Передайте настройки флагами и укажите --yes.');
  }
  const value = await prompt();
  if (p.isCancel(value)) throw new Cancelled();
  return value as T;
}
