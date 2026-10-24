import { useTextPresentation } from '@/lib/appPresentation';
import { getExcelCardSummary } from '@/lib/excelCardView';
/**
 * 换牌面板 (Mulligan Panel)
 * 游戏开始时，玩家可选择要换的牌
 * 选中的牌先暂时放在一旁，抽取相同数量后再放回主卡组并洗牌
 */

import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { GameCommandType } from '@game/application/game-commands';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { GamePhase, SubPhase } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import { Card } from '@/components/card/Card';
import { ActionButton, Disclosure } from '@/components/common';
import { CardDetailContent } from './CardDetailOverlay';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import './mulligan-panel.css';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { BATTLE_UI_ANCHORS } from '@/lib/battleUiAnchors';
import {
  canConfirmTutorialMulliganSelection,
  normalizeTutorialMulliganSelection,
} from '@/lib/tutorialBattleUi';
import {
  hasBattleViewportSignatureChanged,
  readBattleViewportSignature,
  subscribeToBattleViewportChanges,
  type BattleViewportSignature,
} from '@/lib/battleViewport';
import type { AnyCardData } from '@game/domain/entities/card';
import type { ViewZoneKey } from '@game/online';

interface MulliganPanelProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 教学等受控流程可限制可选牌，但仍保留玩家点击正式确认。 */
  selectableCardIds?: readonly string[] | null;
  /** 只报告面板本地选择，用于引导表现；规则完成仍以正式命令为准。 */
  onSelectionChange?: (selectedCardIds: readonly string[]) => void;
}

const EMPTY_PUBLIC_OBJECT_IDS: readonly string[] = [];
const LONG_PRESS_DETAIL_MS = 420;
const getPhaseControls = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-battle-phase-access]'));

export const MulliganPanel = memo(function MulliganPanel({
  isOpen,
  selectableCardIds = null,
  onSelectionChange,
}: MulliganPanelProps) {
  const textOnly = useTextPresentation();
  // 状态选择器
  const currentPhase = useGameStore((s) => s.getCurrentPhaseView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView());
  const viewerSeat = useGameStore((s) => s.getViewerSeat());
  const canMulligan = useGameStore((s) => s.canUseAction(GameCommandType.MULLIGAN));
  const currentPlayerIdentity = useGameStore((s) => s.getViewingPlayerIdentity());
  const shouldUseTapDetail = useMediaQuery('(max-width: 1023px)');
  const handObjectIds = useGameStore((s) =>
    viewerSeat
      ? s.getZonePublicObjectIds(`${viewerSeat}_HAND` as ViewZoneKey)
      : EMPTY_PUBLIC_OBJECT_IDS
  );
  const hasViewerCompletedMulligan = useGameStore((s) => s.hasViewerCompletedMulligan());

  const handCardIds = useMemo(() => {
    return handObjectIds.map((publicObjectId) =>
      publicObjectId.startsWith('obj_') ? publicObjectId.slice(4) : publicObjectId
    );
  }, [handObjectIds]);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { mulligan, getVisibleCardPresentation, setHoveredCard } = useGameStore(
    useShallow((s) => ({
      mulligan: s.mulligan,
      getVisibleCardPresentation: s.getVisibleCardPresentation,
      setHoveredCard: s.setHoveredCard,
    }))
  );

  const isMyMulliganTurn = useMemo(() => {
    return (
      (currentSubPhase === SubPhase.MULLIGAN_FIRST_PLAYER ||
        currentSubPhase === SubPhase.MULLIGAN_SECOND_PLAYER) &&
      canMulligan
    );
  }, [canMulligan, currentSubPhase]);

  // 选中要换的卡牌 ID
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const selectableCardIdSet = useMemo(
    () => (selectableCardIds === null ? null : new Set(selectableCardIds)),
    [selectableCardIds]
  );
  const canConfirmSelection =
    isMyMulliganTurn &&
    canConfirmTutorialMulliganSelection(Array.from(selectedCardIds), selectableCardIds);
  const isGuidedPreview = selectableCardIds !== null && selectableCardIds.length === 0;
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressViewportStartRef = useRef<BattleViewportSignature | null>(null);
  const longPressViewportInvalidatedRef = useRef(false);
  const longPressTriggeredRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    setSelectedCardIds((current) => {
      const normalized = normalizeTutorialMulliganSelection(
        Array.from(current),
        selectableCardIds
      ).filter((id) => handCardIds.includes(id));
      if (normalized.length === current.size && normalized.every((cardId) => current.has(cardId))) {
        return current;
      }
      return new Set(normalized);
    });
  }, [selectableCardIds, handCardIds]);

  useEffect(() => {
    onSelectionChange?.(
      normalizeTutorialMulliganSelection(Array.from(selectedCardIds), selectableCardIds)
    );
  }, [onSelectionChange, selectableCardIds, selectedCardIds]);

  useEffect(
    () => () => {
      onSelectionChange?.([]);
    },
    [onSelectionChange]
  );

  const activateCard = useCallback(
    (cardId: string) => {
      if (!isMyMulliganTurn) return;
      setSelectedCardIds((current) => {
        if (current.has(cardId)) {
          const next = new Set(current);
          next.delete(cardId);
          return next;
        }
        if (selectableCardIdSet && !selectableCardIdSet.has(cardId)) return current;
        const next = new Set(current);
        next.add(cardId);
        return next;
      });
    },
    [isMyMulliganTurn, selectableCardIdSet]
  );

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const cancelLongPressForViewportChange = useCallback(() => {
    const startSignature = longPressViewportStartRef.current;
    if (!startSignature) {
      return;
    }

    if (!hasBattleViewportSignatureChanged(startSignature, readBattleViewportSignature())) {
      return;
    }

    clearLongPressTimer();
    longPressViewportStartRef.current = null;
    longPressViewportInvalidatedRef.current = true;
    longPressTriggeredRef.current = false;
    suppressNextClickRef.current = true;
  }, [clearLongPressTimer]);

  useEffect(
    () => subscribeToBattleViewportChanges(cancelLongPressForViewportChange),
    [cancelLongPressForViewportChange]
  );

  useEffect(
    () => () => {
      clearLongPressTimer();
      longPressViewportStartRef.current = null;
    },
    [clearLongPressTimer]
  );

  const startLongPressDetail = useCallback(
    (cardId: string) => {
      if (!shouldUseTapDetail) {
        return;
      }

      clearLongPressTimer();
      longPressViewportStartRef.current = readBattleViewportSignature();
      longPressViewportInvalidatedRef.current = false;
      longPressTriggeredRef.current = false;
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        setHoveredCard(cardId);
      }, LONG_PRESS_DETAIL_MS);
    },
    [clearLongPressTimer, setHoveredCard, shouldUseTapDetail]
  );

  const finishCardPress = useCallback(
    (cardId: string) => {
      clearLongPressTimer();
      longPressViewportStartRef.current = null;
      if (longPressViewportInvalidatedRef.current) {
        longPressViewportInvalidatedRef.current = false;
        longPressTriggeredRef.current = false;
        return;
      }
      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }
      activateCard(cardId);
    },
    [activateCard, clearLongPressTimer]
  );

  // 确认换牌
  const handleConfirm = useCallback(() => {
    if (!canConfirmSelection) return;
    const cardIds = Array.from(selectedCardIds);
    const result = mulligan(cardIds);
    if (result.success) setSelectedCardIds(new Set());
  }, [canConfirmSelection, mulligan, selectedCardIds]);

  // 不换牌（直接确认）
  const handleSkip = useCallback(() => {
    const result = mulligan([]);
    if (result.success) setSelectedCardIds(new Set());
  }, [mulligan]);

  // 判断是否应该显示面板
  const shouldShow = useMemo(() => {
    if (!isOpen || !currentPhase) return false;
    if (currentPhase !== GamePhase.MULLIGAN_PHASE) return false;
    if (hasViewerCompletedMulligan) return false;
    return true;
  }, [currentPhase, hasViewerCompletedMulligan, isOpen]);

  useDialogAccessibility({
    isOpen: shouldShow && !textOnly,
    dialogRef,
    initialFocusRef: dialogRef,
    closeOnEscape: false,
    additionalFocusRoots: getPhaseControls,
  });
  const previewCard =
    !shouldUseTapDetail && previewCardId && handCardIds.includes(previewCardId)
      ? getVisibleCardPresentation(previewCardId)
      : null;

  if (!shouldShow || !currentPlayerIdentity || !viewerSeat) return null;

  // 获取玩家名称用于显示
  const playerName = currentPlayerIdentity.name;
  const isFirstPlayer = viewerSeat === 'FIRST';

  if (textOnly)
    return (
      <section data-battle-ui-anchor={BATTLE_UI_ANCHORS.MULLIGAN_PANEL} className="excel-mulligan">
        <h3>
          换牌阶段 · {playerName}（{isFirstPlayer ? '先攻' : '后攻'}）
        </h3>
        <p>{isMyMulliganTurn ? '选择要换掉的手牌，或保留全部手牌。' : '等待对手换牌'}</p>
        <div className="excel-mulligan-scroll">
          <table
            className="excel-table excel-candidate-table excel-mulligan-table"
            aria-label="换牌手牌"
          >
            <colgroup>
              <col className="excel-candidate-select" />
              <col className="excel-candidate-code" />
              <col />
              <col className="excel-candidate-type" />
              <col className="excel-candidate-value" />
              <col className="excel-candidate-inspect" />
            </colgroup>
            <thead>
              <tr>
                {['选择', '卡号', '名称', '类型', '费用/分数', '查看'].map((heading) => (
                  <th key={heading} scope="col">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {handCardIds.map((cardId, index) => {
                const object = useGameStore.getState().getCardViewObject(cardId);
                const front = object?.surface === 'FRONT' ? object.frontInfo : null;
                if (!front) return null;
                const summary = getExcelCardSummary(front);
                return (
                  <tr key={cardId} aria-selected={selectedCardIds.has(cardId)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`换掉第 ${index + 1} 张手牌 ${summary.name}`}
                        checked={selectedCardIds.has(cardId)}
                        disabled={
                          !isMyMulliganTurn ||
                          (!!selectableCardIdSet &&
                            !selectableCardIdSet.has(cardId) &&
                            !selectedCardIds.has(cardId))
                        }
                        onChange={() => activateCard(cardId)}
                      />
                    </td>
                    <td title={front.cardCode}>{front.cardCode}</td>
                    <td title={summary.name}>{summary.name}</td>
                    <td>{summary.type}</td>
                    <td title={summary.valueLabel}>{summary.value}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`查看第 ${index + 1} 张手牌 ${summary.name}`}
                        onClick={() => {
                          const store = useGameStore.getState();
                          store.setCardDetail(null);
                          store.selectCard(cardId);
                        }}
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>已选择 {selectedCardIds.size} 张</p>
        {!selectableCardIds && (
          <button disabled={!isMyMulliganTurn} onClick={handleSkip}>
            保留手牌
          </button>
        )}
        <button
          data-battle-ui-anchor={BATTLE_UI_ANCHORS.MULLIGAN_CONFIRM}
          disabled={!canConfirmSelection}
          onClick={handleConfirm}
        >
          换 {selectedCardIds.size} 张
        </button>
      </section>
    );

  return (
    <AnimatePresence>
      {shouldShow && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-backdrop z-[100]"
          />

          <div className="mulligan-layer">
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-labelledby="mulligan-title"
              tabIndex={-1}
              data-battle-ui-anchor={BATTLE_UI_ANCHORS.MULLIGAN_PANEL}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="mulligan-dialog"
            >
              <div className="mulligan-surface">
                <div className="mulligan-header">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0">
                        <h2 id="mulligan-title" className="mulligan-title">
                          换牌阶段
                        </h2>
                        <p className="mulligan-player">
                          {playerName} ({isFirstPlayer ? '先攻' : '后攻'})
                        </p>
                      </div>
                    </div>

                    <span className="mulligan-turn">
                      {isMyMulliganTurn ? '轮到你换牌' : '等待对手'}
                    </span>
                  </div>
                </div>

                {selectableCardIds && (
                  <div className="px-4 pt-3 text-sm text-[var(--text-secondary)] sm:px-6">
                    {isGuidedPreview ? '点击教程“下一步”开始选牌' : '选择高亮卡牌，再确认换牌'}
                  </div>
                )}

                <div className="mulligan-content cute-scrollbar">
                  <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-[var(--text-secondary)]">选择换掉的牌</p>
                      {!selectableCardIds && (
                        <Disclosure summary="换牌说明" variant="popover">
                          <p>先抽取等量手牌，再将换掉的牌放回卡组并洗牌。</p>
                          {shouldUseTapDetail && <p>长按卡牌查看详情。</p>}
                        </Disclosure>
                      )}
                    </div>

                    <div
                      data-battle-ui-anchor={BATTLE_UI_ANCHORS.MULLIGAN_CARDS}
                      className="mx-auto grid max-w-[720px] grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3"
                    >
                      {handCardIds.map((cardId) => {
                        const card = getVisibleCardPresentation(cardId);
                        if (!card) return null;

                        const isSelected = selectedCardIds.has(cardId);
                        const isSelectable =
                          isMyMulliganTurn &&
                          (isSelected ||
                            selectableCardIdSet === null ||
                            selectableCardIdSet.has(cardId));
                        const cardData = card.cardData;
                        const imagePath = card.imagePath;

                        return (
                          <button
                            key={cardId}
                            data-battle-ui-object-id={cardId}
                            type="button"
                            onPointerDown={(event) => {
                              suppressNextClickRef.current = false;
                              if (event.pointerType === 'touch' || event.pointerType === 'pen') {
                                startLongPressDetail(card.instanceId);
                              }
                            }}
                            onPointerUp={(event) => {
                              if (event.pointerType === 'touch' || event.pointerType === 'pen') {
                                cancelLongPressForViewportChange();
                                suppressNextClickRef.current = true;
                                finishCardPress(cardId);
                              }
                            }}
                            onPointerCancel={() => {
                              clearLongPressTimer();
                              longPressViewportStartRef.current = null;
                              longPressViewportInvalidatedRef.current = false;
                              longPressTriggeredRef.current = false;
                              suppressNextClickRef.current = true;
                            }}
                            onClick={(event) => {
                              if (event.detail === 0) {
                                activateCard(cardId);
                                return;
                              }
                              if (suppressNextClickRef.current) {
                                suppressNextClickRef.current = false;
                                return;
                              }
                              if (
                                'pointerType' in event.nativeEvent &&
                                (event.nativeEvent.pointerType === 'touch' ||
                                  event.nativeEvent.pointerType === 'pen')
                              ) {
                                return;
                              }
                              activateCard(cardId);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              if (shouldUseTapDetail) setHoveredCard(card.instanceId);
                              else setPreviewCardId(cardId);
                            }}
                            onFocus={() => {
                              if (!shouldUseTapDetail) setPreviewCardId(cardId);
                            }}
                            onMouseEnter={() => {
                              if (!shouldUseTapDetail) {
                                setPreviewCardId(cardId);
                              }
                            }}
                            aria-pressed={isSelected}
                            aria-disabled={!isSelectable}
                            className={cn(
                              'mulligan-card-choice',
                              isSelected && 'is-selected',
                              !isSelectable && 'is-unavailable'
                            )}
                          >
                            <div className="battle-card-face relative aspect-[5/7] w-full max-w-[94px] overflow-visible sm:max-w-[106px]">
                              <Card
                                cardData={cardData as AnyCardData}
                                instanceId={card.instanceId}
                                imagePath={imagePath}
                                size="responsive"
                                faceUp={true}
                                interactive={false}
                                showHover={false}
                                showInfoOverlay={false}
                              />

                              {isSelected && (
                                <motion.div
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  className="mulligan-selected-mark"
                                >
                                  <Check size={14} aria-hidden="true" />
                                </motion.div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {handCardIds.length === 0 && (
                      <div className="py-8 text-center text-[var(--text-muted)]">手牌为空</div>
                    )}
                  </div>
                </div>
                <div className="mulligan-footer">
                  <div className="mulligan-footer-row">
                    <p className="mulligan-count" role="status">
                      已选{' '}
                      <span className="font-semibold text-[var(--text-primary)]">
                        {selectedCardIds.size}
                      </span>{' '}
                      张
                    </p>
                    <div className="mulligan-actions">
                      {!selectableCardIds && (
                        <ActionButton
                          variant="ghost"
                          className={cn('mulligan-clear', selectedCardIds.size === 0 && 'is-empty')}
                          aria-label="清空选择"
                          onClick={() => {
                            setSelectedCardIds(new Set());
                            dialogRef.current?.focus({ preventScroll: true });
                          }}
                          disabled={!isMyMulliganTurn || selectedCardIds.size === 0}
                        >
                          清空
                        </ActionButton>
                      )}
                      <ActionButton
                        className="mulligan-confirm"
                        data-battle-ui-anchor={BATTLE_UI_ANCHORS.MULLIGAN_CONFIRM}
                        disabled={
                          selectedCardIds.size === 0 && !selectableCardIds
                            ? !isMyMulliganTurn
                            : !canConfirmSelection
                        }
                        onClick={
                          selectedCardIds.size === 0 && !selectableCardIds
                            ? handleSkip
                            : handleConfirm
                        }
                      >
                        {selectableCardIds
                          ? `换 ${selectedCardIds.size} 张`
                          : selectedCardIds.size === 0
                            ? '保留全部手牌'
                            : `更换 ${selectedCardIds.size} 张`}
                      </ActionButton>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
          {previewCard && (
            <aside data-battle-phase-access className="mulligan-detail-pane" aria-label="手牌详情">
              <div className="mb-2 flex shrink-0 justify-end">
                <ActionButton
                  variant="icon"
                  aria-label="关闭手牌详情"
                  onClick={() => {
                    setPreviewCardId(null);
                    dialogRef.current?.focus({ preventScroll: true });
                  }}
                >
                  <X size={16} aria-hidden="true" />
                </ActionButton>
              </div>
              <CardDetailContent card={previewCard} density="desktop" />
            </aside>
          )}
        </>
      )}
    </AnimatePresence>
  );
});

export default MulliganPanel;
