import { useEffect } from 'react';
import { DialogShell, ActionButton } from '@/components/common';
import { useGameStore } from '@/store/gameStore';
import { useBattleCommandSubmission } from '@/lib/battleCommandSubmission';
import { useKeyedState } from '@/hooks/useKeyedState';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { formatFrontMetrics } from '@/lib/excelCardView';
import { GameCommandType } from '@game/application/game-commands';
import type { MatchViewState } from '@game/online/types';

export function HextechAbilityPanel({
  match,
  readOnly,
  activeInstanceId,
  onClose,
}: {
  match: MatchViewState;
  readOnly: boolean;
  activeInstanceId: string | null;
  onClose: () => void;
}) {
  const pending = match.hextech?.pendingSearch;
  const ability = match.hextech?.abilities?.find((item) => item.instanceId === activeInstanceId);
  const instanceId = pending?.instanceId ?? ability?.instanceId;
  const cards = pending?.candidates ?? ability?.candidates ?? [];
  const min = pending?.requiredCount ?? ability?.min ?? 0;
  const max = pending?.requiredCount ?? ability?.max ?? 0;
  const key = `${match.matchId}:${match.turnCount}:${match.viewerSeat}:${instanceId}:${cards.map((c) => c.objectId).join(',')}`;
  const [selected, setSelected] = useKeyedState<readonly string[]>(key, []);
  const [open, setOpen] = useKeyedState(key, true);
  const [showDetails, setShowDetails] = useKeyedState<string | null>(key, null);
  const busy = useBattleCommandSubmission((state) => state.pendingCount > 0);
  const resolve = useGameStore((state) => state.resolveHextechSearch);
  const activate = useGameStore((state) => state.activateHextech);
  const imagePath = useGameStore((state) => state.getCardImagePath);
  const allowed = useGameStore((state) =>
    state.canUseAction(
      pending ? GameCommandType.RESOLVE_HEXTECH_SEARCH : GameCommandType.ACTIVATE_HEXTECH
    )
  );
  useEffect(() => {
    if (activeInstanceId && !ability) onClose();
  }, [activeInstanceId, ability, onClose]);
  if (!instanceId || (!pending && !ability)) return null;
  const source = match.hextech!.owned.find((item) => item.instanceId === instanceId)!;
  const ownChoice = !readOnly && (!pending || pending.ownerSeat === match.viewerSeat);
  const close = () => {
    setOpen(false);
    if (!pending) onClose();
  };
  return (
    <>
      {!open && pending && (
        <button className="hextech-selection-reopen button-primary" onClick={() => setOpen(true)}>
          海克斯 · 继续处理{source.name}
        </button>
      )}
      <DialogShell
        isOpen={open}
        onClose={close}
        closeLabel="收起海克斯效果"
        title={source.name}
        description={source.rulesText}
        size="wide"
        footer={
          <div className="hextech-selection-footer">
            <p role="status">
              {ownChoice
                ? `已选择 ${selected.length} 张${min === max ? `，需要 ${min} 张` : `，至少 ${min} 张`}`
                : `等待${match.participants[pending?.ownerSeat ?? match.viewerSeat].name}处理`}
            </p>
            {ownChoice && (
              <ActionButton
                disabled={busy || !allowed || selected.length < min || selected.length > max}
                onClick={() => {
                  const ids = selected.map((id) => id.replace(/^obj_/, ''));
                  if (pending) resolve(instanceId, ids);
                  else activate(instanceId, ids);
                }}
              >
                {busy ? '正在提交…' : pending ? '确认检索' : '确认发动'}
              </ActionButton>
            )}
          </div>
        }
      >
        {ownChoice && (
          <>
            <p>
              {pending
                ? `请选择 ${min} 张 LIVE 加入手牌。主卡组候选按卡号展示，确认后洗切主卡组。`
                : ability?.selectionLabel}
            </p>
            {pending && !cards.length && <p>没有可检索的 LIVE，请确认继续。</p>}
            <div className="hextech-choice-cards" role="group" aria-label="海克斯选牌">
              {cards.map((card) => {
                const info = getCardLocalizedInfo(card.frontInfo);
                const checked = selected.includes(card.objectId);
                return (
                  <article
                    key={card.objectId}
                    className="hextech-choice-card"
                    data-selected={checked}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy || (!checked && selected.length >= max)}
                        onChange={() =>
                          setSelected(
                            checked
                              ? selected.filter((id) => id !== card.objectId)
                              : [...selected, card.objectId]
                          )
                        }
                      />
                      <img src={imagePath(card.frontInfo.cardCode)} alt="" loading="lazy" />
                      <span>{info.title}</span>
                      <small>{card.zone}</small>
                    </label>
                    <button
                      className="button-ghost"
                      aria-expanded={showDetails === card.objectId}
                      onClick={() =>
                        setShowDetails(showDetails === card.objectId ? null : card.objectId)
                      }
                    >
                      查看详情
                    </button>
                    {showDetails === card.objectId && (
                      <p>
                        {card.frontInfo.cardCode}
                        <br />
                        {formatFrontMetrics(card.frontInfo)}
                        <br />
                        {info.effectCn || info.effectJp || '无效果'}
                      </p>
                    )}
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
