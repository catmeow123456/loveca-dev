import { useMemo } from 'react';
import type { ThemeDeckListEntryView, ThemePrebuiltDeckView } from '@game/online/theme-table-types';
import { isLiveCardData, isMemberCardData, type AnyCardData } from '@game/domain/entities/card';
import { getCardImageUrl, resolveCardImagePath } from '@/lib/imageService';
import { useGameStore } from '@/store/gameStore';
import '@/components/pages/theme-table.css';

export function ThemeDeckGallery({
  deck,
  onViewCard,
}: {
  deck: ThemePrebuiltDeckView;
  onViewCard: (card: AnyCardData) => void;
}) {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const sections = useMemo(() => {
    const members: ThemeDeckListEntryView[] = [];
    const lives: ThemeDeckListEntryView[] = [];
    const otherMain: ThemeDeckListEntryView[] = [];

    deck.mainDeck.forEach((entry) => {
      const card = cardDataRegistry.get(entry.cardCode);
      if (card && isMemberCardData(card)) members.push(entry);
      else if (card && isLiveCardData(card)) lives.push(entry);
      else otherMain.push(entry);
    });

    return [
      {
        key: 'members',
        title: '成员',
        entries: sortDeckEntries(members, (cardCode) => cardDataRegistry.get(cardCode)),
      },
      {
        key: 'lives',
        title: 'LIVE',
        entries: sortDeckEntries(lives, (cardCode) => cardDataRegistry.get(cardCode)),
      },
      ...(otherMain.length > 0
        ? [{ key: 'other', title: '其他主卡组卡牌', entries: otherMain }]
        : []),
      { key: 'energy', title: '能量', entries: deck.energyDeck },
    ].filter((section) => section.entries.length > 0);
  }, [cardDataRegistry, deck]);

  return (
    <div className="theme-deck-gallery">
      {sections.map((section) => (
        <ThemeDeckGallerySection
          key={section.key}
          title={section.title}
          entries={section.entries}
          onViewCard={onViewCard}
        />
      ))}
    </div>
  );
}

function ThemeDeckGallerySection({
  title,
  entries,
  onViewCard,
}: {
  title: string;
  entries: readonly ThemeDeckListEntryView[];
  onViewCard: (card: AnyCardData) => void;
}) {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const totalCards = entries.reduce((total, entry) => total + entry.count, 0);

  return (
    <section className="theme-deck-gallery__section">
      <div className="theme-deck-gallery__heading">
        <h4>{title}</h4>
        <span>
          {totalCards} 张 · {entries.length} 种
        </span>
      </div>
      <div className="theme-deck-gallery__grid">
        {entries.map((entry) => {
          const card = cardDataRegistry.get(entry.cardCode);
          const displayName = card?.nameCn?.trim() || card?.name?.trim() || entry.cardCode;
          const image = (
            <span className="theme-deck-gallery-card__image">
              <img
                src={
                  card
                    ? resolveCardImagePath(card, 'thumb')
                    : getCardImageUrl(entry.cardCode, 'thumb')
                }
                alt=""
                loading="lazy"
                decoding="async"
              />
              <strong aria-label={`${entry.count} 张`}>×{entry.count}</strong>
            </span>
          );

          if (!card) {
            return (
              <div key={entry.cardCode} className="theme-deck-gallery-card is-unavailable">
                {image}
                <span title={entry.cardCode}>{entry.cardCode}</span>
              </div>
            );
          }

          return (
            <button
              key={entry.cardCode}
              type="button"
              className="theme-deck-gallery-card"
              aria-label={`查看${displayName}，${entry.count} 张`}
              title={`${displayName} · ${entry.cardCode}`}
              onClick={() => onViewCard(card)}
            >
              {image}
              <span>{displayName}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function sortDeckEntries(
  entries: readonly ThemeDeckListEntryView[],
  getCardData: (cardCode: string) => AnyCardData | undefined
): ThemeDeckListEntryView[] {
  return [...entries].sort((left, right) => {
    const leftCard = getCardData(left.cardCode);
    const rightCard = getCardData(right.cardCode);
    const leftValue =
      leftCard && isMemberCardData(leftCard)
        ? leftCard.cost
        : leftCard && isLiveCardData(leftCard)
          ? leftCard.score
          : Number.MAX_SAFE_INTEGER;
    const rightValue =
      rightCard && isMemberCardData(rightCard)
        ? rightCard.cost
        : rightCard && isLiveCardData(rightCard)
          ? rightCard.score
          : Number.MAX_SAFE_INTEGER;
    return leftValue - rightValue || left.cardCode.localeCompare(right.cardCode);
  });
}
