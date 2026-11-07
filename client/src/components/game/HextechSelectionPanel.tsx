import { useState } from 'react';
import { Hexagon, RefreshCw, Check } from 'lucide-react';
import { DialogShell, ActionButton } from '@/components/common';
import { useGameStore } from '@/store/gameStore';
import { useBattleCommandSubmission } from '@/lib/battleCommandSubmission';
import { useKeyedState } from '@/hooks/useKeyedState';
import { HEXTECH_RARITY_LABELS } from '@game/domain/hextech/catalog';
import { GameCommandType } from '@game/application/game-commands';
import type { MatchViewState } from '@game/online/types';
import './hextech-selection.css';

export function HextechSelectionPanel({
  match,
  readOnly,
}: {
  match: MatchViewState;
  readOnly: boolean;
}) {
  const selection = match.hextech?.selection;
  const key = `${match.matchId}:${selection?.turn}:${match.viewerSeat}`;
  const [open, setOpen] = useKeyedState(key, true);
  const [choice, setChoice] = useState<{ key: string; slot: number; definitionId: string } | null>(
    null
  );
  const busy = useBattleCommandSubmission((state) => state.pendingCount > 0);
  const reroll = useGameStore((state) => state.rerollHextech);
  const select = useGameStore((state) => state.selectHextech);
  const canSelect = useGameStore((state) => state.canUseAction(GameCommandType.SELECT_HEXTECH));
  const canReroll = useGameStore((state) => state.canUseAction(GameCommandType.REROLL_HEXTECH));
  if (!selection) return null;
  const offer = selection.ownOffer;
  const locked = offer?.selectedIndex !== undefined;
  const selectedSlot =
    choice?.key === key && offer?.candidates[choice.slot]?.definitionId === choice.definitionId
      ? choice.slot
      : null;
  const status = locked ? '已锁定，等待对方选择' : readOnly ? '等待双方选择' : '选择一项海克斯';

  return (
    <>
      {!open && (
        <button className="hextech-selection-reopen button-primary" onClick={() => setOpen(true)}>
          <Hexagon size={16} aria-hidden="true" />
          海克斯 · {status}
        </button>
      )}
      <DialogShell
        isOpen={open}
        onClose={() => setOpen(false)}
        closeLabel="收起海克斯选择"
        title={`海克斯选择 · T${selection.turn}`}
        icon={<Hexagon size={22} />}
        size="wide"
        description={`系统随机：${HEXTECH_RARITY_LABELS[selection.rarity]}色海克斯 · 双方同时选择`}
        footer={
          <div className="hextech-selection-footer">
            <p role="status">{busy ? '正在提交…' : status}</p>
            {!readOnly && offer && !locked && (
              <ActionButton
                disabled={busy || !canSelect || selectedSlot === null}
                onClick={() =>
                  selectedSlot !== null &&
                  select(selection.turn, selectedSlot, offer.candidates[selectedSlot].definitionId)
                }
              >
                <Check size={16} aria-hidden="true" />
                锁定选择
              </ActionButton>
            )}
          </div>
        }
      >
        <div className="hextech-player-status" aria-label="双方选择状态">
          {(['FIRST', 'SECOND'] as const).map((seat) => (
            <span key={seat}>
              {match.participants[seat].name} ·{' '}
              {selection.lockedSeats.includes(seat) ? '已锁定' : '选择中'}
            </span>
          ))}
        </div>
        {offer && (
          <>
            <p className="hextech-selection-help">
              候选仅自己可见，每项可重抽一次。重抽可能与其他项重复。锁定后不可更改，双方完成后公开生效。
            </p>
            <div className="hextech-offers" role="radiogroup" aria-label="海克斯候选">
              {offer.candidates.map((candidate, slot) => {
                const selected = locked ? offer.selectedIndex === slot : selectedSlot === slot;
                return (
                  <article
                    className="hextech-offer"
                    data-selected={selected}
                    key={`${slot}:${candidate.definitionId}`}
                  >
                    <label>
                      <div className="hextech-offer-heading">
                        <input
                          type="radio"
                          name={`hextech-${key}`}
                          value={slot}
                          checked={selected}
                          disabled={readOnly || locked || busy || !canSelect}
                          onChange={() =>
                            setChoice({ key, slot, definitionId: candidate.definitionId })
                          }
                        />
                        <strong>{candidate.name}</strong>
                      </div>
                      <p>{candidate.rulesText}</p>
                    </label>
                    <button
                      type="button"
                      className="button-ghost"
                      disabled={readOnly || locked || busy || !canReroll || candidate.rerolled}
                      aria-label={`重抽第 ${slot + 1} 项：${candidate.name}`}
                      onClick={() => reroll(selection.turn, slot, candidate.definitionId)}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      {candidate.rerolled ? '已重抽 · 0/1' : '重抽 · 1/1'}
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </DialogShell>
    </>
  );
}
