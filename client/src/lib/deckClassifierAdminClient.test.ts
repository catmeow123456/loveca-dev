import { describe, expect, it, vi } from 'vitest';
import type { DeckClassificationRunView } from '@game/online/deck-classifier-types';
import { waitForDeckClassificationRun } from './deckClassifierAdminClient';

const BASE_RUN: DeckClassificationRunView = {
  id: '44444444-4444-4444-8444-444444444444',
  releaseId: '55555555-5555-4555-8555-555555555555',
  releaseVersion: 1,
  status: 'QUEUED',
  trigger: 'MANUAL_OVERRIDE',
  scopeSeasonId: null,
  reason: '人工复核卡组分类',
  totalCount: 0,
  processedCount: 0,
  classifiedCount: 0,
  unknownCount: 0,
  ambiguousCount: 0,
  invalidCount: 0,
  excludedCount: 0,
  changedCount: 0,
  errorMessage: null,
  createdAt: 0,
  startedAt: null,
  finishedAt: null,
};

describe('waitForDeckClassificationRun', () => {
  it('waits until the asynchronous classification run succeeds', async () => {
    const readRun = vi
      .fn<(runId: string) => Promise<DeckClassificationRunView>>()
      .mockResolvedValueOnce({ ...BASE_RUN, status: 'RUNNING' })
      .mockResolvedValueOnce({
        ...BASE_RUN,
        status: 'SUCCEEDED',
        totalCount: 102,
        processedCount: 102,
        changedCount: 9,
        finishedAt: 1,
      });

    const result = await waitForDeckClassificationRun(BASE_RUN, {
      pollIntervalMs: 0,
      timeoutMs: 100,
      readRun,
    });

    expect(result).toMatchObject({ status: 'SUCCEEDED', processedCount: 102, changedCount: 9 });
    expect(readRun).toHaveBeenCalledTimes(2);
  });

  it('returns null when a classification run does not finish before the timeout', async () => {
    const readRun = vi.fn(async () => BASE_RUN);

    const result = await waitForDeckClassificationRun(BASE_RUN, {
      pollIntervalMs: 0,
      timeoutMs: 0,
      readRun,
    });

    expect(result).toBeNull();
    expect(readRun).not.toHaveBeenCalled();
  });
});
