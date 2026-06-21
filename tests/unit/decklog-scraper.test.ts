import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractDecklogId,
  extractDecklogInput,
  scrapeDecklog,
} from '../../src/server/services/decklog-scraper';

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('decklog scraper input parsing', () => {
  it('extracts pure deck id without source hint', () => {
    expect(extractDecklogInput('60G2Q')).toEqual({ deckId: '60G2Q' });
    expect(extractDecklogId('60G2Q')).toBe('60G2Q');
  });

  it('extracts Japanese DeckLog URL source', () => {
    expect(extractDecklogInput('https://decklog.bushiroad.com/view/2D6XL')).toEqual({
      deckId: '2D6XL',
      sourceHint: 'jp',
    });
  });

  it('extracts international DeckLog Japanese Edition URL source', () => {
    expect(extractDecklogInput('https://decklog-en.bushiroad.com/ja/view/60G2Q')).toEqual({
      deckId: '60G2Q',
      sourceHint: 'en',
    });
    expect(extractDecklogInput('decklog-en.bushiroad.com/view/60G2Q')).toEqual({
      deckId: '60G2Q',
      sourceHint: 'en',
    });
  });
});

describe('scrapeDecklog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the Japanese DeckLog API by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        title: '春選抜',
        game_title_id: 11,
        list: [{ card_number: 'PL!N-bp1-002-R＋', num: 4 }],
        sub_list: [{ card_number: 'PL!HS-bp1-029-PE', num: 12 }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await scrapeDecklog('2D6XL');

    expect(result.success).toBe(true);
    expect(result.deckName).toBe('春選抜');
    expect(result.source).toBe('jp');
    expect(result.cards).toEqual([
      { card_code: 'PL!N-bp1-002-R+', raw_code: 'PL!N-bp1-002-R+', count: 4 },
      { card_code: 'PL!HS-bp1-029-PE', raw_code: 'PL!HS-bp1-029-PE', count: 12 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://decklog.bushiroad.com/system/app/api/view/2D6XL',
      expect.objectContaining({
        method: 'POST',
        body: 'null',
        headers: expect.objectContaining({
          Referer: 'https://decklog.bushiroad.com/view/2D6XL',
        }),
      })
    );
  });

  it('uses the international DeckLog app-ja API for Loveca decks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        title: '嵐豬',
        game_title_id: 109,
        list: [{ card_number: 'PL!N-bp1-003-R＋', num: 4 }],
        sub_list: [{ card_number: 'PL!N-bp1-034-PE', num: 1 }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await scrapeDecklog('60G2Q', 'en');

    expect(result.success).toBe(true);
    expect(result.deckName).toBe('嵐豬');
    expect(result.source).toBe('en');
    expect(result.cards).toEqual([
      { card_code: 'PL!N-bp1-003-R+', raw_code: 'PL!N-bp1-003-R+', count: 4 },
      { card_code: 'PL!N-bp1-034-PE', raw_code: 'PL!N-bp1-034-PE', count: 1 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://decklog-en.bushiroad.com/system/app-ja/api/view/60G2Q',
      expect.objectContaining({
        method: 'POST',
        body: 'null',
        headers: expect.objectContaining({
          Referer: 'https://decklog-en.bushiroad.com/ja/view/60G2Q',
        }),
      })
    );
  });

  it('rejects a deck from the selected source when it is not Loveca', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        title: 'ArmDragon',
        game_title_id: 6,
        list: [{ card_number: 'ETD01-018', num: 3 }],
        sub_list: [],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await scrapeDecklog('60G2Q', 'jp');

    expect(result.success).toBe(false);
    expect(result.error).toBe('所选日版 DeckLog 卡组不是 Loveca 卡组');
    expect(result.cards).toEqual([]);
  });
});
