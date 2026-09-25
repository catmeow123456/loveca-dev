import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateCoordinator } from './appUpdateCoordinator';
import { startAppUpdateChecks } from './appUpdateRegistration';

class Worker extends EventTarget {
  state: ServiceWorkerState = 'activated';
  postMessage = vi.fn();
  change(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class Registration extends EventTarget {
  active: Worker | null = new Worker();
  waiting: Worker | null = null;
  installing: Worker | null = null;
  update = vi.fn(async () => this);
  install() {
    const worker = new Worker();
    worker.state = 'installing';
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    return worker;
  }
  finish(worker: Worker) {
    this.installing = null;
    this.waiting = worker;
    worker.change('installed');
  }
}

class Container extends EventTarget {
  controller: Worker | null;
  register: ReturnType<typeof vi.fn>;
  constructor(readonly registration: Registration) {
    super();
    this.controller = registration.active;
    this.register = vi.fn(async () => registration);
  }
  activate(worker: Worker) {
    const old = this.registration.active;
    this.registration.waiting = null;
    this.registration.installing = null;
    this.registration.active = worker;
    worker.change('activating');
    old?.change('redundant');
    this.controller = worker;
    worker.change('activated');
    this.dispatchEvent(new Event('controllerchange'));
  }
}

let stop: (() => void) | undefined;
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}
function setup() {
  const registration = new Registration();
  const container = new Container(registration);
  const reload = vi.fn();
  const coordinator = new AppUpdateCoordinator({ currentBuildId: 'old', reload, warn: vi.fn() });
  const start = () => {
    stop = startAppUpdateChecks(coordinator, container as unknown as ServiceWorkerContainer);
  };
  return { registration, container, reload, coordinator, start };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval, clearInterval });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ buildId: 'new' }) }))
  );
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('browser app update lifecycle', () => {
  it('waits for installation and control change before completing the requested update', async () => {
    const { registration, container, reload, coordinator, start } = setup();
    start();
    await flush();
    const worker = registration.install();
    const result = coordinator.applyCurrentUpdate();
    await flush();
    expect(coordinator.getState()).toMatchObject({
      status: 'PREPARING',
      waitingWorkerAvailable: false,
    });
    expect(reload).not.toHaveBeenCalled();
    registration.finish(worker);
    await flush();
    expect(coordinator.getState().status).toBe('APPLYING');
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.activate(worker);
    await expect(result).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('waits when update() resolves before the installation finishes', async () => {
    const { registration, container, coordinator, reload, start } = setup();
    start();
    await flush();
    let worker: Worker;
    registration.update.mockImplementationOnce(async () => {
      worker = registration.install();
      return registration;
    });
    const result = coordinator.applyCurrentUpdate();
    await flush();
    expect(coordinator.getState().status).toBe('PREPARING');
    registration.finish(worker!);
    await flush();
    container.activate(worker!);
    await expect(result).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('retries a failed registration on the next update attempt', async () => {
    const { registration, container, coordinator, reload, start } = setup();
    container.register
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'));
    start();
    await flush();
    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({
      status: 'ERROR',
      error: expect.stringContaining('注册失败'),
    });
    const worker = registration.install();
    registration.finish(worker);
    const result = coordinator.applyCurrentUpdate();
    await flush();
    expect(container.register).toHaveBeenCalledTimes(3);
    container.activate(worker);
    await expect(result).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('allows three minutes to download and ignores completion after timeout until another confirmation', async () => {
    const { registration, container, coordinator, reload, start } = setup();
    start();
    await flush();
    const worker = registration.install();
    const result = coordinator.applyCurrentUpdate();
    await vi.advanceTimersByTimeAsync(179_999);
    expect(coordinator.getState().status).toBe('PREPARING');
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({
      status: 'ERROR',
      error: expect.stringContaining('下载未完成'),
    });
    registration.finish(worker);
    await flush();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    const retry = coordinator.applyCurrentUpdate();
    await flush();
    container.activate(worker);
    await expect(retry).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('allows sixty seconds for activation then restores retry without a late automatic reload', async () => {
    const { registration, container, coordinator, reload, start } = setup();
    start();
    await flush();
    const worker = registration.install();
    registration.finish(worker);
    const result = coordinator.applyCurrentUpdate();
    await flush();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(coordinator.getState().status).toBe('APPLYING');
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({
      status: 'ERROR',
      error: expect.stringContaining('切换超时'),
    });
    container.activate(worker);
    expect(reload).not.toHaveBeenCalled();
    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('recovers from a failed install instead of waiting forever', async () => {
    const { registration, coordinator, start } = setup();
    start();
    await flush();
    const worker = registration.install();
    const result = coordinator.applyCurrentUpdate();
    await flush();
    registration.installing = null;
    worker.change('redundant');
    await expect(result).resolves.toBe(false);
    expect(coordinator.getState().status).toBe('ERROR');
  });

  it('handles another tab activating the worker without reloading this tab automatically', async () => {
    const { registration, container, coordinator, reload, start } = setup();
    start();
    await flush();
    const worker = registration.install();
    registration.finish(worker);
    container.activate(worker);
    expect(reload).not.toHaveBeenCalled();
    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(true);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not offer an update just because a first worker takes control of the current build', async () => {
    const { registration, container, coordinator, reload, start } = setup();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ buildId: 'old' }),
    } as Response);
    container.controller = null;
    start();
    await flush();
    container.activate(registration.active!);
    expect(coordinator.getState().status).toBe('IDLE');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads an outdated page after first installation activates without claiming the page', async () => {
    const { registration, container, coordinator, reload, start } = setup();
    container.controller = null;
    registration.active = null;
    start();
    await flush();
    const worker = registration.install();
    const result = coordinator.applyCurrentUpdate();
    await flush();
    registration.installing = null;
    registration.active = worker;
    worker.change('activating');
    await flush();
    expect(coordinator.getState().status).toBe('PREPARING');
    worker.change('activated');
    await expect(result).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('gives an actionable error when the browser does not support service workers', async () => {
    const { coordinator } = setup();
    stop = startAppUpdateChecks(coordinator, undefined);
    await flush();
    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({
      status: 'ERROR',
      error: expect.stringContaining('关闭所有 Loveca 页面'),
    });
  });
  it('does not activate an update if a game starts while installation is pending', async () => {
    const { registration, coordinator, reload, start } = setup();
    let safe = true;
    coordinator.setCanApplyUpdateNow(() => safe);
    start();
    await flush();
    const worker = registration.install();
    const result = coordinator.applyCurrentUpdate();
    await flush();
    safe = false;
    registration.finish(worker);
    await expect(result).resolves.toBe(false);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(coordinator.getState().error).toContain('对局进行中');
  });

  it('does not reload if a game starts while worker activation is pending', async () => {
    const { registration, container, coordinator, reload, start } = setup();
    let safe = true;
    coordinator.setCanApplyUpdateNow(() => safe);
    start();
    await flush();
    const worker = registration.install();
    registration.finish(worker);
    const result = coordinator.applyCurrentUpdate();
    await flush();
    safe = false;
    container.activate(worker);
    await expect(result).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
    safe = true;
    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not trust a stale waiting flag after the browser discards that worker', async () => {
    const { registration, coordinator, reload, start } = setup();
    start();
    await flush();
    const worker = registration.install();
    registration.finish(worker);
    registration.waiting = null;
    worker.change('redundant');
    await expect(coordinator.applyCurrentUpdate()).resolves.toBe(false);
    expect(coordinator.getState().status).toBe('ERROR');
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
