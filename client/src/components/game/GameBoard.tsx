/**
 * 游戏主界面布局
 */

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import { PlayerArea } from './PlayerArea';
import { GameLog, GameLogContent } from './GameLog';
import { PhaseIndicator } from './PhaseIndicator';
import { PhaseBanner } from './PhaseBanner';
import { LiveResultAnimation, type LiveScoreInfo } from './LiveResultAnimation';
import { DebugControl } from './DebugControl';
import { CardDetailOverlay } from './CardDetailOverlay';
import { JudgmentPanel } from './JudgmentPanel';
import { ScoreConfirmModal } from './ScoreConfirmModal';
import { Card } from '@/components/card/Card';
import { MulliganPanel } from './MulliganPanel';
import { ThemeToggle } from '@/components/common';
import { getDeckBackUrl } from '@/lib/imageService';
import { parseZoneId } from '@/lib/zoneUtils';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isOwnDeskFreeDragWindow } from '@game/application/command-availability';
import { ChevronRight, DoorOpen, ScrollText, Swords, UserRound, X } from 'lucide-react';
import {
  SlotPosition,
  GamePhase,
  SubPhase,
  ZoneType,
  CardType,
  GameMode,
} from '@game/shared/types/enums';
import { getPhaseConfig, getSubPhaseConfig } from '@game/shared/phase-config';
import type { AnyCardData } from '@game/domain/entities/card';
import type { Seat } from '@game/online';

const INSPECTION_TARGET_PREFIX = 'inspection-target-';
const RESOLUTION_TARGET_PREFIX = 'resolution-target-';

type SpecialDragTarget =
  | { kind: 'inspection'; action: 'HAND' | 'WAITING_ROOM' | 'MAIN_DECK_TOP' | 'MAIN_DECK_BOTTOM' }
  | { kind: 'resolution'; action: 'HAND' | 'WAITING_ROOM' | 'MAIN_DECK_TOP' };

type MobileBattlePanel = 'opponent' | 'log';

const inspectionFirstCollisionDetection: CollisionDetection = (args) => {
  const dragData = args.active.data.current as { fromZone?: ZoneType } | undefined;
  const shouldPrioritizeInspection =
    dragData?.fromZone === ZoneType.HAND || dragData?.fromZone === ZoneType.WAITING_ROOM;

  if (shouldPrioritizeInspection) {
    const pointerCollisions = pointerWithin(args);
    const inspectionCollision = pointerCollisions.find((collision) => {
      const targetId = String(collision.id);
      return parseZoneId(targetId)?.zoneType === ZoneType.INSPECTION_ZONE;
    });

    if (inspectionCollision) {
      return [inspectionCollision];
    }
  }

  return rectIntersection(args);
};

interface GameBoardProps {
  onLeaveLocalGame?: () => void;
}

export const GameBoard = memo(function GameBoard({ onLeaveLocalGame }: GameBoardProps) {
  // 配置拖拽传感器：需要移动 5px 才开始拖拽，避免与双击冲突
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // 状态选择器
  const matchView = useGameStore((s) => s.getMatchView());
  const currentTurnCount = useGameStore((s) => s.getTurnCountView());
  const currentPhase = useGameStore((s) => s.getCurrentPhaseView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView()) ?? SubPhase.NONE;
  const activeSeat = useGameStore((s) => s.getActiveSeatView());
  const viewerSeat = useGameStore((s) => s.getViewerSeat());
  const viewerLiveScore = useGameStore((s) => s.getViewerLiveScore());
  const opponentLiveScore = useGameStore((s) => s.getOpponentLiveScore());
  const viewerLiveWinner = useGameStore((s) => s.isViewerLiveWinner());
  const opponentLiveWinner = useGameStore((s) => s.isOpponentLiveWinner());
  const isLiveDraw = useGameStore((s) => s.isLiveDraw);
  const gameMode = useGameStore((s) => s.gameMode);
  const isDebugMode = gameMode === GameMode.DEBUG;
  const getPlayerIdentityForSeat = useGameStore((s) => s.getPlayerIdentityForSeat);
  const logCount = useGameStore((s) => s.ui.logs.length);
  const isMobileBattlefield = useMediaQuery('(max-width: 767px)');
  const prevPhaseRef = useRef<GamePhase | null>(null);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const {
    setLiveCard,
    addLog,
    playMemberToSlot,
    moveTableCard,
    moveMemberToSlot,
    attachEnergyToMember,
    confirmSubPhase,
    selectSuccessCard,
    movePublicCardToWaitingRoom,
    movePublicCardToHand,
    movePublicCardToEnergyDeck,
    moveOwnedCardToZone,
    moveInspectedCardToTop,
    moveInspectedCardToBottom,
    moveInspectedCardToZone,
    moveCardToInspection,
    reorderInspectedCard,
    moveResolutionCardToZone,
    drawEnergyToZone,
    setDragHints,
    getZoneCardIds,
    findViewerCardZone,
    resolveCardDropTarget,
    getCardSlotPosition,
  } = useGameStore(
    useShallow((s) => ({
      setLiveCard: s.setLiveCard,
      addLog: s.addLog,
      playMemberToSlot: s.playMemberToSlot,
      moveTableCard: s.moveTableCard,
      moveMemberToSlot: s.moveMemberToSlot,
      attachEnergyToMember: s.attachEnergyToMember,
      confirmSubPhase: s.confirmSubPhase,
      selectSuccessCard: s.selectSuccessCard,
      movePublicCardToWaitingRoom: s.movePublicCardToWaitingRoom,
      movePublicCardToHand: s.movePublicCardToHand,
      movePublicCardToEnergyDeck: s.movePublicCardToEnergyDeck,
      moveOwnedCardToZone: s.moveOwnedCardToZone,
      moveInspectedCardToTop: s.moveInspectedCardToTop,
      moveInspectedCardToBottom: s.moveInspectedCardToBottom,
      moveInspectedCardToZone: s.moveInspectedCardToZone,
      moveCardToInspection: s.moveCardToInspection,
      reorderInspectedCard: s.reorderInspectedCard,
      moveResolutionCardToZone: s.moveResolutionCardToZone,
      drawEnergyToZone: s.drawEnergyToZone,
      setDragHints: s.setDragHints,
      getZoneCardIds: s.getZoneCardIds,
      findViewerCardZone: s.findViewerCardZone,
      resolveCardDropTarget: s.resolveCardDropTarget,
      getCardSlotPosition: s.getCardSlotPosition,
    }))
  );

  // 卡牌辅助方法（使用 useShallow 保持引用稳定）
  const { getVisibleCardPresentation, getKnownCardType } = useGameStore(
    useShallow((s) => ({
      getVisibleCardPresentation: s.getVisibleCardPresentation,
      getKnownCardType: s.getKnownCardType,
    }))
  );

  // 拖拽状态
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobileBattlePanel | null>(null);

  const mulliganPanelOpen = currentPhase === GamePhase.MULLIGAN_PHASE;
  const isJudgmentPanelRelevant =
    (currentPhase === GamePhase.PERFORMANCE_PHASE &&
      (currentSubPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS ||
        currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT)) ||
    (currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      (currentSubPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS ||
        currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS));

  // 左侧判定区抽屉开关（表演判定与成功效果窗口中可唤出）
  const [judgmentPanelOpen, setJudgmentPanelOpen] = useState(false);

  // 弹窗回调
  const handleJudgmentPanelClose = useCallback(() => {
    setJudgmentPanelOpen(false);
  }, []);

  // 打开判定面板（由 PhaseIndicator 的判定按钮调用）
  const handleOpenJudgmentPanel = useCallback(() => {
    setJudgmentPanelOpen(true);
  }, []);

  useEffect(() => {
    if (currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT) {
      const timer = window.setTimeout(() => setJudgmentPanelOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, [currentSubPhase]);

  useEffect(() => {
    if (!isJudgmentPanelRelevant && judgmentPanelOpen) {
      const timer = window.setTimeout(() => setJudgmentPanelOpen(false), 0);
      return () => window.clearTimeout(timer);
    }
  }, [isJudgmentPanelRelevant, judgmentPanelOpen]);

  useEffect(() => {
    if (!isMobileBattlefield && mobilePanel) {
      const timer = window.setTimeout(() => setMobilePanel(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [isMobileBattlefield, mobilePanel]);

  useEffect(() => {
    if (!isDebugMode && mobilePanel === 'log') {
      const timer = window.setTimeout(() => setMobilePanel(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [isDebugMode, mobilePanel]);

  useEffect(() => {
    if (!isMobileBattlefield || !mobilePanel) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileBattlefield, mobilePanel]);

  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    if (currentPhase === GamePhase.PERFORMANCE_PHASE && prevPhase !== GamePhase.PERFORMANCE_PHASE) {
      addLog('🎤 Live 表演开始!', 'phase');
    }
    prevPhaseRef.current = currentPhase;
  }, [currentPhase, addLog]);

  const isViewerWinnerInCurrentLive = viewerLiveWinner;
  const isResultAnimationWindow = matchView?.window?.windowType === 'RESULT_ANIMATION';
  const shouldShowWinnerAnimation = isResultAnimationWindow && isViewerWinnerInCurrentLive;

  const handleLiveAnimationComplete = useCallback(() => {
    if (currentSubPhase !== SubPhase.RESULT_ANIMATION) {
      return;
    }
    confirmSubPhase(SubPhase.RESULT_ANIMATION);
  }, [confirmSubPhase, currentSubPhase]);

  // 拖拽开始处理
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const cardId = event.active.id as string;
      setActiveCardId(cardId);

      // 计算"推荐目标"高亮（只提示，不限制放置）
      const dragData = event.active.data.current as { fromZone?: ZoneType } | undefined;
      const fromZone = dragData?.fromZone;

      const suggested: string[] = [];
      // Live 设置：推荐手牌 -> Live 区
      if (
        currentPhase === GamePhase.LIVE_SET_PHASE &&
        (currentSubPhase === SubPhase.LIVE_SET_FIRST_PLAYER ||
          currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER) &&
        fromZone === ZoneType.HAND
      ) {
        suggested.push('live-zone');
      }
      if (
        currentPhase !== GamePhase.LIVE_SET_PHASE &&
        currentPhase !== null &&
        isOwnDeskFreeDragWindow(currentPhase, currentSubPhase) &&
        fromZone === ZoneType.HAND &&
        getKnownCardType(cardId) === CardType.LIVE
      ) {
        suggested.push('live-zone');
      }
      // 结算：推荐 Live 区 -> 成功区 / 休息室
      if (
        currentPhase === GamePhase.LIVE_RESULT_PHASE &&
        currentSubPhase === SubPhase.RESULT_SETTLEMENT
      ) {
        if (fromZone === ZoneType.LIVE_ZONE) {
          suggested.push('success-zone');
        }
      }
      if (
        matchView?.window?.windowType === 'INSPECTION' &&
        (fromZone === ZoneType.HAND || fromZone === ZoneType.WAITING_ROOM)
      ) {
        suggested.push('inspection-zone');
      }

      setDragHints(true, suggested);
    },
    [currentPhase, currentSubPhase, matchView?.window?.windowType, setDragHints, getKnownCardType]
  );

  // 拖拽结束处理 - 统一处理所有区域间的拖拽
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveCardId(null);
      setDragHints(false);

      if (!over) return;

      const cardId = active.id as string;
      const targetId = over.id as string;

      // 获取拖拽数据中的来源区域信息
      const dragData = active.data.current as
        | {
            cardId: string;
            cardCode?: string;
            fromZone?: ZoneType;
          }
        | undefined;

      const specialTarget = resolveSpecialDragTarget(targetId);

      // 解析目标区域
      const parsedTarget =
        (!specialTarget ? parseZoneId(targetId) : null) ?? resolveCardDropTarget(targetId);
      if (!parsedTarget && !specialTarget) {
        // 无法识别的目标区域
        return;
      }

      // 获取来源区域（优先从拖拽数据获取，否则查找）
      const fromZone = dragData?.fromZone || findViewerCardZone(cardId);
      if (!fromZone) {
        addLog('无法确定卡牌来源区域', 'error');
        return;
      }

      if (
        parsedTarget?.zoneType === ZoneType.INSPECTION_ZONE &&
        (fromZone === ZoneType.HAND || fromZone === ZoneType.WAITING_ROOM)
      ) {
        const result = moveCardToInspection(cardId, fromZone);
        if (result.success) {
          addLog('卡牌移入检视区', 'action');
        }
        return;
      }

      if (fromZone === ZoneType.INSPECTION_ZONE) {
        if (specialTarget?.kind === 'inspection') {
          const result =
            specialTarget.action === 'HAND'
              ? moveInspectedCardToZone(cardId, ZoneType.HAND)
              : specialTarget.action === 'WAITING_ROOM'
                ? moveInspectedCardToZone(cardId, ZoneType.WAITING_ROOM)
                : specialTarget.action === 'MAIN_DECK_BOTTOM'
                  ? moveInspectedCardToBottom(cardId)
                  : moveInspectedCardToTop(cardId);
          if (result.success) {
            addLog(`检视区拖拽完成: ${specialTarget.action}`, 'action');
          }
          return;
        }

        if (parsedTarget?.zoneType === ZoneType.INSPECTION_ZONE) {
          const inspectionCardIds = viewerSeat
            ? getZoneCardIds(`${viewerSeat}_INSPECTION_ZONE`)
            : [];
          const targetIndex = inspectionCardIds.indexOf(targetId);
          if (targetIndex >= 0) {
            const result = reorderInspectedCard(cardId, targetIndex);
            if (result.success) {
              addLog(`调整检视顺序到位置 ${targetIndex + 1}`, 'action');
            }
          }
          return;
        }

        if (parsedTarget?.zoneType === ZoneType.HAND) {
          const result = moveInspectedCardToZone(cardId, ZoneType.HAND);
          if (result.success) {
            addLog('检视牌拖入手牌', 'action');
          }
          return;
        }

        if (parsedTarget?.zoneType === ZoneType.WAITING_ROOM) {
          const result = moveInspectedCardToZone(cardId, ZoneType.WAITING_ROOM);
          if (result.success) {
            addLog('检视牌拖入休息室', 'action');
          }
          return;
        }

        if (parsedTarget?.zoneType === ZoneType.MAIN_DECK) {
          const result = moveInspectedCardToTop(cardId);
          if (result.success) {
            addLog('检视牌拖回主卡组顶', 'action');
          }
          return;
        }
      }

      if (fromZone === ZoneType.RESOLUTION_ZONE) {
        const toZone =
          specialTarget?.kind === 'resolution'
            ? specialTarget.action === 'HAND'
              ? ZoneType.HAND
              : specialTarget.action === 'WAITING_ROOM'
                ? ZoneType.WAITING_ROOM
                : ZoneType.MAIN_DECK
            : parsedTarget?.zoneType;

        if (
          toZone === ZoneType.HAND ||
          toZone === ZoneType.WAITING_ROOM ||
          toZone === ZoneType.MAIN_DECK
        ) {
          const result = moveResolutionCardToZone(cardId, toZone, {
            position: toZone === ZoneType.MAIN_DECK ? 'TOP' : undefined,
          });
          if (result.success) {
            addLog(`解决区拖拽完成: ${toZone}`, 'action');
          }
        }
        return;
      }

      if (!parsedTarget) {
        return;
      }

      const { zoneType: toZone, slotPosition: targetSlot } = parsedTarget;

      const cardType = getKnownCardType(cardId);
      const isLiveSetHandPlacement =
        currentPhase === GamePhase.LIVE_SET_PHASE &&
        fromZone === ZoneType.HAND &&
        toZone === ZoneType.LIVE_ZONE;

      // 能量牌移动限制（规则 4.5.5、10.5.4）
      if (cardType === CardType.ENERGY) {
        if (toZone === ZoneType.HAND) {
          addLog('能量牌不能移动到手牌', 'error');
          return;
        }
        if (toZone === ZoneType.LIVE_ZONE) {
          addLog('能量牌不能移动到LIVE区', 'error');
          return;
        }
        if (toZone === ZoneType.SUCCESS_ZONE) {
          addLog('能量牌不能移动到成功LIVE卡区', 'error');
          return;
        }
        if (toZone === ZoneType.WAITING_ROOM) {
          addLog('能量牌不能移动到休息室（请移动到能量卡组）', 'error');
          return;
        }
      }

      // LIVE卡移动限制：不能放入成员区和能量区和能量卡组
      if (cardType === CardType.LIVE) {
        if (toZone === ZoneType.MEMBER_SLOT) {
          addLog('LIVE卡不能放入成员区', 'error');
          return;
        }
        if (toZone === ZoneType.ENERGY_ZONE) {
          addLog('LIVE卡不能放入能量区', 'error');
          return;
        }
        if (toZone === ZoneType.ENERGY_DECK) {
          addLog('LIVE卡不能放入能量卡组', 'error');
          return;
        }
      }

      if (toZone === ZoneType.SUCCESS_ZONE && cardType !== CardType.LIVE) {
        addLog('只有 LIVE 卡可以放入成功 Live 卡区', 'error');
        return;
      }

      if (toZone === ZoneType.LIVE_ZONE && cardType !== CardType.LIVE && !isLiveSetHandPlacement) {
        addLog('只有 LIVE 卡可以自由拖入 Live 区', 'error');
        return;
      }

      // 成员卡移动限制：不能放入能量区和能量卡组
      if (cardType === CardType.MEMBER) {
        if (
          currentPhase === GamePhase.MAIN_PHASE &&
          fromZone === ZoneType.HAND &&
          toZone === ZoneType.LIVE_ZONE
        ) {
          addLog('主要阶段不能把成员卡从手牌拖到 Live 区', 'error');
          return;
        }
        if (toZone === ZoneType.ENERGY_ZONE) {
          addLog('成员卡不能放入能量区', 'error');
          return;
        }
        if (toZone === ZoneType.ENERGY_DECK) {
          addLog('成员卡不能放入能量卡组', 'error');
          return;
        }
      }

      // Live 设置阶段：拖到 Live 区的一律视为"里侧放置"（规则 8.2），且可作为 Live 卡放置（不限制卡牌类型）
      // 这里必须走专门命令，确保 liveZone.cardStates 的 face 被正确设置为 FACE_DOWN。
      if (isLiveSetHandPlacement) {
        const result = setLiveCard(cardId, true);
        if (result.success) {
          addLog('放置 Live 卡: 手牌 → Live 区（里侧）', 'action');
        }
        return;
      }

      if (
        cardType === CardType.MEMBER &&
        fromZone === ZoneType.HAND &&
        toZone === ZoneType.MEMBER_SLOT &&
        targetSlot
      ) {
        const result = playMemberToSlot(cardId, targetSlot);
        if (result.success) {
          addLog(`成员登场: 手牌 → ${targetSlot}`, 'action');
        }
        return;
      }

      if (fromZone === ZoneType.LIVE_ZONE && toZone === ZoneType.SUCCESS_ZONE) {
        const result =
          currentSubPhase === SubPhase.RESULT_SETTLEMENT
            ? selectSuccessCard(cardId)
            : moveTableCard(cardId, fromZone, toZone);
        if (result.success) {
          addLog('选择成功 Live 卡进入成功区', 'action');
        }
        return;
      }

      // 如果来源和目标相同，不执行移动
      if (fromZone === toZone) {
        // 特殊情况：成员槽位之间的移动需要检查具体槽位
        if (toZone === ZoneType.MEMBER_SLOT) {
          if (getCardSlotPosition(cardId) === targetSlot) {
            return;
          }
        } else {
          return; // 同一区域，不移动
        }
      }

      // 生成日志消息
      const zoneNames: Record<ZoneType, string> = {
        [ZoneType.HAND]: '手牌',
        [ZoneType.MAIN_DECK]: '主卡组',
        [ZoneType.ENERGY_DECK]: '能量卡组',
        [ZoneType.MEMBER_SLOT]: '成员区',
        [ZoneType.ENERGY_ZONE]: '能量区',
        [ZoneType.LIVE_ZONE]: 'Live 区',
        [ZoneType.SUCCESS_ZONE]: '成功区',
        [ZoneType.WAITING_ROOM]: '休息室',
        [ZoneType.EXILE_ZONE]: '除外区',
        [ZoneType.RESOLUTION_ZONE]: '解决区',
        [ZoneType.INSPECTION_ZONE]: '检视区',
      };

      // 找出来源槽位（当从成员区移动时，用于携带 energyBelow，规则 4.5.5.3）
      let sourceSlot: SlotPosition | undefined;
      if (fromZone === ZoneType.MEMBER_SLOT) {
        sourceSlot = getCardSlotPosition(cardId) ?? undefined;
      }

      if (cardType === CardType.ENERGY && toZone === ZoneType.MEMBER_SLOT && targetSlot) {
        const result = attachEnergyToMember(
          cardId,
          fromZone as ZoneType.MEMBER_SLOT | ZoneType.ENERGY_ZONE | ZoneType.ENERGY_DECK,
          targetSlot,
          sourceSlot
        );
        if (result.success) {
          addLog(`附着能量到成员槽位: ${targetSlot}`, 'action');
        }
        return;
      }

      if (
        fromZone === ZoneType.MEMBER_SLOT &&
        toZone === ZoneType.MEMBER_SLOT &&
        sourceSlot &&
        targetSlot
      ) {
        const result = moveMemberToSlot(cardId, sourceSlot, targetSlot);
        if (result.success) {
          addLog(`成员换位: ${sourceSlot} → ${targetSlot}`, 'action');
        }
        return;
      }

      if (
        fromZone === ZoneType.ENERGY_DECK &&
        toZone === ZoneType.ENERGY_ZONE &&
        viewerSeat &&
        getZoneCardIds(`${viewerSeat}_ENERGY_DECK`)[0] === cardId
      ) {
        const result = drawEnergyToZone(cardId);
        if (result.success) {
          addLog('放置能量: 能量卡组顶 → 能量区', 'action');
        }
        return;
      }

      if (
        fromZone === ZoneType.HAND ||
        fromZone === ZoneType.MAIN_DECK ||
        fromZone === ZoneType.ENERGY_DECK
      ) {
        if (
          toZone !== ZoneType.HAND &&
          toZone !== ZoneType.MAIN_DECK &&
          toZone !== ZoneType.ENERGY_DECK &&
          toZone !== ZoneType.MEMBER_SLOT &&
          toZone !== ZoneType.ENERGY_ZONE &&
          toZone !== ZoneType.LIVE_ZONE &&
          toZone !== ZoneType.SUCCESS_ZONE &&
          toZone !== ZoneType.WAITING_ROOM &&
          toZone !== ZoneType.EXILE_ZONE
        ) {
          addLog('当前落点不支持己方私有区拖拽', 'error');
          return;
        }

        const result = moveOwnedCardToZone(cardId, fromZone, toZone, {
          targetSlot,
          position:
            toZone === ZoneType.MAIN_DECK || toZone === ZoneType.ENERGY_DECK ? 'TOP' : undefined,
        });
        if (result.success) {
          addLog(
            fromZone === ZoneType.HAND && toZone === ZoneType.LIVE_ZONE
              ? '自由放置 Live 卡: 手牌 → Live 区（正面）'
              : `己方卡牌移动: ${fromZone} → ${toZone}`,
            'action'
          );
        }
        return;
      }

      if (
        toZone === ZoneType.HAND &&
        (fromZone === ZoneType.MEMBER_SLOT ||
          fromZone === ZoneType.LIVE_ZONE ||
          fromZone === ZoneType.SUCCESS_ZONE ||
          fromZone === ZoneType.WAITING_ROOM)
      ) {
        const result = movePublicCardToHand(
          cardId,
          fromZone,
          fromZone === ZoneType.MEMBER_SLOT ? sourceSlot : undefined
        );
        if (result.success) {
          addLog(`公开区卡牌回手: ${fromZone}`, 'action');
        }
        return;
      }

      if (fromZone === ZoneType.ENERGY_ZONE && toZone === ZoneType.ENERGY_DECK) {
        const result = movePublicCardToEnergyDeck(cardId, ZoneType.ENERGY_ZONE);
        if (result.success) {
          addLog('公开能量回到能量卡组: ENERGY_ZONE → ENERGY_DECK', 'action');
        }
        return;
      }

      if (
        toZone === ZoneType.WAITING_ROOM &&
        (fromZone === ZoneType.MEMBER_SLOT ||
          fromZone === ZoneType.LIVE_ZONE ||
          fromZone === ZoneType.SUCCESS_ZONE)
      ) {
        const result = movePublicCardToWaitingRoom(
          cardId,
          fromZone,
          fromZone === ZoneType.MEMBER_SLOT ? sourceSlot : undefined
        );
        if (result.success) {
          addLog(`公开区卡牌进入休息室: ${fromZone}`, 'action');
        }
        return;
      }

      // 休息室成员卡拖到成员槽位：由后端 handleManualMoveCard 检测特殊成员堆叠
      if (
        fromZone === ZoneType.WAITING_ROOM &&
        toZone === ZoneType.MEMBER_SLOT &&
        targetSlot &&
        cardType === CardType.MEMBER
      ) {
        const result = moveTableCard(cardId, fromZone, toZone, {
          targetSlot,
          sourceSlot,
        });
        if (result.success) {
          addLog(`休息室成员卡移动: ${fromZone} → ${toZone}`, 'action');
        }
        return;
      }

      // 执行移动
      const result = moveTableCard(cardId, fromZone, toZone, {
        targetSlot,
        sourceSlot,
        position: 'TOP', // 默认放到顶部（卡组时）
      });

      if (result.success) {
        const fromName = zoneNames[fromZone] || fromZone;
        const toName = zoneNames[toZone] || toZone;
        addLog(`移动卡牌: ${fromName} → ${toName}`, 'action');
      }
    },
    [
      playMemberToSlot,
      moveTableCard,
      moveMemberToSlot,
      attachEnergyToMember,
      selectSuccessCard,
      movePublicCardToWaitingRoom,
      movePublicCardToHand,
      movePublicCardToEnergyDeck,
      moveOwnedCardToZone,
      moveInspectedCardToTop,
      moveInspectedCardToBottom,
      moveInspectedCardToZone,
      moveCardToInspection,
      reorderInspectedCard,
      moveResolutionCardToZone,
      drawEnergyToZone,
      setLiveCard,
      addLog,
      viewerSeat,
      setDragHints,
      getZoneCardIds,
      currentPhase,
      currentSubPhase,
      findViewerCardZone,
      getKnownCardType,
      resolveCardDropTarget,
      getCardSlotPosition,
    ]
  );

  // 获取当前拖拽中的卡牌实例
  const activeCard = activeCardId ? getVisibleCardPresentation(activeCardId) : null;

  if (!matchView) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-slate-400">游戏未开始</div>
      </div>
    );
  }

  if (!viewerSeat || !currentPhase) {
    return null;
  }

  const selfSeat: Seat = viewerSeat;
  const opponentSeat: Seat = selfSeat === 'FIRST' ? 'SECOND' : 'FIRST';
  const resolvedActiveSeat = activeSeat ?? selfSeat;
  const isSolitaire = gameMode === GameMode.SOLITAIRE;
  const showLeaveLocalGameButton = isSolitaire && Boolean(onLeaveLocalGame);
  const selfIdentity = getPlayerIdentityForSeat(selfSeat);
  const opponentIdentity = getPlayerIdentityForSeat(opponentSeat);
  const phaseInfo = getPhaseConfig(currentPhase)?.display;
  const subPhaseInfo =
    currentSubPhase !== SubPhase.NONE ? getSubPhaseConfig(currentSubPhase)?.display : null;
  const turnNumber = currentTurnCount ?? matchView.turnCount;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={inspectionFirstCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveCardId(null);
        setDragHints(false);
      }}
    >
      <div
        className="h-full flex flex-col relative overflow-hidden"
        style={{
          backgroundImage: `url(${getDeckBackUrl()})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[color:color-mix(in_srgb,var(--board-overlay)_42%,transparent)] md:bg-[var(--board-overlay)]" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--gradient-spotlight)' }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--gradient-stage-glow)' }}
        />

        {isMobileBattlefield ? (
          <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden md:hidden">
            <div className="safe-top shrink-0 px-3 pt-3">
              <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--border-default)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_26%,transparent)] px-3 py-2 shadow-none backdrop-blur-[2px]">
                <div className="flex items-center justify-between gap-2">
                  {showLeaveLocalGameButton ? (
                    <button
                      type="button"
                      onClick={onLeaveLocalGame}
                      className="button-ghost inline-flex h-10 shrink-0 items-center justify-center gap-1.5 px-2.5 text-xs"
                      title="退出对墙打房间"
                    >
                      <DoorOpen size={15} />
                      离开
                    </button>
                  ) : (
                    <div className="h-10 w-10 shrink-0" />
                  )}

                  <div className="min-w-0 text-center">
                    <div className="truncate text-sm font-bold text-[var(--text-primary)]">
                      {phaseInfo?.name ?? currentPhase}阶段
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                      T{turnNumber}
                      {subPhaseInfo ? ` · ${subPhaseInfo.name}` : ''}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <ThemeToggle />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setMobilePanel('opponent')}
                className="mt-2 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-[color:color-mix(in_srgb,var(--border-default)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_18%,transparent)] px-3 py-2 text-left shadow-none backdrop-blur-[2px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border',
                      resolvedActiveSeat === opponentSeat
                        ? 'border-rose-300/50 bg-rose-500/20 text-rose-200'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                    )}
                  >
                    <UserRound size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                      {opponentIdentity?.name ?? '对手区域'}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--text-muted)]">
                      {isSolitaire ? '对墙打模式已弱化对手区' : '点按查看对手战场'}
                    </span>
                  </span>
                </span>
                <span className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                  Live {opponentLiveScore}
                </span>
              </button>
            </div>

            <div className="min-h-0 flex-1 px-2 pb-32 pt-2">
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--border-default)_34%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_10%,transparent)] shadow-none">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:color-mix(in_srgb,var(--border-subtle)_60%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_14%,transparent)] px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {selfIdentity?.name ?? '己方主战场'}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">主战场</div>
                  </div>
                  <div className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                    Live {viewerLiveScore}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <PlayerArea
                    playerSeat={selfSeat}
                    isOpponent={false}
                    isActive={resolvedActiveSeat === selfSeat}
                  />
                </div>
              </div>
            </div>

            <div
              className={cn(
                'safe-bottom fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[65] grid gap-2 md:hidden',
                isDebugMode ? 'grid-cols-3' : 'grid-cols-2'
              )}
            >
              <button
                type="button"
                onClick={() => setMobilePanel('opponent')}
                className="button-secondary inline-flex min-h-11 items-center justify-center gap-1.5 border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_24%,transparent)] px-2 py-2 text-xs shadow-none backdrop-blur-[2px]"
              >
                <Swords size={15} />
                对手
              </button>
              {isDebugMode && (
                <button
                  type="button"
                  onClick={() => setMobilePanel('log')}
                  className="button-secondary inline-flex min-h-11 items-center justify-center gap-1.5 border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_24%,transparent)] px-2 py-2 text-xs shadow-none backdrop-blur-[2px]"
                >
                  <ScrollText size={15} />
                  日志 {logCount}
                </button>
              )}
              <button
                type="button"
                onClick={handleOpenJudgmentPanel}
                disabled={!isJudgmentPanelRelevant}
                className={cn(
                  'button-secondary inline-flex min-h-11 items-center justify-center gap-1.5 border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_24%,transparent)] px-2 py-2 text-xs shadow-none backdrop-blur-[2px]',
                  !isJudgmentPanelRelevant && 'cursor-not-allowed opacity-50'
                )}
              >
                <ChevronRight size={15} />
                判定
              </button>
            </div>

            <AnimatePresence>
              {mobilePanel && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="modal-backdrop fixed inset-0 z-[85] md:hidden"
                    onClick={() => setMobilePanel(null)}
                  />
                  <motion.div
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'tween', duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                    className="safe-bottom fixed inset-x-0 bottom-0 z-[90] flex max-h-[82dvh] min-h-[52dvh] flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] md:hidden"
                  >
                    <div className="shrink-0 px-4 pb-2 pt-3">
                      <div className="mb-3 flex justify-center">
                        <div className="h-1.5 w-12 rounded-full bg-[var(--border-default)]" />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[var(--text-primary)]">
                            {mobilePanel === 'opponent' ? '对手战场' : '游戏日志'}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                            {mobilePanel === 'opponent'
                              ? opponentIdentity?.name ?? opponentSeat
                              : `${logCount} 条记录`}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMobilePanel(null)}
                          className="button-icon h-9 w-9 shrink-0"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>

                    {mobilePanel === 'opponent' ? (
                      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-3">
                        <div
                          className={cn(
                            'h-full overflow-hidden rounded-2xl border border-[var(--border-subtle)]',
                            isSolitaire && 'opacity-60'
                          )}
                        >
                          <PlayerArea
                            playerSeat={opponentSeat}
                            isOpponent={true}
                            isActive={resolvedActiveSeat === opponentSeat}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-3">
                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
                          <GameLogContent active={mobilePanel === 'log'} />
                        </div>
                      </div>
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <>
            <div className="absolute right-4 top-4 z-[80]">
              <ThemeToggle />
            </div>

            {showLeaveLocalGameButton && (
              <div className="absolute left-4 top-4 z-[120] flex items-center gap-3">
                <button
                  type="button"
                  onClick={onLeaveLocalGame}
                  className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-4 shadow-[var(--shadow-md)] backdrop-blur-xl"
                  title="退出对墙打房间"
                >
                  <DoorOpen size={16} />
                  离开房间
                </button>
              </div>
            )}

            {/* 对手区域 (顶部) - 包含成员槽位和对手 Live 区 */}
            <div
              className={`relative flex-[5] min-h-0 overflow-hidden ${
                isSolitaire ? 'opacity-[0.12] pointer-events-none' : ''
              }`}
            >
              <PlayerArea
                playerSeat={opponentSeat}
                isOpponent={true}
                isActive={resolvedActiveSeat === opponentSeat}
              />
            </div>

            {/* VS 分隔线 (中央) - 对墙打模式下弱化 */}
            <div
              className="relative flex h-[32px] flex-shrink-0 items-center justify-center border-y"
              style={{
                borderColor: isSolitaire
                  ? 'color-mix(in srgb, var(--border-default) 30%, transparent)'
                  : 'var(--border-default)',
                background: isSolitaire
                  ? 'color-mix(in srgb, var(--bg-overlay) 16%, transparent)'
                  : 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent-primary) 12%, transparent), color-mix(in srgb, var(--accent-secondary) 12%, transparent), transparent)',
              }}
            >
              <span
                className="px-4 text-lg font-bold tracking-[0.2em]"
                style={{
                  color: isSolitaire ? 'var(--text-muted)' : 'var(--accent-primary)',
                  textShadow: isSolitaire
                    ? 'none'
                    : '0 0 12px color-mix(in srgb, var(--accent-primary) 35%, transparent)',
                }}
              >
                VS
              </span>
            </div>

            {/* 己方区域 (底部) - 包含己方 Live 区和成员槽位 */}
            <div className="flex-[5] min-h-0 overflow-hidden">
              <PlayerArea
                playerSeat={selfSeat}
                isOpponent={false}
                isActive={resolvedActiveSeat === selfSeat}
              />
            </div>
          </>
        )}

        {/* 阶段指示器 */}
        <PhaseIndicator
          phase={currentPhase}
          turnNumber={currentTurnCount ?? matchView.turnCount}
          onOpenJudgment={handleOpenJudgmentPanel}
        />

        {/* 左侧唤出按钮（判定区关闭时显示） */}
        {isJudgmentPanelRelevant && !judgmentPanelOpen && (
          <button
            type="button"
            onClick={handleOpenJudgmentPanel}
            className="fixed left-0 top-1/2 z-[70] flex -translate-y-1/2 items-center gap-1 rounded-r-2xl border border-l-0 border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 py-2 text-xs font-semibold text-[var(--accent-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl transition-colors hover:text-[var(--text-primary)]"
          >
            <ChevronRight size={14} />
            判定区
          </button>
        )}

        {/* 游戏日志 */}
        {!isMobileBattlefield && <GameLog />}

        {/* 阶段提示横幅 */}
        <PhaseBanner />

        {/* 调试控制面板 */}
        {!isMobileBattlefield && <DebugControl />}

        {/* 卡牌详情浮窗 */}
        <CardDetailOverlay />

        {/* Live 结果动画 */}
        <LiveResultAnimation
          visible={shouldShowWinnerAnimation}
          isViewerWinner={isViewerWinnerInCurrentLive}
          scoreInfo={
            shouldShowWinnerAnimation
              ? ({
                  selfScore: viewerLiveScore,
                  opponentScore: opponentLiveScore,
                  selfWon: viewerLiveWinner,
                  opponentWon: opponentLiveWinner,
                  isDraw: isLiveDraw(),
                } as LiveScoreInfo)
              : null
          }
          onComplete={handleLiveAnimationComplete}
        />

        {/* Live 判定面板 */}
        <JudgmentPanel
          isOpen={isJudgmentPanelRelevant && judgmentPanelOpen}
          onClose={handleJudgmentPanelClose}
        />

        {/* Live 分数最终确认弹窗（居中） */}
        <ScoreConfirmModal />

        {/* 换牌面板 */}
        <MulliganPanel isOpen={mulliganPanelOpen} />

        {/* 拖拽覆盖层 - 显示正在拖拽的卡牌 */}
        <DragOverlay>
          {activeCard ? (
            <Card
              cardData={activeCard.cardData as AnyCardData}
              instanceId={activeCard.instanceId}
              imagePath={activeCard.imagePath}
              size="sm"
              faceUp={true}
              showHover={false}
            />
          ) : activeCardId ? (
            <div className="h-[112px] w-[80px] overflow-hidden rounded-lg shadow-lg">
              <img src="/back.jpg" alt="Card Back" className="h-full w-full object-cover" />
            </div>
          ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
});

function resolveSpecialDragTarget(targetId: string): SpecialDragTarget | null {
  if (targetId.startsWith(INSPECTION_TARGET_PREFIX)) {
    const suffix = targetId.slice(INSPECTION_TARGET_PREFIX.length);
    switch (suffix) {
      case 'hand':
        return { kind: 'inspection', action: 'HAND' };
      case 'waiting-room':
        return { kind: 'inspection', action: 'WAITING_ROOM' };
      case 'main-deck-top':
        return { kind: 'inspection', action: 'MAIN_DECK_TOP' };
      case 'main-deck-bottom':
        return { kind: 'inspection', action: 'MAIN_DECK_BOTTOM' };
      default:
        return null;
    }
  }

  if (targetId.startsWith(RESOLUTION_TARGET_PREFIX)) {
    const suffix = targetId.slice(RESOLUTION_TARGET_PREFIX.length);
    switch (suffix) {
      case 'hand':
        return { kind: 'resolution', action: 'HAND' };
      case 'waiting-room':
        return { kind: 'resolution', action: 'WAITING_ROOM' };
      case 'main-deck-top':
        return { kind: 'resolution', action: 'MAIN_DECK_TOP' };
      default:
        return null;
    }
  }

  return null;
}

export default GameBoard;
