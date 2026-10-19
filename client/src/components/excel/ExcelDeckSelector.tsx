import { useState } from 'react';
import type { DeckDisplayItem } from '@/lib/deckDisplay';
import { deckRecordToConfig } from '@/lib/deckRecordUtils';
import { useGameStore } from '@/store/gameStore';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { TextCardDetails } from './TextCard';

export function ExcelDeckSelector({
  decks,
  selectedId,
  onSelect,
  title,
  error,
  loading,
  onRefresh,
}: {
  decks: readonly DeckDisplayItem[];
  selectedId?: string | null;
  onSelect: (deck: DeckDisplayItem) => void;
  title: string;
  error?: string | null;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  const [viewed, setViewed] = useState<DeckDisplayItem | null>(null);
  const [cardCode, setCardCode] = useState<string | null>(null);
  const cards = useGameStore((state) => state.cardDataRegistry);
  const config =
    viewed?.localDeck?.config ?? (viewed?.cloudDeck ? deckRecordToConfig(viewed.cloudDeck) : null);
  const entries = config
    ? [...config.main_deck.members, ...config.main_deck.lives, ...config.energy_deck]
    : [];
  const card = cardCode ? cards.get(cardCode) : undefined;
  return (
    <section className="excel-deck-selector">
      <h2>{title}</h2>
      {onRefresh && (
        <button onClick={onRefresh} disabled={loading}>
          刷新卡组
        </button>
      )}
      {loading && <p role="status">正在读取卡组…</p>}
      {error && <p role="alert">{error}</p>}
      <table className="excel-table" aria-label="卡组列表">
        <thead>
          <tr>
            <th>卡组</th>
            <th>成员 / LIVE / 能量</th>
            <th>有效性</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {decks.map((deck) => (
            <tr key={deck.id} aria-selected={selectedId === deck.id}>
              <td>{deck.name}</td>
              <td>
                {deck.memberCount} / {deck.liveCount} / {deck.energyCount}
              </td>
              <td>{deck.isValid ? '合法' : '不合法，无法使用'}</td>
              <td>
                <button disabled={!deck.isValid || loading} onClick={() => onSelect(deck)}>
                  {selectedId === deck.id ? '已选择' : '选择'}
                </button>
                <button
                  onClick={() => {
                    setViewed(deck);
                    setCardCode(null);
                  }}
                >
                  查看内容
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && !decks.length && <p>没有可用卡组，请在普通界面准备合法卡组。</p>}
      {viewed && (
        <section className="excel-deck-contents">
          <h3>{viewed.name}</h3>
          <button onClick={() => setViewed(null)}>收起内容</button>
          <table className="excel-table">
            <thead>
              <tr>
                <th>卡名</th>
                <th>卡号</th>
                <th>数量</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.card_code}:${index}`}>
                  <td>
                    <button onClick={() => setCardCode(entry.card_code)}>
                      {cards.has(entry.card_code)
                        ? getCardLocalizedInfo(cards.get(entry.card_code)!).title
                        : '卡牌数据未加载'}
                    </button>
                  </td>
                  <td>{entry.card_code}</td>
                  <td>{entry.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {card && <TextCardDetails card={card} />}
        </section>
      )}
    </section>
  );
}
