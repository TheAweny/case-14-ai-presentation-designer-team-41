import { AsyncLocalStorage } from 'node:async_hooks';

const tasks = new AsyncLocalStorage<string>();
export function attemptTask(): string | undefined {
  return tasks.getStore();
}
export function withAttemptTask<T>(taskId: string, run: () => Promise<T>): Promise<T> {
  return tasks.run(taskId, run);
}
