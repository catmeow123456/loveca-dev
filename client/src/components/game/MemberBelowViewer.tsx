import { useRef, useState } from 'react';
import { isLiveCardData, isMemberCardData } from '@game/domain/entities/card';
import { DialogShell } from '@/components/common/DialogShell';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { useGameStore } from '@/store/gameStore';
import { BattleCardCandidateGrid } from './BattleCardCandidateGrid';

/** Read-only inspection of the current viewer's projected member stack. */
export function MemberBelowViewer({
  cardIds,
  memberName,
}: {
  cardIds: readonly string[];
  memberName: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const getPresentation = useGameStore((state) => state.getVisibleCardPresentation);
  const setHoveredCard = useGameStore((state) => state.setHoveredCard);
  const close = () => {
    setOpen(false);
    setHoveredCard(null);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`查看${memberName}下方的${cardIds.length}张卡牌`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="absolute bottom-0 right-1 z-30 min-h-6 rounded-full border border-amber-300/45 bg-amber-950/85 px-2 py-1 text-[10px] font-medium text-amber-400 shadow-sm backdrop-blur hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setHoveredCard(null);
          setOpen(true);
        }}
      >
        ×{cardIds.length}
      </button>
      <DialogShell
        isOpen={open}
        title="下方卡牌"
        description={`${memberName} · ${cardIds.length}张`}
        onClose={close}
        closeLabel="关闭下方卡牌"
        returnFocusRef={buttonRef}
      >
        <BattleCardCandidateGrid
          label="下方卡牌列表"
          readOnly
          candidates={cardIds.map((id) => {
            const presentation = getPresentation(id);
            const data = presentation?.cardData;
            const number =
              data &&
              (isMemberCardData(data) ? data.cost : isLiveCardData(data) ? data.score : null);
            return {
              id,
              presentation,
              label: data
                ? `${typeof number === 'number' ? `${number} ` : ''}${getCardLocalizedInfo(data).title}`
                : '未公开卡牌',
            };
          })}
        />
      </DialogShell>
    </>
  );
}
