import { afterEach, expect, it, vi } from 'vitest';
import { apiClient } from './apiClient';
import { cardService } from './cardService';
import { publicCardRecordSchema } from '@game/shared/public-card-catalog';

const card = {
  ...Object.fromEntries(Object.keys(publicCardRecordSchema.shape).map((key) => [key, null])),
  card_code: 'test-energy',
  card_type: 'ENERGY',
  name_cn: '测试能量',
  hearts: [],
  requirements: [],
};

afterEach(() => vi.restoreAllMocks());

it('shares in-flight loads and revalidates subsequent reads, without clearing prior results', async () => {
  let finish!: (value: Awaited<ReturnType<typeof apiClient.getPublishedCards>>) => void;
  const get = vi.spyOn(apiClient, 'getPublishedCards').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const first = cardService.getPublishedCards();
  const concurrent = cardService.getPublishedCards(true);
  expect(first).toBe(concurrent);
  expect(get).toHaveBeenCalledTimes(1);
  finish({ data: { schemaVersion: 1, cards: [card] }, error: null });
  const original = await first;
  expect(original[0].cardCode).toBe('test-energy');
  get.mockResolvedValueOnce({
    data: null,
    error: { code: 'TIMEOUT', message: '超时' },
    requestId: 'request-123',
  });
  await expect(cardService.getPublishedCards()).rejects.toMatchObject({
    code: 'TIMEOUT',
    requestId: 'request-123',
  });
  expect(original).toHaveLength(1);
  get.mockResolvedValueOnce({
    data: { schemaVersion: 1, cards: [{ ...card, name_cn: '新版能量' }] },
    error: null,
  });
  expect((await cardService.getPublishedCards(true))[0].name).toBe('新版能量');
  expect(get).toHaveBeenLastCalledWith({ reload: true });
});

it.each([
  null,
  { schemaVersion: 1, cards: [] },
  { schemaVersion: 2, cards: [card] },
  { schemaVersion: 1, cards: [card, card] },
  { schemaVersion: 1, cards: [{ ...card, hearts: 'bad' }] },
])('rejects incomplete or unknown catalogs without treating them as initialized', async (data) => {
  const get = vi.spyOn(apiClient, 'getPublishedCards').mockResolvedValue({ data, error: null });
  await expect(cardService.getPublishedCards()).rejects.toMatchObject({ code: 'INVALID_CATALOG' });
  expect(get).toHaveBeenCalledTimes(1);
});
