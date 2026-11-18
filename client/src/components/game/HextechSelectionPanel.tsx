import { useId, useState } from 'react';
import { CircleHelp, RefreshCw, Check, UserRound } from 'lucide-react';
import { DialogShell, ActionButton } from '@/components/common';
import { HextechEmblem } from '@/components/hextech/HextechEmblem';
import { useGameStore } from '@/store/gameStore';
import { useBattleCommandSubmission } from '@/lib/battleCommandSubmission';
import { useKeyedState } from '@/hooks/useKeyedState';
import { HEXTECH_RARITY_LABELS } from '@game/domain/hextech/catalog';
import {
  DARK_HEXTECH_OFFER_RULES_TEXT,
  NORMAL_HEXTECH_FIRST_ROUND_RULES_TEXT,
  getHextechRarityRulesText,
} from '@game/domain/hextech/selection-rules';
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
  const pool = match.hextech?.rulesVersion === 'DARK_HEXTECH_V1' ? 'DARK' : 'NORMAL';
  const key = `${match.matchId}:${selection?.turn}:${match.viewerSeat}`;
  const rulesId = useId();
  const [open, setOpen] = useKeyedState(key, true);
  const [helpOpen, setHelpOpen] = useKeyedState(key, false);
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
  const status = locked ? '已确认，等待对方选择' : readOnly ? '等待双方选择' : '选择一项海克斯';

  return (
    <>
      {!open && (
        <button className="hextech-selection-reopen button-primary" onClick={() => setOpen(true)}>
          <HextechEmblem rarity={selection.rarity} />
          海克斯 · {status}
        </button>
      )}
      <DialogShell
        isOpen={open}
        onClose={() => setOpen(false)}
        closeLabel="收起海克斯选择"
        title={
          <>
            海克斯选择<span className="hextech-selection-turn"> · T{selection.turn}</span>
          </>
        }
        icon={<HextechEmblem rarity={selection.rarity} />}
        size="wide"
        className="hextech-selection-dialog"
        headerNavigation={
          <div className="hextech-player-status" role="status" aria-label="双方选择状态">
            {(['FIRST', 'SECOND'] as const).map((seat) => {
              const seatLocked = selection.lockedSeats.includes(seat);
              return (
                <span
                  key={seat}
                  className="hextech-player-progress"
                  data-locked={seatLocked}
                  role="img"
                  aria-label={`${match.participants[seat].name} · ${seatLocked ? '已确认' : '选择中'}`}
                  title={match.participants[seat].name}
                >
                  <span className="hextech-player-marker" aria-hidden="true">
                    {seatLocked ? <Check size={16} /> : <UserRound size={16} />}
                  </span>
                  <span className="hextech-player-name" aria-hidden="true">
                    {match.participants[seat].name}
                  </span>
                </span>
              );
            })}
          </div>
        }
        headerActions={
          <ActionButton
            variant="icon"
            aria-label="海克斯选择规则"
            aria-expanded={helpOpen}
            aria-controls={rulesId}
            onClick={() => setHelpOpen(!helpOpen)}
          >
            <CircleHelp size={18} aria-hidden="true" />
          </ActionButton>
        }
        footer={
          <div className="hextech-selection-footer">
            <p role="status">
              {locked && <Check size={16} aria-hidden="true" />}
              {busy ? '正在处理…' : locked || readOnly ? status : '每项可重抽一次，确认后无法更改'}
            </p>
            {!readOnly && offer && !locked && (
              <ActionButton
                disabled={busy || !canSelect || selectedSlot === null}
                onClick={() =>
                  selectedSlot !== null &&
                  select(selection.turn, selectedSlot, offer.candidates[selectedSlot].definitionId)
                }
              >
                确认选择
              </ActionButton>
            )}
          </div>
        }
      >
        <span className="sr-only">{HEXTECH_RARITY_LABELS[selection.rarity]}色海克斯</span>
        {helpOpen && (
          <div
            id={rulesId}
            className="hextech-selection-help"
            role="note"
            aria-label="海克斯选择规则说明"
          >
            系统随机稀有度，双方同时选择。候选仅自己可见，每项可重抽一次。
            {getHextechRarityRulesText(pool)}
            {pool === 'DARK'
              ? DARK_HEXTECH_OFFER_RULES_TEXT
              : `${NORMAL_HEXTECH_FIRST_ROUND_RULES_TEXT}重抽可能与其他项重复。`}
            双方确认后公开并生效。
          </div>
        )}
        {offer && (
          <div
            className="hextech-offers"
            data-rarity={selection.rarity}
            role="radiogroup"
            aria-label="海克斯候选"
          >
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
                  {!locked && (
                    <button
                      type="button"
                      className="button-ghost hextech-reroll"
                      disabled={readOnly || locked || busy || !canReroll || candidate.rerolled}
                      aria-label={`重抽第 ${slot + 1} 项：${candidate.name}，剩余 ${candidate.rerolled ? 0 : 1} 次`}
                      title={candidate.rerolled ? '本项重抽次数已用完' : '重抽此项，剩余 1 次'}
                      onClick={() => reroll(selection.turn, slot, candidate.definitionId)}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      <span aria-hidden="true">重抽 · {candidate.rerolled ? '0/1' : '1/1'}</span>
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </DialogShell>
    </>
  );
}
