import { describe, expect, it, vi, beforeEach } from 'vitest';
const state = vi.hoisted(() => ({ choices: [] as string[], installed: true }));
vi.mock('node:fs', () => ({ existsSync: () => state.installed }));
vi.mock('./env-file.js', () => ({ EnvFile: { open: () => ({ get: () => undefined }) } }));
vi.mock('./stack.js', () => ({
  repoRoot: () => '/installation',
  runningServices: () => ['postgres', 'api', 'engine', 'web'],
}));
vi.mock('./terminal.js', () => ({
  ask: async (prompt: () => Promise<unknown>) => prompt(),
  Cancelled: class extends Error {},
}));
vi.mock('./ui.js', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: { info: vi.fn(), error: vi.fn() },
  select: vi.fn(async () => state.choices.shift()),
  confirm: vi.fn(async () => false),
}));
vi.mock('./commands.js', () => ({
  doctor: vi.fn(),
  user: vi.fn(),
  stack: { start: vi.fn(async () => 0), stop: vi.fn(), logs: vi.fn() },
}));
vi.mock('./onboard.js', () => ({ onboard: vi.fn(async () => 0) }));
vi.mock('./settings.js', () => ({ publicUrl: () => 'http://server:3000' }));
vi.mock('./maintenance.js', () => ({ backupCommand: vi.fn(), updateCommand: vi.fn() }));
vi.mock('./user-command.js', () => ({ usersMenu: vi.fn() }));
import { menu } from './menu.js';
import { onboard } from './onboard.js';
import { usersMenu } from './user-command.js';
import { stack } from './commands.js';
beforeEach(() => {
  vi.clearAllMocks();
  state.installed = true;
  state.choices = [];
});

describe('control menu', () => {
  it('opens the setup wizard for an unconfigured installation', async () => {
    state.installed = false;
    expect(await menu()).toBe(0);
    expect(onboard).toHaveBeenCalledOnce();
  });
  it('returns to the control menu after a user operation', async () => {
    state.choices = ['users', 'exit'];
    expect(await menu()).toBe(0);
    expect(usersMenu).toHaveBeenCalledOnce();
  });
  it('does not stop services when the stop confirmation is declined', async () => {
    state.choices = ['stop', 'exit'];
    await menu();
    expect(stack.stop).not.toHaveBeenCalled();
  });
  it('keeps the menu usable after a failed command', async () => {
    vi.mocked(stack.start).mockRejectedValueOnce(new Error('Docker не отвечает'));
    state.choices = ['start', 'exit'];
    expect(await menu()).toBe(0);
  });
  it('selects the relevant section when configuring a model', async () => {
    state.choices = ['model', 'exit'];
    await menu();
    expect(onboard).toHaveBeenCalledWith({ section: 'model' });
  });
});
