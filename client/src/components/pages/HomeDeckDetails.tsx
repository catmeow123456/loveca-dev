import { useMemo } from 'react';
import { PresentationImage } from '@/components/excel/PresentationRoot';
import { useGameStore } from '@/store/gameStore';
import { useDeckPointTableRules } from '@/hooks/useDeckPointTable';
import { createDeckRecordCardTypeResolver, deckRecordToConfig } from '@/lib/deckRecordUtils';
import type { DeckDisplayItem } from '@/lib/deckDisplay';

/** 使用同一卡组投影展示只读构筑；不进入编辑、导入或保存流程。 */
export function HomeDeckDetails({ deck }: { deck: DeckDisplayItem }) {
  const registry = useGameStore((s) => s.cardDataRegistry);
  const getCardImagePath = useGameStore((s) => s.getCardImagePath);
  const pointTable = useDeckPointTableRules();
  const config = useMemo(
    () =>
      deck.cloudDeck
        ? deckRecordToConfig(deck.cloudDeck, {
            resolveCardType: createDeckRecordCardTypeResolver(registry),
          })
        : deck.localDeck?.config,
    [deck, registry]
  );
  const groups = config
    ? [
        { label: '成员', entries: config.main_deck.members },
        { label: 'LIVE', entries: config.main_deck.lives },
        { label: '能量', entries: config.energy_deck },
      ]
    : [];
  return (
    <div className="home-deck-details">
      <dl className="home-deck-stats">
        {[
          ['成员', `${deck.memberCount} / 48`],
          ['LIVE', `${deck.liveCount} / 12`],
          ['能量', `${deck.energyCount} / 12`],
          ['PT', `${deck.pointTotal} / ${pointTable.pointLimit}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {deck.description && <p className="home-dialog-intro">{deck.description}</p>}
      {groups.map(({ label, entries }) => (
        <section key={label} className="home-deck-group">
          <h3>
            {label}
            <span>{entries.reduce((total, entry) => total + entry.count, 0)} 张</span>
          </h3>
          <div className="home-deck-card-grid">
            {entries.map((entry) => {
              const card = registry.get(entry.card_code);
              const name = card?.nameCn || card?.name || entry.card_code;
              return (
                <figure key={entry.card_code}>
                  <PresentationImage
                    src={getCardImagePath(entry.card_code)}
                    alt={name}
                    loading="lazy"
                  />
                  <figcaption>
                    <span>{name}</span>
                    <strong>×{entry.count}</strong>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
