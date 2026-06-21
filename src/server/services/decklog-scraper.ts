/**
 * DeckLog 卡组爬取服务
 *
 * 通过 DeckLog 内部 JSON API 获取卡组数据
 * API:
 * - 日版: POST https://decklog.bushiroad.com/system/app/api/view/{deckId}
 * - 国际版 Japanese Edition: POST https://decklog-en.bushiroad.com/system/app-ja/api/view/{deckId}
 */

import { normalizeCardCode } from '../../shared/utils/card-code.js';

export type DecklogSource = 'jp' | 'en';

interface DecklogEndpoint {
  source: DecklogSource;
  label: string;
  viewUrl: string;
  apiUrl: string;
  expectedGameTitleId: number;
}

const DECKLOG_ENDPOINTS: Record<DecklogSource, DecklogEndpoint> = {
  jp: {
    source: 'jp',
    label: '日版 DeckLog',
    viewUrl: 'https://decklog.bushiroad.com/view/',
    apiUrl: 'https://decklog.bushiroad.com/system/app/api/view/',
    expectedGameTitleId: 11,
  },
  en: {
    source: 'en',
    label: '国际版 DeckLog',
    viewUrl: 'https://decklog-en.bushiroad.com/ja/view/',
    apiUrl: 'https://decklog-en.bushiroad.com/system/app-ja/api/view/',
    expectedGameTitleId: 109,
  },
};

/** DeckLog API 返回的卡牌条目 */
interface DeckLogCardRatio {
  card_number: string;
  num: number;
}

/** DeckLog API 返回的卡组数据 */
interface DeckLogDeck {
  id?: number;
  deck_id?: string;
  game_title_id?: number;
  title: string;
  memo: string;
  list: DeckLogCardRatio[];
  sub_list: DeckLogCardRatio[];
}

/** 爬取结果中的单张卡牌 */
export interface ScrapedCard {
  /** 标准化后的卡牌编号 */
  card_code: string;
  /** 原始卡牌编号（来自 DeckLog） */
  raw_code: string;
  /** 在卡组中的数量 */
  count: number;
}

/** 爬取结果 */
export interface DecklogScrapeResult {
  success: boolean;
  cards: ScrapedCard[];
  /** 卡组名称 */
  deckName: string;
  /** DeckLog 来源 */
  source?: DecklogSource;
  error?: string;
}

export interface ExtractedDecklogInput {
  deckId: string;
  sourceHint?: DecklogSource;
}

/**
 * 从用户输入中提取 DeckLog 卡组 ID
 * 支持格式：
 * - 纯 ID：2D6XL
 * - 完整 URL：https://decklog.bushiroad.com/view/2D6XL
 * - 国际版 URL：https://decklog-en.bushiroad.com/ja/view/60G2Q
 */
export function extractDecklogInput(input: string): ExtractedDecklogInput | null {
  const trimmed = input.trim();

  // 完整 URL
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?(decklog(?:-en)?\.bushiroad\.com)\/(?:ja\/)?view\/([A-Za-z0-9]+)/i
  );
  if (urlMatch) {
    return {
      deckId: urlMatch[2],
      sourceHint: urlMatch[1].toLowerCase() === 'decklog-en.bushiroad.com' ? 'en' : 'jp',
    };
  }

  // 纯 ID（字母数字，通常 4-8 位）
  if (/^[A-Za-z0-9]{4,12}$/.test(trimmed)) return { deckId: trimmed };

  return null;
}

export function extractDecklogId(input: string): string | null {
  return extractDecklogInput(input)?.deckId ?? null;
}

/**
 * 通过 DeckLog JSON API 获取卡组数据
 * @param deckId 卡组 ID（如 "2D6XL"）
 * @param source DeckLog 来源
 * @param timeout 超时时间（毫秒），默认 15 秒
 */
export async function scrapeDecklog(
  deckId: string,
  source: DecklogSource = 'jp',
  timeout = 15000
): Promise<DecklogScrapeResult> {
  const endpoint = DECKLOG_ENDPOINTS[source];
  const apiUrl = endpoint.apiUrl + deckId;
  const referer = endpoint.viewUrl + deckId;

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Referer: referer,
      },
      body: 'null',
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    const msg =
      err instanceof DOMException && err.name === 'TimeoutError'
        ? '请求 DeckLog 超时'
        : `网络错误: ${err instanceof Error ? err.message : String(err)}`;
    return { success: false, cards: [], deckName: '', source, error: msg };
  }

  if (!response.ok) {
    return {
      success: false,
      cards: [],
      deckName: '',
      source,
      error: `DeckLog API 返回 HTTP ${response.status}`,
    };
  }

  // 检查响应是否为 JSON
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    return {
      success: false,
      cards: [],
      deckName: '',
      source,
      error: 'DeckLog API 返回了非 JSON 响应，可能该卡组不存在',
    };
  }

  let deck: DeckLogDeck;
  try {
    deck = (await response.json()) as DeckLogDeck;
  } catch {
    return {
      success: false,
      cards: [],
      deckName: '',
      source,
      error: 'DeckLog API 返回的 JSON 格式异常',
    };
  }

  const deckName = deck.title || `DeckLog ${deckId}`;

  if (deck.game_title_id != null && deck.game_title_id !== endpoint.expectedGameTitleId) {
    return {
      success: false,
      cards: [],
      deckName,
      source,
      error: `所选${endpoint.label} 卡组不是 Loveca 卡组`,
    };
  }

  // 合并 list（主卡组）和 sub_list（副卡组）
  const allItems = [...(deck.list || []), ...(deck.sub_list || [])];

  if (allItems.length === 0) {
    return {
      success: false,
      cards: [],
      deckName,
      source,
      error: '卡组数据为空',
    };
  }

  const cards: ScrapedCard[] = [];
  for (const item of allItems) {
    const rawCode = item.card_number.replace(/＋/g, '+');
    const cardCode = normalizeCardCode(rawCode);
    if (!cardCode) continue;

    cards.push({
      card_code: cardCode,
      raw_code: rawCode,
      count: item.num,
    });
  }

  if (cards.length === 0) {
    return {
      success: false,
      cards: [],
      deckName,
      source,
      error: '未能标准化任何卡牌编号',
    };
  }

  return { success: true, cards, deckName, source };
}
