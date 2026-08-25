import { describe, expect, it, vi } from 'vitest';
import { AppUpdateCoordinator } from './appUpdateCoordinator';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function createCoordinator() {
  const reload = vi.fn();
  const warn = vi.fn();
  const coordinator = new AppUpdateCoordinator({
    currentBuildId: 'build-old',
    storage: new MemoryStorage(),
    reload,
    warn,
  });
  return { coordinator, reload, warn };
}

describe('AppUpdateCoordinator', () => {
  it('marks a different version manifest as available without navigating', async () => {
    const { coordinator, reload } = createCoordinator();

    await coordinator.checkVersionManifest(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ version: '3.10.1', buildId: 'build-new' }),
      }))
    );

    expect(coordinator.getState()).toMatchObject({
      status: 'AVAILABLE',
      latestBuildId: 'build-new',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'server error',
      response: { ok: false, status: 500, json: async () => ({}) },
    },
    {
      name: 'invalid payload',
      response: { ok: true, status: 200, json: async () => ({ version: '3.10.1' }) },
    },
  ])('keeps the current app usable after a $name', async ({ response }) => {
    const { coordinator, reload, warn } = createCoordinator();

    await coordinator.checkVersionManifest(vi.fn(async () => response));

    expect(coordinator.getState().status).toBe('IDLE');
    expect(warn).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it('defers the same build for the current session without suppressing a later build', () => {
    const { coordinator } = createCoordinator();

    coordinator.markUpdateAvailable({ latestBuildId: 'build-new' });
    coordinator.deferCurrentUpdate();
    coordinator.markUpdateAvailable({ latestBuildId: 'build-new' });
    expect(coordinator.getState().status).toBe('IDLE');

    coordinator.markUpdateAvailable({ latestBuildId: 'build-newer' });
    expect(coordinator.getState().status).toBe('AVAILABLE');
  });

  it('applies a waiting worker once and reloads only from the controlled callback', async () => {
    const { coordinator, reload } = createCoordinator();
    const applyWaitingWorker = vi.fn(async () => {
      coordinator.handleServiceWorkerControlChange();
    });
    coordinator.setServiceWorkerActions({
      checkForWaitingWorker: vi.fn(async () => true),
      applyWaitingWorker,
    });
    coordinator.markUpdateAvailable({
      latestBuildId: 'build-new',
      waitingWorkerAvailable: true,
    });

    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(true);
    coordinator.handleServiceWorkerControlChange();

    expect(applyWaitingWorker).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('keeps the prompt available when no waiting worker is ready', async () => {
    const { coordinator, reload } = createCoordinator();
    coordinator.setServiceWorkerActions({
      checkForWaitingWorker: vi.fn(async () => false),
      applyWaitingWorker: vi.fn(),
    });
    coordinator.markUpdateAvailable({ latestBuildId: 'build-new' });

    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(false);

    expect(coordinator.getState()).toMatchObject({
      status: 'AVAILABLE',
      error: '更新已发现，请稍后重试。',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not auto-reload when another tab activates the worker', async () => {
    const { coordinator, reload } = createCoordinator();

    coordinator.handleServiceWorkerControlChange();
    expect(coordinator.getState().status).toBe('AVAILABLE');
    expect(reload).not.toHaveBeenCalled();

    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('preserves the current page when applying the worker fails', async () => {
    const { coordinator, reload } = createCoordinator();
    coordinator.setServiceWorkerActions({
      checkForWaitingWorker: vi.fn(async () => true),
      applyWaitingWorker: vi.fn(async () => {
        throw new Error('message failed');
      }),
    });
    coordinator.markUpdateAvailable({ latestBuildId: 'build-new' });

    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(false);

    expect(coordinator.getState()).toMatchObject({
      status: 'AVAILABLE',
      error: '暂时无法完成更新，请稍后重试。',
    });
    expect(reload).not.toHaveBeenCalled();
  });
});
