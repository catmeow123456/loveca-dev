import type { PlayerViewState } from '@game/online/types';
import { selectExcelCard } from '@/lib/excelCardView';
import { useGameStore } from '@/store/gameStore';
import { ExcelCardTable } from './ExcelCardTable';

/** Viewing a public reveal never confirms a selection or advances its display window. */
export function ExcelPublicCardTable({
  label,
  cardIds,
  view,
}: {
  label: string;
  cardIds: readonly string[];
  view: PlayerViewState;
}) {
  const selectedCardId = useGameStore((store) => store.ui.selectedCardId);
  const entries = cardIds.flatMap((cardId, index) => {
    const card = selectExcelCard(view, `obj_${cardId}`);
    return card ? [{ card, order: index + 1 }] : [];
  });
  return (
    <>
      <div className="excel-public-cards" tabIndex={0} aria-label={`${label}滚动区域`}>
        <ExcelCardTable
          layout="panel"
          label={label}
          startRow={0}
          rows={entries.map(({ card }) => card)}
          rowNumbers={entries.map(({ order }) => order)}
          count={cardIds.length}
          selectedCardId={selectedCardId}
          onSelect={(card) => {
            const store = useGameStore.getState();
            store.setCardDetail(null);
            store.selectCard(card.cardId);
          }}
        />
      </div>
      {entries.length < cardIds.length && (
        <p>{cardIds.length - entries.length} 张卡牌信息未公开。</p>
      )}
    </>
  );
}
