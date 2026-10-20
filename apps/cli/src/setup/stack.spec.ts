import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  volume: '',
  error: '',
  sockets: '',
  failedVolumeCheck: false,
}));
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: (_bin: string, args: string[]) => ({
    status: args[0] === 'volume' && state.failedVolumeCheck ? 1 : 0,
    stdout:
      args[0] === 'volume'
        ? state.volume
        : args[0] === '-H'
          ? state.sockets
          : args.includes('config')
            ? JSON.stringify({ volumes: { 'postgres-data': { name: 'custom_postgres-data' } } })
            : '',
  }),
}));
vi.mock('node:net', () => ({
  createServer: () => {
    let onError: (error: { code: string }) => void;
    return {
      once: (_event: string, callback: typeof onError) => {
        onError = callback;
      },
      listen: (_port: number, _host: string, callback: () => void) =>
        state.error ? onError({ code: state.error }) : callback(),
      close: (callback: () => void) => callback(),
    };
  },
}));
vi.mock('./env-file.js', () => ({ EnvFile: { open: () => ({ text: () => '' }) } }));
import { databaseVolumeExists, portFree } from './stack.js';
beforeEach(() => {
  state.volume = '';
  state.error = '';
  state.sockets = '';
  state.failedVolumeCheck = false;
});

describe('installation preflight', () => {
  it('finds persisted database data independently of running containers', () => {
    state.volume = 'unrelated\ncustom_postgres-data\n';
    expect(databaseVolumeExists()).toBe(true);
  });
  it('distinguishes a new installation from existing volumes', () => {
    state.volume = 'other_project_postgres-data';
    expect(databaseVolumeExists()).toBe(false);
  });
  it('fails closed when Docker volumes cannot be inspected', () => {
    state.failedVolumeCheck = true;
    expect(() => databaseVolumeExists()).toThrow(/Docker volumes/);
  });
  it('reports a bound port and propagates unexpected probe failures', async () => {
    state.error = 'EADDRINUSE';
    expect(await portFree(80)).toBe(false);
    state.error = 'EINVAL';
    await expect(portFree(80)).rejects.toThrow(/EINVAL/);
  });
  it('recognizes an available port', async () => expect(await portFree(3080)).toBe(true));
  it('checks privileged Linux ports through ss when binding is denied', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      state.error = 'EACCES';
      state.sockets = 'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*';
      expect(await portFree(80)).toBe(true);
      state.sockets += '\nLISTEN 0 4096 [::]:443 [::]:*';
      expect(await portFree(443)).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(process, 'platform', descriptor);
    }
  });
});
