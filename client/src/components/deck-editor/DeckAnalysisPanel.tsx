import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import type { DeckConfig } from '@game/domain/card-data/deck-loader';
import { calculateDeckAnalysis } from '@/lib/deckAnalysis';
import { DeckAnalysisCharts } from '@/components/common/DeckAnalysisCharts';

export function DeckAnalysisPanel({ deck }: { deck: DeckConfig }) {
  const { getCardData } = useGameStore(useShallow((s) => ({ getCardData: s.getCardData })));
  const analysis = useMemo(
    () =>
      calculateDeckAnalysis(
        [...deck.main_deck.members, ...deck.main_deck.lives].flatMap((entry) => {
          const card = getCardData(entry.card_code);
          return card ? [{ ...card, count: entry.count }] : [];
        })
      ),
    [deck, getCardData]
  );
  return (
    <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto p-3">
      <DeckAnalysisCharts analysis={analysis} />
    </div>
  );
}
