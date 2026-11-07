import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('node:child_process', () => ({ fork: mocks.fork }));
import { DeckClassifierProcessRuntime } from '../../src/server/services/deck-classifier-process-runtime';

class Child extends EventEmitter {
  connected = true;
  send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => callback(null));
  kill = vi.fn();
}

describe('API classification process supervisor', () => {
  let runtime: DeckClassifierProcessRuntime;
  let child: Child;
  beforeEach(() => {
    vi.useFakeTimers();
    child = new Child();
    mocks.fork.mockReturnValue(child);
    runtime = new DeckClassifierProcessRuntime();
  });
  afterEach(() => {
    runtime.stop();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('starts one OS process and sends compact requests instead of computing in the API', async () => {
    runtime.start();
    runtime.start();
    runtime.notify();
    expect(mocks.fork).toHaveBeenCalledOnce();
    expect(mocks.fork).toHaveBeenCalledWith(
      expect.stringContaining('deck-classifier-process.js'),
      [],
      expect.objectContaining({ env: expect.objectContaining({ DECK_CLASSIFIER_PROCESS: '1' }) })
    );
    expect(child.send).toHaveBeenCalledWith({ kind: 'notify' }, expect.any(Function));
    const result = runtime.preview(7, null);
    const request = child.send.mock.calls[1]?.[0] as { id: string };
    expect(request).toEqual({
      kind: 'preview',
      id: expect.any(String),
      revision: 7,
      matchLimit: null,
    });
    await expect(runtime.preview(7, 200)).rejects.toMatchObject({ statusCode: 409 });
    child.emit('message', {
      kind: 'preview-result',
      id: request.id,
      result: { observationCount: 1000 },
    });
    await expect(result).resolves.toEqual({ observationCount: 1000 });
  });

  it('restarts after a crash and rejects the pending preview without losing durable jobs', async () => {
    runtime.start();
    const result = runtime.preview(7, 200);
    const rejected = expect(result).rejects.toMatchObject({ statusCode: 503 });
    child.emit('exit', 1);
    child.emit('close', 1);
    await rejected;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.fork).toHaveBeenCalledTimes(2);
  });

  it('retries a process that could not spawn and never emitted exit', async () => {
    runtime.start();
    child.connected = false;
    child.emit('error', new Error('spawn failed'));
    child.emit('close', -1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.fork).toHaveBeenCalledTimes(2);
  });

  it('does not kill a durable task when a preview times out, and bounds pending previews', async () => {
    runtime.start();
    const result = runtime.preview(7, null);
    const rejected = expect(result).rejects.toMatchObject({ statusCode: 504 });
    await vi.advanceTimersByTimeAsync(300_000);
    await rejected;
    expect(child.kill).not.toHaveBeenCalled();
    await expect(runtime.preview(7, 200)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('stops and force terminates an unresponsive child without restarting it', async () => {
    runtime.start();
    runtime.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('exit', 0);
    child.emit('close', 0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.fork).toHaveBeenCalledOnce();
  });
});
