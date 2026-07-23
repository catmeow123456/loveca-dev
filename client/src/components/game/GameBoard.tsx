/**
 * 游戏主界面布局
 */

import {
  memo,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent,
} from 'react';
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
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore, type VisibleCardPresentation } from '@/store/gameStore';
import { PlayerArea, type SelectedHandCardAction } from './PlayerArea';
import { GameLog, GameLogContent } from './GameLog';
import {
  PublicBattleLogButton,
  PublicBattleLogContent,
  PublicBattleLogPanel,
} from './PublicBattleLog';
import { PhaseIndicator } from './PhaseIndicator';
import { PhaseBanner } from './PhaseBanner';
import { LiveResultAnimation, type LiveScoreInfo } from './LiveResultAnimation';
import { DebugControl } from './DebugControl';
import { CardDetailOverlay } from './CardDetailOverlay';
import { CardDetailPressTarget } from './CardDetailPressTarget';
import { JudgmentPanel } from './JudgmentPanel';
import { ScoreConfirmModal } from './ScoreConfirmModal';
import { BattleAnimationLayer } from './BattleAnimationLayer';
import { BattleActionFeedbackLayer } from './BattleActionFeedbackLayer';
import { EffectChoicePanel } from './EffectChoicePanel';
import { Card } from '@/components/card/Card';
import { CardEffectText } from '@/components/card/CardEffectText';
import { MulliganPanel } from './MulliganPanel';
import { ThemeToggle } from '@/components/common';
import { getDeckBackUrl } from '@/lib/imageService';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { parseZoneId } from '@/lib/zoneUtils';
import { getDragActionDescriptor, type SpecialDragTarget } from '@/lib/battleDragAction';
import { ENTER_EFFECT_SURFACE_SUSPEND_MS } from '@/lib/battleAnimationSequencing';
import { formatActiveEffectCardLabelWithLocation } from '@/lib/activeEffectCardLocation';
import {
  hasBattleViewportSignatureChanged,
  isBattleViewportInteractionInvalidated,
  readBattleViewportSignature,
  subscribeToBattleViewportChanges,
  type BattleViewportSignature,
} from '@/lib/battleViewport';
import {
  buildBattleActionIntents,
  canUseLegacyManualDropFallback,
  findEnabledBattleActionTargetByTargetId,
  findEnabledBattleActionTargetForZoneDrop,
  type BattleActionIntent,
} from '@/lib/battleActionIntent';
import { executeBattleActionPayload as executeBattleActionPayloadWithHandlers } from '@/lib/battleActionExecutor';
import { findBattleObjectLocation } from '@/lib/battleAnimationEvents';
import { useKeyedState } from '@/hooks/useKeyedState';
import {
  buildPublicCardSelectionDisplayEntries,
  isPublicCardSelectionAutoAdvanceView,
  PUBLIC_CARD_SELECTION_FALLBACK_DELAY_MS,
  schedulePublicCardSelectionAutoAdvance,
} from '@/lib/publicCardSelectionAutoAdvance';
import {
  canConfirmEffectChoiceSelection,
  isPublicEffectChoiceAutoAdvanceView,
  normalizeEffectChoiceSelection,
  PUBLIC_EFFECT_CHOICE_FALLBACK_DELAY_MS,
  schedulePublicEffectChoiceAutoAdvance,
  toggleEffectChoiceSelection,
} from '@/lib/effectChoiceUi';
import { cn } from '@/lib/utils';
import {
  LL_BP7_001_SPECIAL_PLAY_UI_CARD_CODE,
  getSpecialMemberPlayTargetSlots,
} from '@/lib/specialMemberPlay';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isOwnDeskFreeDragWindow } from '@game/application/command-availability';
import { GameCommandType } from '@game/application/game-commands';
import { canUseDoubleRelay } from '@game/shared/rules/double-relay';
import {
  ChevronRight,
  Check,
  DoorOpen,
  EyeOff,
  Maximize2,
  Repeat2,
  ScrollText,
  Swords,
  Undo2,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import {
  SlotPosition,
  GamePhase,
  SubPhase,
  ZoneType,
  CardType,
  OrientationState,
} from '@game/shared/types/enums';
import { getPhaseConfig, getSubPhaseConfig } from '@game/shared/phase-config';
import type { AnyCardData } from '@game/domain/entities/card';
import type { PlayerViewState, Seat } from '@game/online';

const INSPECTION_TARGET_PREFIX = 'inspection-target-';
const SELECTED_HAND_CARD_ACTION_IDS = {
  doubleRelay: 'double-relay',
  specialMemberPlay: 'special-member-play',
} as const;
const SPECIAL_MEMBER_PLAY_HAND_CARD_ACTIONS = [
  {
    id: SELECTED_HAND_CARD_ACTION_IDS.specialMemberPlay,
    text: '特殊登场',
    title: '选择特殊登场区域',
    align: 'center',
  },
] as const satisfies readonly SelectedHandCardAction[];
const DOUBLE_RELAY_HAND_CARD_ACTIONS = [
  {
    id: SELECTED_HAND_CARD_ACTION_IDS.doubleRelay,
    text: '双换手',
    title: '依次选择两个换手区域',
    align: 'center',
  },
] as const satisfies readonly SelectedHandCardAction[];
const SPECIAL_PLAY_AND_DOUBLE_RELAY_HAND_CARD_ACTIONS = [
  ...SPECIAL_MEMBER_PLAY_HAND_CARD_ACTIONS,
  ...DOUBLE_RELAY_HAND_CARD_ACTIONS,
] as const satisfies readonly SelectedHandCardAction[];
const NO_SELECTED_HAND_CARD_ACTIONS = [] as const satisfies readonly SelectedHandCardAction[];
const INSPECTION_TARGET_IDS = [
  `${INSPECTION_TARGET_PREFIX}hand`,
  `${INSPECTION_TARGET_PREFIX}waiting-room`,
  `${INSPECTION_TARGET_PREFIX}main-deck-top`,
  `${INSPECTION_TARGET_PREFIX}main-deck-bottom`,
] as const;
const INSPECTION_TARGET_ID_SET = new Set<string>(INSPECTION_TARGET_IDS);
const RESOLUTION_TARGET_PREFIX = 'resolution-target-';
// Mirrors src/application/card-effect-runner.ts order-selection ability id for UI-only labeling.
const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const MEMBER_SLOT_LABELS: Record<SlotPosition, string> = {
  [SlotPosition.LEFT]: '左侧',
  [SlotPosition.CENTER]: '中心',
  [SlotPosition.RIGHT]: '右侧',
};

function formatCardCompactLabel(cardData: AnyCardData): string {
  const localizedName = getCardLocalizedInfo(cardData);
  if (cardData.cardType === CardType.MEMBER && 'cost' in cardData) {
    return `${cardData.cost} ${localizedName.title}`;
  }
  if (cardData.cardType === CardType.LIVE && 'score' in cardData) {
    return `${cardData.score}分 ${localizedName.title}`;
  }
  return localizedName.title;
}

type MobileBattlePanel = 'opponent' | 'log' | 'publicLog';

interface DragBattleActionIntentCache {
  readonly key: string;
  readonly cardId: string;
  readonly fromZone: ZoneType;
  readonly intents: readonly BattleActionIntent[];
}

type StageFormationDraftSlot = {
  readonly slot: SlotPosition;
  readonly cardId: string | null;
  readonly objectId: string | null;
  readonly originalSlot: SlotPosition;
  readonly energyBelowCount: number;
  readonly memberBelowCount: number;
};

type StageFormationMoveHistoryEntry = {
  readonly cardId: string;
  readonly toSlot: SlotPosition;
};

const EMPTY_STRING_SELECTION: string[] = [];
const EMPTY_STAGE_FORMATION_HISTORY: StageFormationMoveHistoryEntry[] = [];

function buildActiveEffectInteractionKey(
  activeEffect: PlayerViewState['activeEffect']
): string | null {
  if (!activeEffect) {
    return null;
  }

  return JSON.stringify({
    id: activeEffect.id,
    stepId: activeEffect.stepId,
    selectableObjectMode: activeEffect.selectableObjectMode ?? null,
    selectableObjectIds: activeEffect.selectableObjectIds ?? [],
    selectableSlots: activeEffect.selectableSlots ?? [],
    selectableOptions: activeEffect.selectableOptions?.map((option) => option.id) ?? [],
    effectChoice: activeEffect.effectChoice
      ? {
          mode: activeEffect.effectChoice.mode,
          minSelections: activeEffect.effectChoice.minSelections,
          maxSelections: activeEffect.effectChoice.maxSelections,
          options: activeEffect.effectChoice.options.map((option) => ({
            id: option.id,
            selectable: option.selectable !== false,
          })),
        }
      : null,
    numericInput: activeEffect.numericInput ?? null,
    stageFormation: activeEffect.stageFormation ?? null,
  });
}

function buildInitialStageFormationDraft(
  activeEffect: PlayerViewState['activeEffect']
): StageFormationDraftSlot[] {
  return (
    activeEffect?.stageFormation?.slots.map((slot) => ({
      slot: slot.slot as SlotPosition,
      cardId: slot.cardId,
      objectId: slot.objectId,
      originalSlot: slot.originalSlot as SlotPosition,
      energyBelowCount: slot.energyBelowCount,
      memberBelowCount: slot.memberBelowCount,
    })) ?? []
  );
}

const inspectionFirstCollisionDetection: CollisionDetection = (args) => {
  const dragData = args.active.data.current as { fromZone?: ZoneType } | undefined;
  if (dragData?.fromZone === ZoneType.INSPECTION_ZONE) {
    const pointerCollisions = pointerWithin(args);
    const inspectionTargetCollision = pointerCollisions.find((collision) =>
      INSPECTION_TARGET_ID_SET.has(String(collision.id))
    );

    if (inspectionTargetCollision) {
      return [inspectionTargetCollision];
    }
  }

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

function didObjectMoveIntoMemberSlot(
  previousViewState: PlayerViewState | null,
  nextViewState: PlayerViewState,
  objectId: string
): boolean {
  const previousLocation = findBattleObjectLocation(previousViewState, objectId);
  const nextLocation = findBattleObjectLocation(nextViewState, objectId);
  return (
    previousLocation !== null &&
    nextLocation !== null &&
    previousLocation.key !== nextLocation.key &&
    nextLocation.zoneType === ZoneType.MEMBER_SLOT
  );
}

interface GameBoardProps {
  onLeaveLocalGame?: () => void;
  showDesktopPublicBattleLogButton?: boolean;
}

export const GameBoard = memo(function GameBoard({
  onLeaveLocalGame,
  showDesktopPublicBattleLogButton = true,
}: GameBoardProps) {
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
  const playerViewState = useGameStore((s) => s.playerViewState);
  const currentTurnCount = useGameStore((s) => s.getTurnCountView());
  const currentPhase = useGameStore((s) => s.getCurrentPhaseView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView()) ?? SubPhase.NONE;
  const activeSeat = useGameStore((s) => s.getActiveSeatView());
  const viewerSeat = useGameStore((s) => s.getViewerSeat());
  const activeEffect = useGameStore((s) => s.playerViewState?.activeEffect ?? null);
  const pendingCostPayment = useGameStore((s) => s.playerViewState?.pendingCostPayment ?? null);
  const pendingSpecialMemberPlay = useGameStore(
    (s) => s.playerViewState?.pendingSpecialMemberPlay ?? null
  );
  const battleAnimationOcclusions = useGameStore((s) => s.ui.battleAnimationOcclusions);
  const viewerLiveScore = useGameStore((s) => s.getViewerLiveScore());
  const opponentLiveScore = useGameStore((s) => s.getOpponentLiveScore());
  const viewerLiveWinner = useGameStore((s) => s.isViewerLiveWinner());
  const opponentLiveWinner = useGameStore((s) => s.isOpponentLiveWinner());
  const isLiveDraw = useGameStore((s) => s.isLiveDraw);
  const freePlayEnabled = useGameStore((s) => s.freePlayEnabled);
  const capabilities = useGameStore(useShallow((s) => s.getBattleSurfaceCapabilities()));
  const replaySession = useGameStore((s) => s.replaySession);
  const canConfirmEffectCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.CONFIRM_EFFECT_STEP)
  );
  const canConfirmCostPaymentCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.CONFIRM_COST_PAYMENT)
  );
  const canPlayMemberToSlotCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.PLAY_MEMBER_TO_SLOT)
  );
  const specialMemberPlayHint = useGameStore((s) =>
    s.getCommandHint(GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY)
  );
  const canSetLiveCardCommand = useGameStore((s) => s.canUseAction(GameCommandType.SET_LIVE_CARD));
  const canMoveMemberToSlotCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_MEMBER_TO_SLOT)
  );
  const canAttachEnergyToMemberCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.ATTACH_ENERGY_TO_MEMBER)
  );
  const canMovePublicCardToHandCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_PUBLIC_CARD_TO_HAND)
  );
  const canMovePublicCardToWaitingRoomCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM)
  );
  const canMovePublicCardToEnergyDeckCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK)
  );
  const canMoveInspectedCardToZoneCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE)
  );
  const canMoveInspectedCardToTopCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_INSPECTED_CARD_TO_TOP)
  );
  const canMoveInspectedCardToBottomCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM)
  );
  const canMoveResolutionCardToZoneCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE)
  );
  const canConfirmResultAnimationCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.CONFIRM_STEP)
  );
  const getPlayerIdentityForSeat = useGameStore((s) => s.getPlayerIdentityForSeat);
  const selectedCardId = useGameStore((s) => s.ui.selectedCardId);
  const logCount = useGameStore((s) => s.ui.logs.length);
  const publicLogCount = useGameStore((s) => s.publicBattleLog.events.length);
  const publicLogUnreadCount = useGameStore((s) => s.publicBattleLog.unreadCount);
  const setPublicBattleLogPanelOpen = useGameStore((s) => s.setPublicBattleLogPanelOpen);
  const isMobileBattlefield = useMediaQuery('(max-width: 767px)');
  const canShowDebugLog = capabilities.canShowDebugLog;
  const canShowPublicBattleLog = capabilities.authority === 'REMOTE';
  const canShowDesktopPublicBattleLogButton =
    canShowPublicBattleLog && showDesktopPublicBattleLogButton;
  const isReadOnly = capabilities.isReadOnly;
  const canShowUndo = capabilities.undoPolicy !== 'NONE';
  const undoGrant = matchView?.undo?.grant ?? null;
  const hasViewerUndoGrant =
    !!undoGrant &&
    !!matchView?.viewerSeat &&
    undoGrant.requesterSeat === matchView.viewerSeat &&
    undoGrant.boundaryKey === matchView.undo?.entry?.boundaryKey;
  const undoButtonLabel =
    capabilities.undoPolicy === 'REMOTE_REQUEST'
      ? hasViewerUndoGrant
        ? '继续撤销'
        : '请求撤销'
      : '撤销';
  const mobileUndoButtonLabel =
    capabilities.undoPolicy === 'REMOTE_REQUEST' ? (hasViewerUndoGrant ? '撤销' : '请求') : '撤销';
  const canUndoLastStep = useGameStore((s) => s.canUndoLastStep());
  const undoLastStep = useGameStore((s) => s.undoLastStep);
  const prevPhaseRef = useRef<GamePhase | null>(null);
  const previousViewStateRef = useRef<PlayerViewState | null>(null);
  const lastNonActiveEffectViewStateRef = useRef<PlayerViewState | null>(null);
  const entryEffectSuspendedIdsRef = useRef(new Set<string>());
  const dragBattleActionIntentCacheRef = useRef<DragBattleActionIntentCache | null>(null);
  const dragStartViewportSignatureRef = useRef<BattleViewportSignature | null>(null);
  const dragViewportInvalidatedRef = useRef(false);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const {
    setLiveCard,
    addLog,
    playMemberToSlot,
    beginSpecialMemberPlay,
    confirmSpecialMemberPlay,
    cancelSpecialMemberPlay,
    moveTableCard,
    moveMemberToSlot,
    attachEnergyToMember,
    confirmSubPhase,
    confirmEffectStep,
    confirmEffectChoice,
    autoAdvancePublicCardSelection,
    autoAdvancePublicEffectChoice,
    confirmCostPayment,
    selectSuccessCard,
    skipSuccessLiveSelection,
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
    deselectCard,
    drawEnergyToZone,
    setDragHints,
    setBattleDragActionHint,
    pushBattleFeedback,
    setHoveredCard,
    setFreePlayEnabled,
    respondRemoteUndoRequest,
    respondManualOperationModeRequest,
    getZoneCardIds,
    findViewerCardZone,
    resolveCardDropTarget,
    getCardSlotPosition,
    getSeatMemberSlotCardId,
    getCardViewObject,
  } = useGameStore(
    useShallow((s) => ({
      setLiveCard: s.setLiveCard,
      addLog: s.addLog,
      playMemberToSlot: s.playMemberToSlot,
      beginSpecialMemberPlay: s.beginSpecialMemberPlay,
      confirmSpecialMemberPlay: s.confirmSpecialMemberPlay,
      cancelSpecialMemberPlay: s.cancelSpecialMemberPlay,
      moveTableCard: s.moveTableCard,
      moveMemberToSlot: s.moveMemberToSlot,
      attachEnergyToMember: s.attachEnergyToMember,
      confirmSubPhase: s.confirmSubPhase,
      confirmEffectStep: s.confirmEffectStep,
      confirmEffectChoice: s.confirmEffectChoice,
      autoAdvancePublicCardSelection: s.autoAdvancePublicCardSelection,
      autoAdvancePublicEffectChoice: s.autoAdvancePublicEffectChoice,
      confirmCostPayment: s.confirmCostPayment,
      selectSuccessCard: s.selectSuccessCard,
      skipSuccessLiveSelection: s.skipSuccessLiveSelection,
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
      deselectCard: s.deselectCard,
      drawEnergyToZone: s.drawEnergyToZone,
      setDragHints: s.setDragHints,
      setBattleDragActionHint: s.setBattleDragActionHint,
      pushBattleFeedback: s.pushBattleFeedback,
      setHoveredCard: s.setHoveredCard,
      setFreePlayEnabled: s.setFreePlayEnabled,
      respondRemoteUndoRequest: s.respondRemoteUndoRequest,
      respondManualOperationModeRequest: s.respondManualOperationModeRequest,
      getZoneCardIds: s.getZoneCardIds,
      findViewerCardZone: s.findViewerCardZone,
      resolveCardDropTarget: s.resolveCardDropTarget,
      getCardSlotPosition: s.getCardSlotPosition,
      getSeatMemberSlotCardId: s.getSeatMemberSlotCardId,
      getCardViewObject: s.getCardViewObject,
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
  const [activeDragFromZone, setActiveDragFromZone] = useState<ZoneType | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobileBattlePanel | null>(null);
  const activeEffectInteractionKey = buildActiveEffectInteractionKey(activeEffect);
  const [activeEffectSingleSelection, setActiveEffectSingleSelection] = useKeyedState<
    string | null
  >(activeEffectInteractionKey, null);
  const [activeEffectOrderedSelection, setActiveEffectOrderedSelection] = useKeyedState(
    activeEffectInteractionKey,
    EMPTY_STRING_SELECTION
  );
  const [activeEffectChoiceSelection, setActiveEffectChoiceSelection] = useKeyedState(
    activeEffectInteractionKey,
    EMPTY_STRING_SELECTION
  );
  const [activeEffectNumberInput, setActiveEffectNumberInput] = useKeyedState(
    activeEffectInteractionKey,
    ''
  );
  const [activeEffectCollapsed, setActiveEffectCollapsed] = useKeyedState(
    activeEffectInteractionKey,
    false
  );
  const [activeEffectOriginalTextExpanded, setActiveEffectOriginalTextExpanded] = useKeyedState(
    activeEffectInteractionKey,
    false
  );
  const [stageFormationDraftSlots, setStageFormationDraftSlots] = useKeyedState(
    activeEffectInteractionKey,
    buildInitialStageFormationDraft(activeEffect)
  );
  const [stageFormationMoveHistory, setStageFormationMoveHistory] = useKeyedState(
    activeEffectInteractionKey,
    EMPTY_STAGE_FORMATION_HISTORY
  );
  const [selectedStageFormationCardId, setSelectedStageFormationCardId] = useKeyedState<
    string | null
  >(activeEffectInteractionKey, null);
  const [publicSelectionFallbackKey, setPublicSelectionFallbackKey] = useState<string | null>(null);
  const [publicEffectChoiceFallbackKey, setPublicEffectChoiceFallbackKey] = useState<string | null>(
    null
  );
  const [activeEffectSuspension, setActiveEffectSuspension] = useState<{
    readonly effectId: string;
    readonly until: number;
  } | null>(null);
  const [specialPlayTargetSelectionCardId, setSpecialPlayTargetSelectionCardId] = useState<
    string | null
  >(null);
  const [specialPlayPaymentDraft, setSpecialPlayPaymentDraft] = useState<{
    readonly pendingId: string;
    readonly cardIds: readonly string[];
  } | null>(null);

  useEffect(() => {
    const pendingId = pendingSpecialMemberPlay?.id;
    const timer = window.setTimeout(
      () =>
        setSpecialPlayPaymentDraft((current) =>
          current && current.pendingId !== pendingId ? null : current
        ),
      0
    );
    return () => window.clearTimeout(timer);
  }, [pendingSpecialMemberPlay?.id]);

  const clearDragInteractionState = useCallback(() => {
    setActiveCardId(null);
    setActiveDragFromZone(null);
    setDragHints(false);
    setBattleDragActionHint(null);
    dragBattleActionIntentCacheRef.current = null;
    dragStartViewportSignatureRef.current = null;
    dragViewportInvalidatedRef.current = false;
  }, [setBattleDragActionHint, setDragHints]);

  const invalidateDragForViewportChange = useCallback(() => {
    const startSignature = dragStartViewportSignatureRef.current;
    if (!startSignature || dragViewportInvalidatedRef.current) {
      return;
    }

    if (hasBattleViewportSignatureChanged(startSignature, readBattleViewportSignature())) {
      dragViewportInvalidatedRef.current = true;
      setDragHints(false);
      setBattleDragActionHint(null);
    }
  }, [setBattleDragActionHint, setDragHints]);

  useEffect(
    () => subscribeToBattleViewportChanges(invalidateDragForViewportChange),
    [invalidateDragForViewportChange]
  );

  const formatActiveEffectCardCompactLabel = useCallback(
    (cardId: string, cardData: AnyCardData): string => {
      const zone = findViewerCardZone(cardId);
      const slot = getCardSlotPosition(cardId);
      const isStageSlotOccupant =
        slot !== null &&
        (getSeatMemberSlotCardId('FIRST', slot) === cardId ||
          getSeatMemberSlotCardId('SECOND', slot) === cardId);
      const cardLabel = formatCardCompactLabel(cardData);

      return formatActiveEffectCardLabelWithLocation(cardLabel, {
        cardType: cardData.cardType,
        zone,
        slot,
        isStageSlotOccupant,
      });
    },
    [findViewerCardZone, getCardSlotPosition, getSeatMemberSlotCardId]
  );

  const mulliganPanelOpen = currentPhase === GamePhase.MULLIGAN_PHASE;
  const activeEffectSourceCardId = activeEffect?.sourceObjectId.replace(/^obj_/, '') ?? null;
  const activeEffectSource = activeEffectSourceCardId
    ? getVisibleCardPresentation(activeEffectSourceCardId)
    : null;
  const activeEffectSourceLabel = activeEffectSource
    ? formatActiveEffectCardCompactLabel(
        activeEffectSource.instanceId,
        activeEffectSource.cardData as AnyCardData
      )
    : '卡牌效果';
  const activeEffectLocalizedInfo = activeEffectSource
    ? getCardLocalizedInfo(activeEffectSource.cardData as AnyCardData)
    : null;
  const activeEffectOriginalTextCn =
    activeEffectLocalizedInfo?.hasEffect &&
    activeEffectLocalizedInfo.effectCn &&
    activeEffectLocalizedInfo.effectCn !== activeEffect?.effectText
      ? activeEffectLocalizedInfo.effectCn
      : null;
  const activeEffectOriginalTextJp =
    activeEffectLocalizedInfo?.hasEffect &&
    activeEffectLocalizedInfo.effectJp &&
    activeEffectLocalizedInfo.effectJp !== activeEffect?.effectText
      ? activeEffectLocalizedInfo.effectJp
      : null;
  const hasActiveEffectOriginalText = !!activeEffectOriginalTextCn || !!activeEffectOriginalTextJp;
  const activeEffectSelectableCardIds =
    activeEffect?.selectableObjectIds?.map((objectId) => objectId.replace(/^obj_/, '')) ?? [];
  const activeEffectSelectableObjectsFaceDown = activeEffect?.selectableObjectsFaceDown === true;
  const isActiveEffectOrderSelectionWindow = activeEffect?.abilityId === ABILITY_ORDER_SELECTION_ID;
  const activeEffectTitle = isActiveEffectOrderSelectionWindow
    ? '选择效果发动顺序'
    : activeEffectSourceLabel;
  const activeEffectDescription = isActiveEffectOrderSelectionWindow
    ? '选择下一个要处理的效果，或按当前队列顺序依次处理。'
    : (activeEffect?.effectText ?? '');
  const activeEffectBadgeLabel = isActiveEffectOrderSelectionWindow
    ? `队列 ${activeEffectSelectableCardIds.length} 个`
    : `${activeEffect?.inspectionObjectIds?.length ?? activeEffect?.revealedObjectIds?.length ?? 0} 张`;
  const activeEffectSelectionLabel = isActiveEffectOrderSelectionWindow
    ? '请选择下一个要处理的效果'
    : (activeEffect?.selectionLabel ?? '请选择要处理的卡牌');
  const isActiveEffectInspectionWindow =
    matchView?.window?.windowType === 'INSPECTION' &&
    typeof matchView.window.context?.activeEffectId === 'string';
  const activeEffectInspectionCount = activeEffect?.inspectionObjectIds?.length ?? 0;
  const successLiveSelection = matchView?.liveResult?.successLiveSelection ?? null;
  const successLiveSelectionCardIds =
    successLiveSelection?.candidateObjectIds.map((objectId) => objectId.replace(/^obj_/, '')) ?? [];
  const showSuccessLiveSelectionModal =
    !isReadOnly &&
    currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
    !activeEffect &&
    successLiveSelection?.waitingSeat === viewerSeat &&
    successLiveSelectionCardIds.length > 0;
  const successLiveSelectionKey = showSuccessLiveSelectionModal
    ? `${successLiveSelection?.waitingSeat ?? 'none'}:${successLiveSelectionCardIds.join('|')}`
    : null;
  const [successLiveSelectionCollapsed, setSuccessLiveSelectionCollapsed] = useKeyedState(
    successLiveSelectionKey,
    false
  );
  const activeEffectHasEnergyCandidates = activeEffectSelectableCardIds.some(
    (cardId) => getKnownCardType(cardId) === CardType.ENERGY
  );
  const activeEffectRevealedCardIds =
    activeEffect?.revealedObjectIds?.map((objectId) => objectId.replace(/^obj_/, '')) ?? [];
  const isPublicCardSelectionAutoAdvance = isPublicCardSelectionAutoAdvanceView(activeEffect);
  const publicCardSelectionKey = isPublicCardSelectionAutoAdvance
    ? `${activeEffect.id}:${activeEffect.publicCardSelectionAutoAdvanceAt}`
    : null;
  const publicSelectionFallbackReady =
    publicCardSelectionKey !== null && publicSelectionFallbackKey === publicCardSelectionKey;
  const isPublicEffectChoiceAutoAdvance = isPublicEffectChoiceAutoAdvanceView(activeEffect);
  const publicEffectChoiceKey = isPublicEffectChoiceAutoAdvance
    ? `${activeEffect.id}:${activeEffect.publicEffectChoiceAutoAdvanceAt}`
    : null;
  const publicEffectChoiceFallbackReady =
    publicEffectChoiceKey !== null && publicEffectChoiceFallbackKey === publicEffectChoiceKey;
  const showOrdinaryActiveEffectControls =
    !isPublicCardSelectionAutoAdvance && !isPublicEffectChoiceAutoAdvance;
  const publicCardSelectionDisplayEntries = activeEffect
    ? buildPublicCardSelectionDisplayEntries(activeEffect)
    : [];
  const canConfirmActiveEffect =
    !isReadOnly &&
    canConfirmEffectCommand &&
    !!activeEffect &&
    !!viewerSeat &&
    activeEffect.waitingSeat === viewerSeat;
  const activeEffectUsesOrderedMultiSelect = activeEffect?.selectableObjectMode === 'ORDERED_MULTI';
  const activeEffectMinSelectableCards = activeEffect?.minSelectableObjects ?? 0;
  const activeEffectMaxSelectableCards =
    activeEffect?.maxSelectableObjects ?? activeEffectSelectableCardIds.length;
  const canConfirmOrderedEffectSelection =
    canConfirmActiveEffect &&
    activeEffectUsesOrderedMultiSelect &&
    activeEffectOrderedSelection.length >= activeEffectMinSelectableCards &&
    activeEffectOrderedSelection.length <= activeEffectMaxSelectableCards &&
    activeEffectOrderedSelection.every((cardId) => activeEffectSelectableCardIds.includes(cardId));
  const activeEffectSelectableSlots = activeEffect?.selectableSlots ?? [];
  const activeEffectSelectableOptions = activeEffect?.selectableOptions ?? [];
  const activeEffectChoice = activeEffect?.effectChoice ?? null;
  const showLegacyActiveEffectControls = showOrdinaryActiveEffectControls && !activeEffectChoice;
  const normalizedActiveEffectChoiceSelection = activeEffectChoice
    ? normalizeEffectChoiceSelection(activeEffectChoice, activeEffectChoiceSelection)
    : [];
  const activeEffectNumericInput = activeEffect?.numericInput ?? null;
  const activeEffectStageFormation = activeEffect?.stageFormation ?? null;
  const activeEffectSelectedNumber =
    activeEffectNumberInput.trim().length > 0 ? Number(activeEffectNumberInput) : null;
  const canConfirmActiveEffectNumber =
    canConfirmActiveEffect &&
    !!activeEffectNumericInput &&
    activeEffectSelectedNumber !== null &&
    Number.isFinite(activeEffectSelectedNumber) &&
    (activeEffectNumericInput.integerOnly !== true ||
      Number.isInteger(activeEffectSelectedNumber)) &&
    (typeof activeEffectNumericInput.min !== 'number' ||
      activeEffectSelectedNumber >= activeEffectNumericInput.min) &&
    (typeof activeEffectNumericInput.max !== 'number' ||
      activeEffectSelectedNumber <= activeEffectNumericInput.max);
  const activeEffectUsesCardOptionSelection =
    !activeEffectUsesOrderedMultiSelect &&
    activeEffectSelectableCardIds.length > 0 &&
    (activeEffectSelectableOptions.length > 0 ||
      (!!activeEffectChoice && !isPublicEffectChoiceAutoAdvance));
  const activeEffectSelectedCardId =
    activeEffectSingleSelection &&
    activeEffectSelectableCardIds.includes(activeEffectSingleSelection)
      ? activeEffectSingleSelection
      : null;
  const canConfirmActiveEffectChoice =
    canConfirmActiveEffect &&
    !!activeEffectChoice &&
    activeEffectChoice.mode === 'MULTI' &&
    (!activeEffectUsesCardOptionSelection || !!activeEffectSelectedCardId) &&
    canConfirmEffectChoiceSelection(activeEffectChoice, normalizedActiveEffectChoiceSelection);
  const activeEffectSelectableBadgeLabel = isActiveEffectOrderSelectionWindow
    ? `队列 ${activeEffectSelectableCardIds.length} 个`
    : `${
        activeEffectUsesOrderedMultiSelect
          ? `已选 ${activeEffectOrderedSelection.length} / ${activeEffectMaxSelectableCards}`
          : activeEffectUsesCardOptionSelection
            ? `已选 ${activeEffectSelectedCardId ? 1 : 0} / 1`
            : `候选 ${activeEffectSelectableCardIds.length} 张`
      }${activeEffectMinSelectableCards > 0 ? `｜至少 ${activeEffectMinSelectableCards}` : ''}`;
  const pendingCostSourceCardId = pendingCostPayment?.sourceObjectId.replace(/^obj_/, '') ?? null;
  const pendingCostSource = pendingCostSourceCardId
    ? getVisibleCardPresentation(pendingCostSourceCardId)
    : null;
  const pendingCostEnergyIds =
    pendingCostPayment?.payableEnergyObjectIds.map((objectId) => objectId.replace(/^obj_/, '')) ??
    [];
  const canConfirmCostPayment =
    !isReadOnly &&
    canConfirmCostPaymentCommand &&
    !!pendingCostPayment &&
    !!viewerSeat &&
    pendingCostPayment.playerSeat === viewerSeat &&
    pendingCostEnergyIds.length >= pendingCostPayment.finalEnergyCost;
  const autoCostEnergyIds = pendingCostPayment
    ? pendingCostEnergyIds.slice(0, pendingCostPayment.finalEnergyCost)
    : [];
  const pendingUndoRequest = matchView?.undo?.pendingRequest ?? null;
  const pendingUndoRequesterName = pendingUndoRequest
    ? (getPlayerIdentityForSeat(pendingUndoRequest.requesterSeat)?.name ??
      (pendingUndoRequest.requesterSeat === 'FIRST' ? '先攻玩家' : '后攻玩家'))
    : '';
  const pendingUndoIsRequester =
    !!pendingUndoRequest && !!viewerSeat && pendingUndoRequest.requesterSeat === viewerSeat;
  const pendingUndoCanRespond =
    !!pendingUndoRequest && !!viewerSeat && pendingUndoRequest.requesterSeat !== viewerSeat;
  const manualOperation = matchView?.manualOperation ?? null;
  const pendingManualOperationRequest = manualOperation?.pendingRequest ?? null;
  const pendingManualOperationRequesterName = pendingManualOperationRequest
    ? (getPlayerIdentityForSeat(pendingManualOperationRequest.requesterSeat)?.name ??
      (pendingManualOperationRequest.requesterSeat === 'FIRST' ? '先攻玩家' : '后攻玩家'))
    : '';
  const pendingManualOperationIsRequester =
    !!pendingManualOperationRequest &&
    !!viewerSeat &&
    pendingManualOperationRequest.requesterSeat === viewerSeat;
  const pendingManualOperationCanRespond =
    !!pendingManualOperationRequest &&
    !!viewerSeat &&
    pendingManualOperationRequest.requesterSeat !== viewerSeat;
  const selectedCardPresentation = selectedCardId
    ? getVisibleCardPresentation(selectedCardId)
    : null;
  const selectedCardZone = selectedCardId ? findViewerCardZone(selectedCardId) : null;
  const selectedSpecialPlayObjectId = selectedCardId ? `obj_${selectedCardId}` : null;
  const specialPlayTargetSlots = getSpecialMemberPlayTargetSlots(
    specialMemberPlayHint,
    selectedSpecialPlayObjectId
  );
  const canShowSpecialPlayEntry =
    !isReadOnly &&
    specialMemberPlayHint?.enabled === true &&
    !activeEffect &&
    !pendingCostPayment &&
    !pendingSpecialMemberPlay &&
    selectedCardZone === ZoneType.HAND &&
    selectedCardPresentation?.cardData.cardCode === LL_BP7_001_SPECIAL_PLAY_UI_CARD_CODE &&
    !!selectedSpecialPlayObjectId &&
    specialMemberPlayHint.scope?.objectIds?.includes(selectedSpecialPlayObjectId) === true;
  const pendingSpecialPlayCandidateIds =
    pendingSpecialMemberPlay?.candidateObjectIds?.map((objectId) =>
      objectId.replace(/^obj_/, '')
    ) ?? [];
  const controlsPendingSpecialPlay =
    !!pendingSpecialMemberPlay?.sourceObjectId &&
    !!viewerSeat &&
    pendingSpecialMemberPlay.playerSeat === viewerSeat;
  const specialPlayTargetSelectionOpen =
    canShowSpecialPlayEntry && specialPlayTargetSelectionCardId === selectedCardId;
  const specialPlayPaymentSelection =
    specialPlayPaymentDraft && specialPlayPaymentDraft.pendingId === pendingSpecialMemberPlay?.id
      ? specialPlayPaymentDraft.cardIds
      : [];
  const viewerOccupiedMemberSlots = useMemo(() => {
    if (!playerViewState || !viewerSeat) {
      return [];
    }
    return MEMBER_SLOT_ORDER.map((slot) => {
      const cardId = getSeatMemberSlotCardId(viewerSeat, slot);
      return {
        slot,
        cardId,
        enteredStageThisTurn:
          cardId !== null && getCardViewObject(cardId)?.enteredStageThisTurn === true,
      };
    }).filter(
      (
        entry
      ): entry is {
        readonly slot: SlotPosition;
        readonly cardId: string;
        readonly enteredStageThisTurn: boolean;
      } =>
        entry.cardId !== null &&
        (matchView?.manualOperation?.mode === 'FREE' || !entry.enteredStageThisTurn)
    );
  }, [
    getCardViewObject,
    getSeatMemberSlotCardId,
    matchView?.manualOperation?.mode,
    playerViewState,
    viewerSeat,
  ]);
  const canShowDoubleRelayEntry =
    !isReadOnly &&
    canPlayMemberToSlotCommand &&
    !activeEffect &&
    !pendingCostPayment &&
    selectedCardZone === ZoneType.HAND &&
    selectedCardPresentation?.cardData.cardType === CardType.MEMBER &&
    canUseDoubleRelay(selectedCardPresentation) &&
    viewerOccupiedMemberSlots.length >= 2;
  const doubleRelaySelectionKey =
    canShowDoubleRelayEntry && selectedCardId
      ? `${selectedCardId}:${viewerOccupiedMemberSlots
          .map((entry) => `${entry.slot}:${entry.cardId}`)
          .join('|')}`
      : null;
  const [doubleRelaySelection, setDoubleRelaySelection] = useKeyedState<{
    readonly cardId: string;
    readonly selectedSlots: readonly SlotPosition[];
  } | null>(doubleRelaySelectionKey, null);
  const selectedHandCardActions =
    canShowSpecialPlayEntry && canShowDoubleRelayEntry
      ? SPECIAL_PLAY_AND_DOUBLE_RELAY_HAND_CARD_ACTIONS
      : canShowSpecialPlayEntry
        ? SPECIAL_MEMBER_PLAY_HAND_CARD_ACTIONS
        : canShowDoubleRelayEntry
          ? DOUBLE_RELAY_HAND_CARD_ACTIONS
          : NO_SELECTED_HAND_CARD_ACTIONS;
  const selectedHandCardActionCardId = selectedHandCardActions.length > 0 ? selectedCardId : null;
  const activeDoubleRelaySelection =
    doubleRelaySelection &&
    doubleRelaySelection.cardId === selectedCardId &&
    canShowDoubleRelayEntry
      ? {
          ...doubleRelaySelection,
          selectedSlots: doubleRelaySelection.selectedSlots.filter((slot) =>
            viewerOccupiedMemberSlots.some((entry) => entry.slot === slot)
          ),
        }
      : null;
  const doubleRelaySelectedSlots = activeDoubleRelaySelection?.selectedSlots ?? [];
  const canConfirmDoubleRelay = doubleRelaySelectedSlots.length === 2;
  const isActiveEffectLocallySuspended =
    !!activeEffect && activeEffectSuspension?.effectId === activeEffect.id;
  const isActiveEffectUiSuspended =
    !!activeEffect &&
    (isActiveEffectLocallySuspended ||
      battleAnimationOcclusions.some(
        (occlusion) => occlusion.objectId === activeEffect.sourceObjectId
      ));

  useLayoutEffect(() => {
    if (!playerViewState) {
      previousViewStateRef.current = null;
      return;
    }

    const shouldSuspendActiveEffectForEntry =
      !!activeEffect &&
      !entryEffectSuspendedIdsRef.current.has(activeEffect.id) &&
      didObjectMoveIntoMemberSlot(
        lastNonActiveEffectViewStateRef.current ?? previousViewStateRef.current,
        playerViewState,
        activeEffect.sourceObjectId
      );
    if (activeEffect && shouldSuspendActiveEffectForEntry) {
      entryEffectSuspendedIdsRef.current.add(activeEffect.id);
      // The panel must remain hidden until the entry animation has claimed the source card.
      setActiveEffectSuspension({
        effectId: activeEffect.id,
        until: Date.now() + ENTER_EFFECT_SURFACE_SUSPEND_MS,
      });
    } else if (!activeEffect) {
      entryEffectSuspendedIdsRef.current.clear();
    }

    if (!activeEffect) {
      lastNonActiveEffectViewStateRef.current = playerViewState;
    }
    previousViewStateRef.current = playerViewState;
  }, [activeEffect, playerViewState]);

  useEffect(() => {
    if (!activeEffectSuspension) {
      return;
    }

    const timeout = window.setTimeout(
      () =>
        setActiveEffectSuspension((current) =>
          current?.effectId === activeEffectSuspension.effectId &&
          current.until === activeEffectSuspension.until
            ? null
            : current
        ),
      Math.max(0, activeEffectSuspension.until - Date.now())
    );

    return () => window.clearTimeout(timeout);
  }, [activeEffectSuspension]);

  useEffect(() => {
    if (!isPublicCardSelectionAutoAdvance || isReadOnly || !canConfirmEffectCommand) {
      return;
    }

    const effectId = activeEffect.id;
    const cancelAutoAdvance = schedulePublicCardSelectionAutoAdvance(
      activeEffect.publicCardSelectionAutoAdvanceAfterMs,
      () => autoAdvancePublicCardSelection(effectId, activeEffect.publicCardSelectionAutoAdvanceAt)
    );
    const fallbackTimer = window.setTimeout(
      () => setPublicSelectionFallbackKey(publicCardSelectionKey),
      activeEffect.publicCardSelectionAutoAdvanceAfterMs + PUBLIC_CARD_SELECTION_FALLBACK_DELAY_MS
    );

    return () => {
      cancelAutoAdvance();
      window.clearTimeout(fallbackTimer);
    };
  }, [
    activeEffect?.id,
    activeEffect?.stepId,
    activeEffect?.publicCardSelectionAutoAdvanceAt,
    activeEffect?.publicCardSelectionAutoAdvanceAfterMs,
    canConfirmEffectCommand,
    autoAdvancePublicCardSelection,
    isPublicCardSelectionAutoAdvance,
    isReadOnly,
    publicCardSelectionKey,
  ]);

  useEffect(() => {
    if (!isPublicEffectChoiceAutoAdvance || isReadOnly || !canConfirmEffectCommand) {
      return;
    }

    const effectId = activeEffect.id;
    const fallbackKey = `${effectId}:${activeEffect.publicEffectChoiceAutoAdvanceAt}`;
    const cancelAutoAdvance = schedulePublicEffectChoiceAutoAdvance(
      activeEffect.publicEffectChoiceAutoAdvanceAfterMs,
      () => autoAdvancePublicEffectChoice(effectId, activeEffect.publicEffectChoiceAutoAdvanceAt)
    );
    const fallbackTimer = window.setTimeout(
      () => setPublicEffectChoiceFallbackKey(fallbackKey),
      activeEffect.publicEffectChoiceAutoAdvanceAfterMs + PUBLIC_EFFECT_CHOICE_FALLBACK_DELAY_MS
    );

    return () => {
      cancelAutoAdvance();
      window.clearTimeout(fallbackTimer);
    };
  }, [
    activeEffect?.id,
    activeEffect?.stepId,
    activeEffect?.publicEffectChoiceAutoAdvanceAt,
    activeEffect?.publicEffectChoiceAutoAdvanceAfterMs,
    autoAdvancePublicEffectChoice,
    canConfirmEffectCommand,
    isPublicEffectChoiceAutoAdvance,
    isReadOnly,
  ]);

  const handleStageFormationSlotClick = useCallback(
    (targetSlot: SlotPosition) => {
      if (!canConfirmActiveEffect || !activeEffectStageFormation) {
        return;
      }

      const targetEntry = stageFormationDraftSlots.find((entry) => entry.slot === targetSlot);
      if (!targetEntry) {
        return;
      }

      if (!selectedStageFormationCardId) {
        if (targetEntry.cardId) {
          setSelectedStageFormationCardId(targetEntry.cardId);
        }
        return;
      }

      const sourceEntry = stageFormationDraftSlots.find(
        (entry) => entry.cardId === selectedStageFormationCardId
      );
      if (!sourceEntry) {
        setSelectedStageFormationCardId(null);
        return;
      }
      if (sourceEntry.slot === targetSlot) {
        setSelectedStageFormationCardId(null);
        return;
      }

      setStageFormationDraftSlots((current) =>
        current.map((entry) => {
          if (entry.slot === targetSlot) {
            return {
              ...entry,
              cardId: sourceEntry.cardId,
              objectId: sourceEntry.objectId,
              originalSlot: sourceEntry.originalSlot,
              energyBelowCount: sourceEntry.energyBelowCount,
              memberBelowCount: sourceEntry.memberBelowCount,
            };
          }
          if (entry.slot === sourceEntry.slot) {
            return {
              ...entry,
              cardId: targetEntry.cardId,
              objectId: targetEntry.objectId,
              originalSlot: targetEntry.cardId ? targetEntry.originalSlot : entry.slot,
              energyBelowCount: targetEntry.cardId ? targetEntry.energyBelowCount : 0,
              memberBelowCount: targetEntry.cardId ? targetEntry.memberBelowCount : 0,
            };
          }
          return entry;
        })
      );
      setStageFormationMoveHistory((current) => [
        ...current,
        { cardId: selectedStageFormationCardId, toSlot: targetSlot },
      ]);
      setSelectedStageFormationCardId(null);
    },
    [
      activeEffectStageFormation,
      canConfirmActiveEffect,
      selectedStageFormationCardId,
      setSelectedStageFormationCardId,
      setStageFormationDraftSlots,
      setStageFormationMoveHistory,
      stageFormationDraftSlots,
    ]
  );

  const handleConfirmStageFormation = useCallback(() => {
    if (!activeEffect || !activeEffectStageFormation) {
      return;
    }

    const placements = stageFormationDraftSlots
      .filter(
        (entry): entry is StageFormationDraftSlot & { readonly cardId: string } =>
          entry.cardId !== null
      )
      .map((entry) => ({ cardId: entry.cardId, toSlot: entry.slot }));

    confirmEffectStep(
      activeEffect.id,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      stageFormationMoveHistory,
      placements
    );
  }, [
    activeEffect,
    activeEffectStageFormation,
    confirmEffectStep,
    stageFormationDraftSlots,
    stageFormationMoveHistory,
  ]);

  const handleSelectDoubleRelaySlot = useCallback(
    (slot: SlotPosition) => {
      setDoubleRelaySelection((current) => {
        if (!current || current.cardId !== selectedCardId) {
          return current;
        }
        if (!viewerOccupiedMemberSlots.some((entry) => entry.slot === slot)) {
          return current;
        }
        if (current.selectedSlots.includes(slot)) {
          return {
            ...current,
            selectedSlots: current.selectedSlots.filter((selectedSlot) => selectedSlot !== slot),
          };
        }
        if (current.selectedSlots.length >= 2) {
          return current;
        }
        return { ...current, selectedSlots: [...current.selectedSlots, slot] };
      });
    },
    [selectedCardId, setDoubleRelaySelection, viewerOccupiedMemberSlots]
  );

  const handleConfirmDoubleRelay = () => {
    if (!activeDoubleRelaySelection || activeDoubleRelaySelection.selectedSlots.length !== 2) {
      return;
    }

    const [targetSlot, extraSlot] = activeDoubleRelaySelection.selectedSlots;
    const result = playMemberToSlot(activeDoubleRelaySelection.cardId, targetSlot, {
      relayMode: 'DOUBLE',
      relayReplacementSlots: activeDoubleRelaySelection.selectedSlots,
    });
    if (result.success) {
      addLog(
        `双换手登场: ${MEMBER_SLOT_LABELS[targetSlot]} + ${MEMBER_SLOT_LABELS[extraSlot]}`,
        'action'
      );
    }
    if (result.success || result.pending) {
      setDoubleRelaySelection(null);
    }
  };

  const handleBeginSpecialPlayAtSlot = useCallback(
    (slot: SlotPosition) => {
      if (!selectedCardId || !specialPlayTargetSlots.includes(slot)) {
        return;
      }
      const result = beginSpecialMemberPlay(selectedCardId, slot);
      if (result.success || result.pending) {
        setSpecialPlayTargetSelectionCardId(null);
      }
    },
    [beginSpecialMemberPlay, selectedCardId, specialPlayTargetSlots]
  );

  const handleSelectedHandCardAction = useCallback(
    (cardId: string, actionId: string) => {
      if (cardId !== selectedCardId) {
        return;
      }
      if (actionId === SELECTED_HAND_CARD_ACTION_IDS.specialMemberPlay) {
        setDoubleRelaySelection(null);
        setSpecialPlayTargetSelectionCardId(cardId);
        return;
      }
      if (actionId === SELECTED_HAND_CARD_ACTION_IDS.doubleRelay) {
        setSpecialPlayTargetSelectionCardId(null);
        setDoubleRelaySelection({ cardId, selectedSlots: [] });
      }
    },
    [selectedCardId, setDoubleRelaySelection]
  );

  const handleToggleSpecialPlayPayment = useCallback(
    (cardId: string) => {
      setSpecialPlayPaymentDraft((current) => {
        const pendingId = pendingSpecialMemberPlay?.id;
        if (!pendingId) return current;
        const cardIds = current?.pendingId === pendingId ? current.cardIds : [];
        return {
          pendingId,
          cardIds: cardIds.includes(cardId)
            ? cardIds.filter((candidate) => candidate !== cardId)
            : cardIds.length < 3
              ? [...cardIds, cardId]
              : cardIds,
        };
      });
    },
    [pendingSpecialMemberPlay?.id]
  );

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
    if (!canShowDebugLog && mobilePanel === 'log') {
      const timer = window.setTimeout(() => setMobilePanel(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [canShowDebugLog, mobilePanel]);

  useEffect(() => {
    if (!canShowPublicBattleLog && mobilePanel === 'publicLog') {
      const timer = window.setTimeout(() => setMobilePanel(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [canShowPublicBattleLog, mobilePanel]);

  useEffect(() => {
    if (!isMobileBattlefield) {
      return;
    }
    setPublicBattleLogPanelOpen(mobilePanel === 'publicLog');
  }, [isMobileBattlefield, mobilePanel, setPublicBattleLogPanelOpen]);

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
  const shouldShowWinnerAnimation =
    isResultAnimationWindow && isViewerWinnerInCurrentLive && canConfirmResultAnimationCommand;
  const liveResultAnimationKey =
    shouldShowWinnerAnimation && viewerSeat ? `${viewerSeat}:${matchView?.seq ?? 0}` : null;

  const handleLiveAnimationComplete = useCallback(() => {
    if (isReadOnly) {
      return;
    }
    if (currentSubPhase !== SubPhase.RESULT_ANIMATION) {
      return;
    }
    confirmSubPhase(SubPhase.RESULT_ANIMATION);
  }, [confirmSubPhase, currentSubPhase, isReadOnly]);

  const handleBattlefieldBackgroundClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!selectedCardId) {
        return;
      }

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.closest(
          '[data-card-id], [data-zone-id], button, input, textarea, select, a, [role="button"]'
        )
      ) {
        return;
      }

      deselectCard();
    },
    [deselectCard, selectedCardId]
  );

  useEffect(() => {
    if (!selectedCardId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        deselectCard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deselectCard, selectedCardId]);

  const getBattleActionCommandTypes = useCallback((): readonly GameCommandType[] => {
    const commandTypes: GameCommandType[] = [];
    if (canPlayMemberToSlotCommand) commandTypes.push(GameCommandType.PLAY_MEMBER_TO_SLOT);
    if (canMoveMemberToSlotCommand) commandTypes.push(GameCommandType.MOVE_MEMBER_TO_SLOT);
    if (canAttachEnergyToMemberCommand) commandTypes.push(GameCommandType.ATTACH_ENERGY_TO_MEMBER);
    if (canSetLiveCardCommand) commandTypes.push(GameCommandType.SET_LIVE_CARD);
    if (canMovePublicCardToHandCommand) commandTypes.push(GameCommandType.MOVE_PUBLIC_CARD_TO_HAND);
    if (canMovePublicCardToWaitingRoomCommand) {
      commandTypes.push(GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM);
    }
    if (canMovePublicCardToEnergyDeckCommand) {
      commandTypes.push(GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK);
    }
    if (canMoveInspectedCardToZoneCommand && !isActiveEffectInspectionWindow) {
      commandTypes.push(GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE);
    }
    if (canMoveInspectedCardToTopCommand && !isActiveEffectInspectionWindow) {
      commandTypes.push(GameCommandType.MOVE_INSPECTED_CARD_TO_TOP);
    }
    if (canMoveInspectedCardToBottomCommand && !isActiveEffectInspectionWindow) {
      commandTypes.push(GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM);
    }
    if (canMoveResolutionCardToZoneCommand) {
      commandTypes.push(GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE);
    }
    if (canConfirmEffectCommand) commandTypes.push(GameCommandType.CONFIRM_EFFECT_STEP);
    return commandTypes;
  }, [
    canAttachEnergyToMemberCommand,
    canConfirmEffectCommand,
    canMoveInspectedCardToBottomCommand,
    canMoveInspectedCardToTopCommand,
    canMoveInspectedCardToZoneCommand,
    canMoveMemberToSlotCommand,
    canMovePublicCardToEnergyDeckCommand,
    canMovePublicCardToHandCommand,
    canMovePublicCardToWaitingRoomCommand,
    canMoveResolutionCardToZoneCommand,
    canPlayMemberToSlotCommand,
    canSetLiveCardCommand,
    isActiveEffectInspectionWindow,
  ]);

  const buildDragBattleActionIntents = useCallback(
    (cardId: string, fromZone: ZoneType) => {
      const memberSlots = viewerSeat
        ? MEMBER_SLOT_ORDER.map((slot) => ({
            seat: viewerSeat,
            slot,
            cardId: getSeatMemberSlotCardId(viewerSeat, slot),
            enteredStageThisTurn:
              getCardViewObject(getSeatMemberSlotCardId(viewerSeat, slot) ?? '')
                ?.enteredStageThisTurn === true,
          }))
        : [];

      const liveZoneCount = viewerSeat ? getZoneCardIds(`${viewerSeat}_LIVE_ZONE`).length : 0;

      return buildBattleActionIntents({
        sourceCardId: cardId,
        sourceZone: fromZone,
        sourceCardType: getKnownCardType(cardId),
        sourceSlot: getCardSlotPosition(cardId),
        currentPhase,
        currentSubPhase,
        actorSeat: viewerSeat,
        viewerSeat,
        sourceSeat: viewerSeat,
        surface: capabilities.surface,
        isReadOnly,
        availableCommandTypes: getBattleActionCommandTypes(),
        manualOperationMode: matchView?.manualOperation?.mode,
        memberSlots,
        liveZoneCount,
        activeEffect,
        activeEffectCanConfirm: canConfirmActiveEffect,
      });
    },
    [
      activeEffect,
      canConfirmActiveEffect,
      capabilities.surface,
      currentPhase,
      currentSubPhase,
      getBattleActionCommandTypes,
      getCardViewObject,
      getCardSlotPosition,
      getKnownCardType,
      getSeatMemberSlotCardId,
      getZoneCardIds,
      isReadOnly,
      matchView?.manualOperation?.mode,
      viewerSeat,
    ]
  );

  const buildDragBattleActionIntentCacheKey = useCallback(
    (cardId: string, fromZone: ZoneType): string =>
      [
        cardId,
        fromZone,
        playerViewState?.match.matchId ?? 'no-match',
        playerViewState?.match.seq ?? -1,
        activeEffect?.id ?? 'no-effect',
        currentPhase ?? 'no-phase',
        currentSubPhase,
        viewerSeat ?? 'no-viewer',
        capabilities.surface,
        isReadOnly ? 'readonly' : 'interactive',
      ].join('|'),
    [
      activeEffect?.id,
      capabilities.surface,
      currentPhase,
      currentSubPhase,
      isReadOnly,
      playerViewState?.match.matchId,
      playerViewState?.match.seq,
      viewerSeat,
    ]
  );

  const getDragBattleActionIntents = useCallback(
    (cardId: string, fromZone: ZoneType) => {
      const key = buildDragBattleActionIntentCacheKey(cardId, fromZone);
      const cached = dragBattleActionIntentCacheRef.current;
      if (cached?.key === key && cached.cardId === cardId && cached.fromZone === fromZone) {
        return cached.intents;
      }

      const intents = buildDragBattleActionIntents(cardId, fromZone);
      dragBattleActionIntentCacheRef.current = {
        key,
        cardId,
        fromZone,
        intents,
      };
      return intents;
    },
    [buildDragBattleActionIntentCacheKey, buildDragBattleActionIntents]
  );

  const executeBattleActionPayload = useCallback(
    (payload: Parameters<typeof executeBattleActionPayloadWithHandlers>[0]): boolean =>
      executeBattleActionPayloadWithHandlers(payload, {
        playMemberToSlot,
        moveMemberToSlot,
        attachEnergyToMember,
        setLiveCard,
        movePublicCardToHand,
        movePublicCardToWaitingRoom,
        movePublicCardToEnergyDeck,
        moveInspectedCardToZone,
        moveInspectedCardToTop,
        moveInspectedCardToBottom,
        moveResolutionCardToZone,
        confirmEffectStep,
      }),
    [
      attachEnergyToMember,
      confirmEffectStep,
      moveInspectedCardToBottom,
      moveInspectedCardToTop,
      moveInspectedCardToZone,
      moveMemberToSlot,
      movePublicCardToEnergyDeck,
      movePublicCardToHand,
      movePublicCardToWaitingRoom,
      moveResolutionCardToZone,
      playMemberToSlot,
      setLiveCard,
    ]
  );

  // 拖拽开始处理
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (isReadOnly) {
        clearDragInteractionState();
        return;
      }

      dragStartViewportSignatureRef.current = readBattleViewportSignature();
      dragViewportInvalidatedRef.current = false;
      const cardId = event.active.id as string;
      setActiveCardId(cardId);

      // 计算"推荐目标"高亮（只提示，不限制放置）
      const dragData = event.active.data.current as { fromZone?: ZoneType } | undefined;
      const fromZone = dragData?.fromZone;
      const resolvedFromZone = fromZone || findViewerCardZone(cardId);
      setActiveDragFromZone(resolvedFromZone ?? null);
      if (resolvedFromZone) {
        getDragBattleActionIntents(cardId, resolvedFromZone);
      } else {
        dragBattleActionIntentCacheRef.current = null;
      }

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
      if (
        matchView?.window?.windowType === 'INSPECTION' &&
        !isActiveEffectInspectionWindow &&
        (fromZone === ZoneType.HAND || fromZone === ZoneType.WAITING_ROOM)
      ) {
        suggested.push('inspection-zone');
      }
      if (fromZone === ZoneType.INSPECTION_ZONE && !isActiveEffectInspectionWindow) {
        suggested.push(...INSPECTION_TARGET_IDS);
      }

      setDragHints(true, suggested);
      setBattleDragActionHint(null);
    },
    [
      currentPhase,
      currentSubPhase,
      clearDragInteractionState,
      isActiveEffectInspectionWindow,
      isReadOnly,
      matchView?.window?.windowType,
      setDragHints,
      setBattleDragActionHint,
      getKnownCardType,
      findViewerCardZone,
      getDragBattleActionIntents,
    ]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (isReadOnly || dragViewportInvalidatedRef.current || !event.over) {
        setBattleDragActionHint(null);
        return;
      }

      const cardId = event.active.id as string;
      const targetId = event.over.id as string;
      const dragData = event.active.data.current as
        | {
            cardId: string;
            cardCode?: string;
            fromZone?: ZoneType;
          }
        | undefined;
      const specialTarget = resolveSpecialDragTarget(targetId);
      const parsedTarget =
        (!specialTarget ? parseZoneId(targetId) : null) ?? resolveCardDropTarget(targetId);
      const fromZone = dragData?.fromZone || findViewerCardZone(cardId);

      if (!fromZone) {
        setBattleDragActionHint(null);
        return;
      }

      const targetSlot = parsedTarget?.slotPosition;
      const targetOccupied =
        !!viewerSeat &&
        parsedTarget?.zoneType === ZoneType.MEMBER_SLOT &&
        !!targetSlot &&
        getSeatMemberSlotCardId(viewerSeat, targetSlot) !== null;
      const dragIntents = getDragBattleActionIntents(cardId, fromZone);
      const intentTarget = parsedTarget
        ? findEnabledBattleActionTargetForZoneDrop(dragIntents, parsedTarget.zoneType, targetSlot)
        : findEnabledBattleActionTargetByTargetId(dragIntents, targetId);
      if (intentTarget) {
        setBattleDragActionHint({
          label: intentTarget.target.label,
          detail: intentTarget.target.detail,
          tone: 'attempt',
          anchor: { targetId },
        });
        return;
      }
      const descriptor = getDragActionDescriptor({
        fromZone,
        toZone: parsedTarget?.zoneType,
        targetSlot,
        targetOccupied,
        cardType: getKnownCardType(cardId),
        currentPhase,
        specialTarget,
      });

      if (!descriptor) {
        setBattleDragActionHint(null);
        return;
      }

      setBattleDragActionHint({
        label: descriptor.label,
        detail: descriptor.detail,
        tone: descriptor.blocked ? 'blocked' : 'attempt',
        anchor: { targetId },
      });
    },
    [
      currentPhase,
      findViewerCardZone,
      getDragBattleActionIntents,
      getKnownCardType,
      getSeatMemberSlotCardId,
      isReadOnly,
      resolveCardDropTarget,
      setBattleDragActionHint,
      viewerSeat,
    ]
  );

  // 拖拽结束处理 - 统一处理所有区域间的拖拽
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const cardId = active.id as string;
      const dropTargetId = over ? String(over.id) : undefined;
      const dropInvalidatedByViewport = isBattleViewportInteractionInvalidated(
        dragStartViewportSignatureRef.current,
        readBattleViewportSignature(),
        dragViewportInvalidatedRef.current
      );
      clearDragInteractionState();

      if (isReadOnly) return;
      if (dropInvalidatedByViewport) {
        addLog('视口已变化，请重新拖拽', 'error');
        pushBattleFeedback({
          tone: 'error',
          label: '视口已变化',
          detail: '请重新拖拽',
          anchor: { targetId: dropTargetId, cardId },
        });
        return;
      }
      if (!over) return;

      const resolvedTargetId = String(over.id);
      const targetId = resolvedTargetId;
      const pushDropError = (label: string, detail?: string) => {
        addLog(detail ? `${label}: ${detail}` : label, 'error');
        pushBattleFeedback({
          tone: 'error',
          label,
          detail,
          anchor: { targetId: resolvedTargetId, cardId },
        });
      };

      // 获取拖拽数据中的来源区域信息
      const dragData = active.data.current as
        | {
            cardId: string;
            cardCode?: string;
            fromZone?: ZoneType;
          }
        | undefined;

      const specialTarget = resolveSpecialDragTarget(resolvedTargetId);

      // 解析目标区域
      const parsedTarget =
        (!specialTarget ? parseZoneId(resolvedTargetId) : null) ??
        resolveCardDropTarget(resolvedTargetId);
      if (!parsedTarget && !specialTarget) {
        // 无法识别的目标区域
        return;
      }

      // 获取来源区域（优先从拖拽数据获取，否则查找）
      const fromZone = dragData?.fromZone || findViewerCardZone(cardId);
      if (!fromZone) {
        pushDropError('无法确定卡牌来源区域');
        return;
      }

      const dragIntents = getDragBattleActionIntents(cardId, fromZone);
      const intentTarget = parsedTarget
        ? findEnabledBattleActionTargetForZoneDrop(
            dragIntents,
            parsedTarget.zoneType,
            parsedTarget.slotPosition
          )
        : findEnabledBattleActionTargetByTargetId(dragIntents, targetId);
      const payload = intentTarget?.target.commandPayload;
      if (payload && executeBattleActionPayload(payload)) {
        return;
      }

      // RULES 只执行上方已命中的语义 intent。后续 inspection、
      // Live Set 与各类区域移动都是 FREE 为兼容旧拖拽保留的 fallback。
      if (!canUseLegacyManualDropFallback(matchView?.manualOperation?.mode)) {
        return;
      }

      if (
        parsedTarget?.zoneType === ZoneType.INSPECTION_ZONE &&
        !isActiveEffectInspectionWindow &&
        (fromZone === ZoneType.HAND || fromZone === ZoneType.WAITING_ROOM)
      ) {
        const result = moveCardToInspection(cardId, fromZone);
        if (result.success) {
          addLog('卡牌移入检视区', 'action');
        }
        return;
      }

      if (fromZone === ZoneType.INSPECTION_ZONE) {
        if (isActiveEffectInspectionWindow) {
          pushDropError('当前检视由卡牌效果处理，请通过效果窗口确认');
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

        pushDropError('当前检视区拖拽未匹配可执行目标');
        return;
      }

      if (fromZone === ZoneType.RESOLUTION_ZONE) {
        pushDropError('当前解决区拖拽未匹配可执行目标');
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
          pushDropError('能量牌不能移动到手牌');
          return;
        }
        if (toZone === ZoneType.LIVE_ZONE) {
          pushDropError('能量牌不能移动到 LIVE 区');
          return;
        }
        if (toZone === ZoneType.SUCCESS_ZONE) {
          pushDropError('能量牌不能移动到成功 LIVE 卡区');
          return;
        }
        if (toZone === ZoneType.WAITING_ROOM) {
          pushDropError('能量牌不能移动到休息室', '请移动到能量卡组');
          return;
        }
      }

      // LIVE卡移动限制：不能放入成员区和能量区和能量卡组
      if (cardType === CardType.LIVE) {
        if (toZone === ZoneType.MEMBER_SLOT) {
          pushDropError('LIVE 卡不能放入成员区');
          return;
        }
        if (toZone === ZoneType.ENERGY_ZONE) {
          pushDropError('LIVE 卡不能放入能量区');
          return;
        }
        if (toZone === ZoneType.ENERGY_DECK) {
          pushDropError('LIVE 卡不能放入能量卡组');
          return;
        }
      }

      if (toZone === ZoneType.SUCCESS_ZONE && cardType !== CardType.LIVE) {
        pushDropError('只有 LIVE 卡可以放入成功 Live 卡区');
        return;
      }

      if (toZone === ZoneType.LIVE_ZONE && cardType !== CardType.LIVE && !isLiveSetHandPlacement) {
        pushDropError('只有 LIVE 卡可以自由拖入 Live 区');
        return;
      }

      // 成员卡移动限制：不能放入能量区和能量卡组
      if (cardType === CardType.MEMBER) {
        if (
          currentPhase === GamePhase.MAIN_PHASE &&
          fromZone === ZoneType.HAND &&
          toZone === ZoneType.LIVE_ZONE
        ) {
          pushDropError('主要阶段不能把成员卡从手牌拖到 Live 区');
          return;
        }
        if (toZone === ZoneType.ENERGY_ZONE) {
          pushDropError('成员卡不能放入能量区');
          return;
        }
        if (toZone === ZoneType.ENERGY_DECK) {
          pushDropError('成员卡不能放入能量卡组');
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
          pushDropError('当前落点不支持己方私有区拖拽');
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

      // 休息室成员卡拖到成员槽位仍走普通成员区移动规则；memberBelow 只由卡效创建。
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
      moveCardToInspection,
      reorderInspectedCard,
      drawEnergyToZone,
      setLiveCard,
      addLog,
      clearDragInteractionState,
      pushBattleFeedback,
      viewerSeat,
      getZoneCardIds,
      currentPhase,
      currentSubPhase,
      executeBattleActionPayload,
      findViewerCardZone,
      getDragBattleActionIntents,
      getKnownCardType,
      resolveCardDropTarget,
      getCardSlotPosition,
      isActiveEffectInspectionWindow,
      isReadOnly,
      matchView?.manualOperation?.mode,
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
  const isSolitaire = capabilities.isSolitairePresentation;
  const canShowBattleLeaveButton =
    capabilities.surface === 'LOCAL_DEBUG' ||
    capabilities.surface === 'SOLITAIRE' ||
    capabilities.surface === 'REMOTE_DEBUG';
  const showLeaveLocalGameButton = canShowBattleLeaveButton && Boolean(onLeaveLocalGame);
  const leaveLocalGameButtonTitle =
    capabilities.surface === 'REMOTE_DEBUG'
      ? '退出联机调试房间'
      : isSolitaire
        ? '退出对墙打房间'
        : '退出调试房间';
  const selfIdentity = getPlayerIdentityForSeat(selfSeat);
  const opponentIdentity = getPlayerIdentityForSeat(opponentSeat);
  const phaseInfo = getPhaseConfig(currentPhase)?.display;
  const subPhaseInfo =
    currentSubPhase !== SubPhase.NONE ? getSubPhaseConfig(currentSubPhase)?.display : null;
  const turnNumber = currentTurnCount ?? matchView.turnCount;
  const showMobileFreePlay = capabilities.showFreePlayControl;
  const primaryMobileLogPanel: MobileBattlePanel | null = canShowPublicBattleLog
    ? 'publicLog'
    : canShowDebugLog
      ? 'log'
      : null;
  const primaryMobileLogCount = canShowPublicBattleLog
    ? publicLogUnreadCount > 0
      ? publicLogUnreadCount
      : publicLogCount
    : logCount;
  const primaryMobileLogBadge =
    primaryMobileLogCount > 99 ? '99+' : primaryMobileLogCount.toString();
  const mobileActionCount =
    2 + (primaryMobileLogPanel ? 1 : 0) + (showMobileFreePlay ? 1 : 0) + (canShowUndo ? 1 : 0);
  const mobileActionGridClass =
    mobileActionCount >= 5
      ? 'grid-cols-5'
      : mobileActionCount === 4
        ? 'grid-cols-4'
        : mobileActionCount === 3
          ? 'grid-cols-3'
          : 'grid-cols-2';
  const freePlayControlTitle = pendingManualOperationRequest
    ? '正在等待自由模式请求回应'
    : manualOperation && !manualOperation.canSwitchNow
      ? (manualOperation.disabledReason ?? '当前不能切换操作模式')
      : freePlayEnabled
        ? '点击恢复规则模式'
        : capabilities.surface === 'ONLINE'
          ? '开启自由模式需要对方同意'
          : '点击开启自由模式';
  const manualOperationSwitchDisabled =
    !!pendingManualOperationRequest || manualOperation?.canSwitchNow === false;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={inspectionFirstCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDragInteractionState}
    >
      <div
        className="h-full flex flex-col relative overflow-hidden"
        onClick={handleBattlefieldBackgroundClick}
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
        <BattleAnimationLayer />
        <BattleActionFeedbackLayer />

        {isReadOnly && replaySession && (
          <div className="pointer-events-none fixed left-4 top-4 z-[130] max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_92%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl">
            <span className="text-[var(--accent-primary)]">
              {replaySession.sourceMatchMode === 'SOLITAIRE' ? '对墙打回放' : '历史回放'}
            </span>
            <span className="mx-1.5 text-[var(--text-muted)]">·</span>
            <span>checkpoint {replaySession.checkpointSeq}</span>
            <span className="mx-1.5 text-[var(--text-muted)]">·</span>
            <span className="text-[var(--text-muted)]">只读</span>
          </div>
        )}

        {isMobileBattlefield ? (
          <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden md:hidden">
            <div className="safe-top shrink-0 px-2.5 pt-2.5">
              <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--border-default)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_30%,transparent)] px-2.5 py-1.5 shadow-none backdrop-blur-[2px]">
                <div className="flex items-center justify-between gap-2">
                  {showLeaveLocalGameButton ? (
                    <button
                      type="button"
                      onClick={onLeaveLocalGame}
                      className="button-ghost inline-flex h-9 shrink-0 items-center justify-center gap-1.5 px-2.5 text-xs"
                      title={leaveLocalGameButtonTitle}
                    >
                      <DoorOpen size={15} />
                      离开
                    </button>
                  ) : (
                    <div className="h-9 w-9 shrink-0" />
                  )}

                  <div className="min-w-0 text-center">
                    <div className="truncate text-[13px] font-bold text-[var(--text-primary)]">
                      {phaseInfo?.name ?? currentPhase}阶段
                    </div>
                    <div className="truncate text-[10px] text-[var(--text-muted)]">
                      T{turnNumber}
                      {subPhaseInfo ? ` · ${subPhaseInfo.name}` : ''}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <ThemeToggle className="h-9 w-9" />
                  </div>
                </div>
              </div>

              <div className="mt-1.5 grid grid-cols-2 items-center gap-1.5 rounded-xl border border-[color:color-mix(in_srgb,var(--border-default)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_18%,transparent)] px-1.5 py-1.5 shadow-none backdrop-blur-[2px]">
                <button
                  type="button"
                  onClick={() => setMobilePanel('opponent')}
                  className={cn(
                    'flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition hover:border-[var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--bg-overlay)_42%,transparent)]',
                    resolvedActiveSeat === opponentSeat
                      ? 'border-rose-300/50 bg-rose-500/20 text-rose-100'
                      : 'border-transparent bg-[color:color-mix(in_srgb,var(--bg-overlay)_16%,transparent)] text-[var(--text-secondary)]'
                  )}
                  title={isSolitaire ? '查看对墙打对手战场' : '查看对手战场'}
                >
                  <UserRound size={14} className="shrink-0" />
                  <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--text-primary)]">
                    {opponentIdentity?.name ?? '对手'}
                  </span>
                  <span className="shrink-0 rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                    Live {opponentLiveScore}
                  </span>
                </button>
                <div
                  className={cn(
                    'flex min-w-0 items-center justify-end gap-1.5 rounded-lg border px-2 py-1.5',
                    resolvedActiveSeat === selfSeat
                      ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_45%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)]'
                      : 'border-transparent bg-[color:color-mix(in_srgb,var(--bg-overlay)_16%,transparent)]'
                  )}
                >
                  <span className="min-w-0 truncate text-right text-[11px] font-semibold text-[var(--text-primary)]">
                    {selfIdentity?.name ?? '己方'}
                  </span>
                  <span className="shrink-0 rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                    Live {viewerLiveScore}
                  </span>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 px-2 pb-32 pt-1.5">
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--border-default)_34%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_10%,transparent)] shadow-none">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <PlayerArea
                    playerSeat={selfSeat}
                    isOpponent={false}
                    isActive={resolvedActiveSeat === selfSeat}
                    suppressActiveEffectVisuals={isActiveEffectUiSuspended}
                    selectedHandCardActionCardId={selectedHandCardActionCardId}
                    selectedHandCardActions={selectedHandCardActions}
                    suppressSelectedHandCardActionMenu={
                      specialPlayTargetSelectionOpen || !!activeDoubleRelaySelection
                    }
                    onSelectedHandCardAction={handleSelectedHandCardAction}
                  />
                </div>
              </div>
            </div>

            <div
              className={cn(
                'safe-bottom fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[65] grid gap-1.5 md:hidden',
                mobileActionGridClass
              )}
            >
              <button
                type="button"
                onClick={() => setMobilePanel('opponent')}
                className="relative inline-flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_28%,transparent)] px-1.5 py-1.5 text-[10px] font-semibold text-[var(--text-secondary)] shadow-none backdrop-blur-[2px] transition hover:border-[var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--bg-frosted)_42%,transparent)] hover:text-[var(--text-primary)]"
                title={isSolitaire ? '查看对墙打对手战场' : '查看对手战场'}
              >
                <Swords size={16} />
                <span className="truncate">对手</span>
              </button>

              {primaryMobileLogPanel && (
                <button
                  type="button"
                  onClick={() => setMobilePanel(primaryMobileLogPanel)}
                  className="relative inline-flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_28%,transparent)] px-1.5 py-1.5 text-[10px] font-semibold text-[var(--text-secondary)] shadow-none backdrop-blur-[2px] transition hover:border-[var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--bg-frosted)_42%,transparent)] hover:text-[var(--text-primary)]"
                  title={canShowPublicBattleLog ? '查看公开对局日志' : '查看调试日志'}
                >
                  <ScrollText size={16} />
                  <span className="truncate">{canShowPublicBattleLog ? '对局' : '日志'}</span>
                  {primaryMobileLogCount > 0 && (
                    <span className="absolute right-1 top-1 min-w-4 rounded-full bg-[var(--accent-primary)] px-1 text-[10px] leading-4 text-white shadow-[var(--shadow-sm)]">
                      {primaryMobileLogBadge}
                    </span>
                  )}
                </button>
              )}

              {showMobileFreePlay && (
                <button
                  type="button"
                  onClick={() => setFreePlayEnabled(!freePlayEnabled)}
                  disabled={manualOperationSwitchDisabled}
                  aria-pressed={freePlayEnabled}
                  className={cn(
                    'relative inline-flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-1.5 text-[10px] font-semibold shadow-none backdrop-blur-[2px] transition',
                    freePlayEnabled
                      ? 'border-[color:color-mix(in_srgb,var(--semantic-warning)_68%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_20%,var(--bg-frosted))] text-[var(--semantic-warning)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--semantic-warning)_22%,transparent),0_0_18px_color-mix(in_srgb,var(--semantic-warning)_20%,transparent)]'
                      : 'border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_28%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--bg-frosted)_42%,transparent)] hover:text-[var(--text-primary)]'
                  )}
                  title={freePlayControlTitle}
                >
                  <Zap size={16} className={cn(freePlayEnabled && 'fill-current')} />
                  <span className="truncate">{freePlayEnabled ? '自由' : '规则'}</span>
                </button>
              )}

              {canShowUndo && (
                <button
                  type="button"
                  onClick={undoLastStep}
                  disabled={!canUndoLastStep}
                  className={cn(
                    'relative inline-flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_28%,transparent)] px-1.5 py-1.5 text-[10px] font-semibold text-[var(--text-secondary)] shadow-none backdrop-blur-[2px] transition hover:border-[var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--bg-frosted)_42%,transparent)] hover:text-[var(--text-primary)]',
                    !canUndoLastStep &&
                      'cursor-not-allowed opacity-50 hover:border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--bg-frosted)_28%,transparent)] hover:text-[var(--text-secondary)]'
                  )}
                  title={undoButtonLabel}
                >
                  <Undo2 size={16} />
                  <span className="truncate">{mobileUndoButtonLabel}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleOpenJudgmentPanel}
                disabled={!isJudgmentPanelRelevant}
                className={cn(
                  'relative inline-flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_28%,transparent)] px-1.5 py-1.5 text-[10px] font-semibold text-[var(--text-secondary)] shadow-none backdrop-blur-[2px] transition hover:border-[var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--bg-frosted)_42%,transparent)] hover:text-[var(--text-primary)]',
                  isJudgmentPanelRelevant &&
                    'border-[color:color-mix(in_srgb,var(--accent-primary)_45%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,var(--bg-frosted))] text-[var(--accent-primary)]',
                  !isJudgmentPanelRelevant &&
                    'cursor-not-allowed opacity-50 hover:border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--bg-frosted)_28%,transparent)] hover:text-[var(--text-secondary)]'
                )}
                title={isJudgmentPanelRelevant ? '打开判定区' : '当前没有可打开的判定区'}
              >
                <ChevronRight size={16} />
                <span className="truncate">判定</span>
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
                    className="safe-bottom fixed inset-x-0 bottom-0 z-[90] flex max-h-[var(--battle-viewport-height-82)] min-h-[var(--battle-viewport-height-52)] flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] md:hidden"
                  >
                    <div className="shrink-0 px-4 pb-2 pt-3">
                      <div className="mb-3 flex justify-center">
                        <div className="h-1.5 w-12 rounded-full bg-[var(--border-default)]" />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[var(--text-primary)]">
                            {mobilePanel === 'opponent'
                              ? '对手战场'
                              : mobilePanel === 'publicLog'
                                ? '对局日志'
                                : '调试日志'}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                            {mobilePanel === 'opponent'
                              ? (opponentIdentity?.name ?? opponentSeat)
                              : mobilePanel === 'publicLog'
                                ? `${publicLogCount} 条公开事件`
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
                            suppressActiveEffectVisuals={isActiveEffectUiSuspended}
                          />
                        </div>
                      </div>
                    ) : mobilePanel === 'publicLog' ? (
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-3">
                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
                          <PublicBattleLogContent active={mobilePanel === 'publicLog'} />
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

            {(showLeaveLocalGameButton || canShowDesktopPublicBattleLogButton) && (
              <div className="absolute left-4 top-4 z-[120] flex items-center gap-3">
                {showLeaveLocalGameButton && (
                  <button
                    type="button"
                    onClick={onLeaveLocalGame}
                    className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-4 shadow-[var(--shadow-md)] backdrop-blur-xl"
                    title={leaveLocalGameButtonTitle}
                  >
                    <DoorOpen size={16} />
                    离开房间
                  </button>
                )}
                {canShowDesktopPublicBattleLogButton && <PublicBattleLogButton />}
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
                suppressActiveEffectVisuals={isActiveEffectUiSuspended}
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
                suppressActiveEffectVisuals={isActiveEffectUiSuspended}
                selectedHandCardActionCardId={selectedHandCardActionCardId}
                selectedHandCardActions={selectedHandCardActions}
                suppressSelectedHandCardActionMenu={
                  specialPlayTargetSelectionOpen || !!activeDoubleRelaySelection
                }
                onSelectedHandCardAction={handleSelectedHandCardAction}
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

        {specialPlayTargetSelectionOpen && (
          <>
            <button
              type="button"
              aria-label="取消特殊登场"
              className="modal-backdrop fixed inset-0 z-[93]"
              onClick={() => setSpecialPlayTargetSelectionCardId(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="选择特殊登场区域"
              className="pointer-events-auto fixed left-1/2 top-1/2 z-[94] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_97%,transparent)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                特殊登场
              </div>
              <div className="mt-1 text-sm font-semibold">
                {selectedCardPresentation
                  ? formatCardCompactLabel(selectedCardPresentation.cardData as AnyCardData)
                  : '成员登场'}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                选择登场区域，随后选择 3 名指定成员放入休息室。
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {MEMBER_SLOT_ORDER.map((slot) => {
                  const enabled = specialPlayTargetSlots.includes(slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={!enabled}
                      onClick={() => handleBeginSpecialPlayAtSlot(slot)}
                      className={cn(
                        'button-secondary inline-flex min-h-11 items-center justify-center px-2 text-sm font-semibold',
                        !enabled && 'cursor-not-allowed opacity-40'
                      )}
                    >
                      {MEMBER_SLOT_LABELS[slot]}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSpecialPlayTargetSelectionCardId(null)}
                  className="button-secondary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold"
                >
                  取消
                </button>
              </div>
            </div>
          </>
        )}

        {activeDoubleRelaySelection && (
          <>
            <button
              type="button"
              aria-label="取消双换手"
              className="modal-backdrop fixed inset-0 z-[93]"
              onClick={() => setDoubleRelaySelection(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="选择双换手区域"
              className="pointer-events-auto fixed left-1/2 top-1/2 z-[94] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_97%,transparent)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                双换手
              </div>
              <div className="mt-1 text-sm font-semibold">
                {selectedCardPresentation
                  ? formatCardCompactLabel(selectedCardPresentation.cardData as AnyCardData)
                  : '成员登场'}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                依次选择两个成员区。第 1 个是登场位置，第 2 个是追加换手位置。
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {MEMBER_SLOT_ORDER.map((slot) => {
                  const isAvailable = viewerOccupiedMemberSlots.some(
                    (entry) => entry.slot === slot
                  );
                  const selectedOrderIndex = doubleRelaySelectedSlots.indexOf(slot);
                  const isSelected = selectedOrderIndex >= 0;
                  const isDisabled =
                    !isAvailable || (!isSelected && doubleRelaySelectedSlots.length >= 2);
                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => handleSelectDoubleRelaySlot(slot)}
                      className={cn(
                        'button-secondary relative inline-flex min-h-11 items-center justify-center px-2 text-sm font-semibold',
                        isSelected &&
                          'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)]',
                        isDisabled && 'cursor-not-allowed opacity-40'
                      )}
                    >
                      {MEMBER_SLOT_LABELS[slot]}
                      {isSelected && (
                        <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[10px] font-bold text-white">
                          {selectedOrderIndex + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setDoubleRelaySelection(null)}
                  className="button-secondary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!canConfirmDoubleRelay}
                  onClick={handleConfirmDoubleRelay}
                  className={cn(
                    'button-primary inline-flex min-h-10 items-center justify-center gap-1.5 px-4 text-sm font-semibold',
                    !canConfirmDoubleRelay && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <Repeat2 className="h-4 w-4" aria-hidden="true" />
                  双换手登场
                </button>
              </div>
            </div>
          </>
        )}

        {showSuccessLiveSelectionModal && successLiveSelectionCollapsed && (
          <div
            data-battle-animation-ignore="true"
            className="pointer-events-auto fixed bottom-4 left-4 right-4 z-[94] rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] p-3 text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl sm:left-auto sm:w-[min(420px,calc(100vw-2rem))]"
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                  成功 Live
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold">
                  选择放置入成功 LIVE 卡区的 Live
                </div>
                <div className="mt-1 line-clamp-1 text-xs text-[var(--text-secondary)]">
                  {successLiveSelectionCardIds.length} 张候选
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSuccessLiveSelectionCollapsed(false)}
                className="button-primary inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 px-3 text-xs font-semibold"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
                展开
              </button>
            </div>
          </div>
        )}

        {showSuccessLiveSelectionModal && !successLiveSelectionCollapsed && (
          <div
            data-battle-animation-ignore="true"
            className="pointer-events-auto fixed left-1/2 top-1/2 z-[94] w-[min(94vw,760px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                  成功 Live
                </div>
                <div className="mt-1 text-sm font-semibold">选择放置入成功 LIVE 卡区的 Live</div>
              </div>
              <button
                type="button"
                onClick={() => setSuccessLiveSelectionCollapsed(true)}
                className="button-secondary inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 px-2 text-xs font-semibold"
              >
                <EyeOff className="h-4 w-4" aria-hidden="true" />
                隐藏
              </button>
            </div>
            <div className="grid max-h-[var(--battle-viewport-height-52)] grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-3 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_54%,transparent)] p-3">
              {successLiveSelectionCardIds.map((cardId) => {
                const presentation = getVisibleCardPresentation(cardId);
                const cardData = presentation?.cardData;
                const label = cardData
                  ? formatCardCompactLabel(cardData as AnyCardData)
                  : '选择此卡';
                return (
                  <button
                    key={cardId}
                    type="button"
                    disabled={!presentation}
                    onClick={() => {
                      setHoveredCard(null);
                      selectSuccessCard(cardId);
                    }}
                    className={cn(
                      'group flex min-w-0 flex-col items-center gap-1 rounded-lg border border-transparent p-1.5 transition-colors',
                      presentation
                        ? 'hover:border-[var(--border-active)] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)]'
                        : 'cursor-not-allowed opacity-50'
                    )}
                    title={label}
                  >
                    {presentation ? (
                      <CardDetailPressTarget
                        cardId={presentation.instanceId}
                        title={label}
                        className="flex justify-center"
                      >
                        <Card
                          cardData={presentation.cardData as AnyCardData}
                          instanceId={presentation.instanceId}
                          imagePath={presentation.imagePath}
                          size="sm"
                          faceUp={true}
                          showHover={false}
                          className="shadow-sm transition-transform group-hover:scale-[1.02]"
                        />
                      </CardDetailPressTarget>
                    ) : (
                      <div className="flex aspect-[2/3] w-full items-center justify-center rounded-md border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-tertiary)]">
                        不可见
                      </div>
                    )}
                    <span className="line-clamp-2 min-h-8 text-center text-[11px] leading-4 text-[var(--text-secondary)]">
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
            {successLiveSelection?.canSkipToWaitingRoom === true && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => skipSuccessLiveSelection()}
                  className="button-secondary inline-flex min-h-9 items-center justify-center gap-1.5 px-3 text-xs font-semibold"
                >
                  <DoorOpen className="h-4 w-4" aria-hidden="true" />
                  全部放置入休息室
                </button>
              </div>
            )}
          </div>
        )}

        {!isActiveEffectUiSuspended && activeEffect && activeEffectCollapsed && (
          <div
            data-battle-animation-ignore="true"
            className="pointer-events-auto fixed bottom-4 left-4 right-4 z-[95] rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] p-3 text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl sm:left-auto sm:w-[min(420px,calc(100vw-2rem))]"
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                  处理中
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold">{activeEffectTitle}</div>
                <div className="mt-1 line-clamp-1 text-xs text-[var(--text-secondary)]">
                  {isActiveEffectOrderSelectionWindow
                    ? activeEffectDescription
                    : activeEffectInspectionCount > 0
                      ? `检视区 ${activeEffectInspectionCount} 张 / ${activeEffect.stepText}`
                      : activeEffect.stepText}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveEffectCollapsed(false)}
                className="button-primary inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 px-3 text-xs font-semibold"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
                展开效果
              </button>
            </div>
          </div>
        )}

        {!isActiveEffectUiSuspended && activeEffect && !activeEffectCollapsed && (
          <div
            data-battle-animation-ignore="true"
            className="pointer-events-auto fixed inset-x-2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] top-[max(0.75rem,env(safe-area-inset-top))] z-[95] flex items-end justify-center sm:inset-x-4 md:left-1/2 md:right-auto md:top-1/2 md:bottom-auto md:w-[min(94vw,900px)] md:-translate-x-1/2 md:-translate-y-1/2"
          >
            <motion.div
              className="flex max-h-[calc(var(--battle-viewport-height)_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1.5rem)] w-full flex-col overflow-hidden rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl md:max-h-[88vh] md:p-4"
              initial={{ opacity: 0, y: 12, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.99 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-3 md:mb-3 md:border-b-0 md:p-0">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                    处理中的效果
                  </div>
                  <div className="mt-1 text-sm font-semibold">{activeEffectTitle}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                    {activeEffectBadgeLabel}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveEffectCollapsed(true)}
                    className="button-secondary inline-flex min-h-8 items-center justify-center gap-1.5 px-2 text-xs font-semibold"
                  >
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                    隐藏
                  </button>
                </div>
              </div>
              <div className="touch-scroll cute-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-0 md:py-0">
                <div className="rounded border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] p-2.5 md:p-3">
                  <CardEffectText
                    text={activeEffectDescription}
                    className="text-[13px] leading-relaxed md:text-sm"
                  />
                  {!isActiveEffectOrderSelectionWindow && activeEffectChoice && (
                    <EffectChoicePanel
                      activeEffect={activeEffect}
                      selectedOptionIds={normalizedActiveEffectChoiceSelection}
                      canChoose={
                        canConfirmActiveEffect &&
                        !isPublicEffectChoiceAutoAdvance &&
                        (!activeEffectUsesCardOptionSelection || !!activeEffectSelectedCardId)
                      }
                      canConfirmMulti={canConfirmActiveEffectChoice}
                      onSelectSingle={(optionId) =>
                        confirmEffectChoice(activeEffect.id, {
                          selectedCardId: activeEffectUsesCardOptionSelection
                            ? activeEffectSelectedCardId
                            : undefined,
                          selectedEffectOptionIds: [optionId],
                        })
                      }
                      onToggleMulti={(optionId) =>
                        setActiveEffectChoiceSelection((current) => [
                          ...toggleEffectChoiceSelection(activeEffectChoice, current, optionId),
                        ])
                      }
                      onConfirmMulti={() =>
                        confirmEffectChoice(activeEffect.id, {
                          selectedCardId: activeEffectUsesCardOptionSelection
                            ? activeEffectSelectedCardId
                            : undefined,
                          selectedEffectOptionIds: normalizedActiveEffectChoiceSelection,
                        })
                      }
                      onSkip={() => confirmEffectStep(activeEffect.id, null)}
                    />
                  )}
                  {!isActiveEffectOrderSelectionWindow && hasActiveEffectOriginalText && (
                    <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 md:pt-3">
                      <button
                        type="button"
                        onClick={() => setActiveEffectOriginalTextExpanded((expanded) => !expanded)}
                        className="button-secondary inline-flex min-h-8 items-center justify-center px-2.5 text-xs font-semibold"
                      >
                        {activeEffectOriginalTextExpanded ? '收起原卡文' : '查看原卡文'}
                      </button>
                      {activeEffectOriginalTextExpanded && (
                        <div className="mt-3 space-y-3">
                          <div className="text-[10px] font-semibold text-[var(--text-muted)]">
                            原卡文
                          </div>
                          {activeEffectOriginalTextCn && (
                            <div>
                              <div className="mb-1 text-[10px] font-semibold text-[var(--text-muted)]">
                                中文
                              </div>
                              <CardEffectText
                                text={activeEffectOriginalTextCn}
                                className="text-xs leading-relaxed text-[var(--text-secondary)]"
                              />
                            </div>
                          )}
                          {activeEffectOriginalTextJp && (
                            <div>
                              <div className="mb-1 text-[10px] font-semibold text-[var(--text-muted)]">
                                日文
                              </div>
                              <CardEffectText
                                text={activeEffectOriginalTextJp}
                                className="text-xs leading-relaxed text-[var(--text-secondary)]"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {activeEffectStageFormation && (
                  <div className="mt-3 md:mt-4">
                    <div className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
                      站位变换
                    </div>
                    <div className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_54%,transparent)] p-2 md:grid-cols-3 md:gap-3 md:p-3">
                      {MEMBER_SLOT_ORDER.map((slot) => {
                        const entry = stageFormationDraftSlots.find(
                          (candidate) => candidate.slot === slot
                        );
                        const cardId = entry?.cardId ?? null;
                        const presentation = cardId ? getVisibleCardPresentation(cardId) : null;
                        const cardData = presentation?.cardData;
                        const isSelected =
                          cardId !== null && cardId === selectedStageFormationCardId;
                        const label = cardData
                          ? formatCardCompactLabel(cardData as AnyCardData)
                          : '空位';
                        return (
                          <button
                            key={slot}
                            type="button"
                            disabled={!canConfirmActiveEffect}
                            aria-pressed={isSelected}
                            onClick={() => handleStageFormationSlotClick(slot)}
                            className={cn(
                              'grid min-h-[76px] min-w-0 grid-cols-[52px_minmax(0,1fr)] items-center gap-x-2 rounded-lg border p-2 text-left transition-colors md:flex md:min-h-[188px] md:flex-col md:items-center md:justify-between md:gap-2',
                              isSelected
                                ? 'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)]'
                                : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_70%,transparent)]',
                              canConfirmActiveEffect
                                ? 'hover:border-[var(--border-active)] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)]'
                                : 'cursor-not-allowed opacity-50'
                            )}
                            title={`${MEMBER_SLOT_LABELS[slot]}: ${label}`}
                          >
                            <div className="order-2 flex w-full min-w-0 items-center justify-between gap-2 md:order-none">
                              <span className="text-xs font-bold text-[var(--text-primary)]">
                                {MEMBER_SLOT_LABELS[slot]}
                              </span>
                              {entry?.originalSlot && cardId && (
                                <span className="rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                                  原{MEMBER_SLOT_LABELS[entry.originalSlot].replace('侧', '')}
                                </span>
                              )}
                            </div>
                            {presentation ? (
                              <CardDetailPressTarget
                                cardId={presentation.instanceId}
                                title={label}
                                className="order-1 row-span-2 flex justify-center md:order-none md:row-span-1"
                              >
                                <Card
                                  cardData={presentation.cardData as AnyCardData}
                                  instanceId={presentation.instanceId}
                                  imagePath={presentation.imagePath}
                                  size="sm"
                                  faceUp={true}
                                  showHover={false}
                                  className="h-[73px] w-[52px] shadow-sm md:h-[105px] md:w-[75px]"
                                />
                              </CardDetailPressTarget>
                            ) : (
                              <div className="order-1 row-span-2 flex h-[73px] w-[52px] items-center justify-center rounded-md border border-dashed border-[var(--border-default)] text-xs font-semibold text-[var(--text-tertiary)] md:order-none md:row-span-1 md:h-[112px] md:w-[80px]">
                                空
                              </div>
                            )}
                            <div className="order-3 w-full min-w-0 md:order-none">
                              <div className="line-clamp-1 text-left text-[11px] font-semibold leading-4 text-[var(--text-primary)] md:line-clamp-2 md:min-h-8 md:text-center">
                                {label}
                              </div>
                              <div className="mt-1 flex justify-start gap-1 text-[10px] text-[var(--text-secondary)] md:justify-center">
                                <span>能量 {entry?.energyBelowCount ?? 0}</span>
                                <span>下方 {entry?.memberBelowCount ?? 0}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {isPublicCardSelectionAutoAdvance && (
                  <div className="mt-3 md:mt-4">
                    <div className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
                      本次公开的选择
                    </div>
                    <div className="rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,var(--bg-surface))] p-3">
                      <div className="flex items-center gap-3 overflow-x-auto pb-1">
                        <div className="flex shrink-0 flex-col items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-[var(--text-muted)]">
                            发动效果的卡牌
                          </span>
                          {activeEffectSource ? (
                            <CardDetailPressTarget
                              cardId={activeEffectSource.instanceId}
                              title={activeEffectSourceLabel}
                              className="flex flex-col items-center gap-1"
                            >
                              <Card
                                cardData={activeEffectSource.cardData as AnyCardData}
                                instanceId={activeEffectSource.instanceId}
                                imagePath={activeEffectSource.imagePath}
                                size="sm"
                                faceUp={true}
                                showHover={false}
                                className="h-[105px] w-[75px]"
                              />
                              <span className="line-clamp-2 w-24 text-center text-[10px] font-semibold leading-tight text-[var(--text-secondary)]">
                                {activeEffectSourceLabel}
                              </span>
                            </CardDetailPressTarget>
                          ) : (
                            <div className="flex h-[105px] w-[75px] items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-[10px] text-[var(--text-muted)]">
                              ?
                            </div>
                          )}
                        </div>
                        <ChevronRight
                          className="h-8 w-8 shrink-0 text-[var(--accent-primary)]"
                          aria-label="选择"
                        />
                        <div className="flex shrink-0 items-start gap-2">
                          {publicCardSelectionDisplayEntries.map((entry) => {
                            const presentation = getVisibleCardPresentation(entry.cardId);
                            const cardData = presentation?.cardData;
                            const label = cardData
                              ? formatCardCompactLabel(cardData as AnyCardData)
                              : '已选择的卡牌';
                            return (
                              <CardDetailPressTarget
                                key={entry.cardId}
                                cardId={presentation?.instanceId ?? null}
                                disabled={!presentation}
                                title={label}
                                className="relative flex w-24 shrink-0 flex-col items-center gap-1"
                              >
                                {entry.order !== null && (
                                  <span className="absolute right-1 top-5 z-10 flex h-6 min-w-6 items-center justify-center rounded-full border border-white/70 bg-[var(--accent-primary)] px-1 text-[11px] font-bold text-white shadow">
                                    {entry.order}
                                  </span>
                                )}
                                <span className="text-[10px] font-semibold text-[var(--text-muted)]">
                                  {entry.order === null ? '选择的卡牌' : `第 ${entry.order} 张`}
                                </span>
                                {presentation ? (
                                  <Card
                                    cardData={presentation.cardData as AnyCardData}
                                    instanceId={presentation.instanceId}
                                    imagePath={presentation.imagePath}
                                    size="sm"
                                    faceUp={true}
                                    showHover={false}
                                    className="h-[105px] w-[75px]"
                                  />
                                ) : (
                                  <div className="flex h-[105px] w-[75px] items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-[10px] text-[var(--text-muted)]">
                                    ?
                                  </div>
                                )}
                                <span className="line-clamp-2 min-h-[2.4em] text-center text-[10px] font-semibold leading-tight text-[var(--text-secondary)]">
                                  {label}
                                </span>
                              </CardDetailPressTarget>
                            );
                          })}
                        </div>
                      </div>
                      <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                        <div className="h-full w-full animate-pulse rounded-full bg-[var(--accent-primary)]" />
                      </div>
                      <div className="mt-1.5 text-center text-[11px] font-semibold text-[var(--text-secondary)]">
                        即将自动继续处理
                      </div>
                    </div>
                  </div>
                )}
                {!isPublicCardSelectionAutoAdvance && activeEffectRevealedCardIds.length > 0 && (
                  <div className="mt-3 md:mt-4">
                    <div className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
                      已公开的卡牌
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_54%,transparent)] p-2 md:max-h-[32vh] md:grid-cols-[repeat(auto-fill,minmax(76px,1fr))] md:gap-3 md:overflow-y-auto md:p-3">
                      {activeEffectRevealedCardIds.map((cardId) => {
                        const presentation = getVisibleCardPresentation(cardId);
                        const cardData = presentation?.cardData;
                        const label = cardData
                          ? formatCardCompactLabel(cardData as AnyCardData)
                          : '已公开卡牌';

                        return (
                          <CardDetailPressTarget
                            key={cardId}
                            cardId={presentation?.instanceId ?? null}
                            disabled={!presentation}
                            title={label}
                            className="flex min-w-0 flex-col items-center gap-1 rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] p-1.5"
                          >
                            {presentation ? (
                              <Card
                                cardData={presentation.cardData as AnyCardData}
                                instanceId={presentation.instanceId}
                                imagePath={presentation.imagePath}
                                size="sm"
                                faceUp={true}
                                showHover={false}
                                className="h-[90px] w-[64px] md:h-[105px] md:w-[75px]"
                              />
                            ) : (
                              <div className="flex h-[90px] w-[64px] items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-[10px] text-[var(--text-muted)] md:h-[84px] md:w-[60px]">
                                ?
                              </div>
                            )}
                            <span className="line-clamp-2 min-h-[2.4em] text-center text-[10px] font-semibold leading-tight text-[var(--text-secondary)]">
                              {label}
                            </span>
                          </CardDetailPressTarget>
                        );
                      })}
                    </div>
                  </div>
                )}
                {activeEffectSelectableCardIds.length > 0 && (
                  <div className="mt-3 md:mt-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                      <CardEffectText as="span" text={activeEffectSelectionLabel} />
                      <span className="rounded border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_76%,transparent)] px-2 py-1 text-[11px] text-[var(--text-primary)]">
                        {activeEffectSelectableBadgeLabel}
                      </span>
                    </div>
                    <div
                      className={cn(
                        'grid gap-2 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_54%,transparent)] p-2 md:max-h-[46vh] md:gap-3 md:overflow-y-auto md:p-3',
                        activeEffectHasEnergyCandidates
                          ? 'grid-cols-[repeat(auto-fill,minmax(90px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(105px,1fr))]'
                          : 'grid-cols-[repeat(auto-fill,minmax(64px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(76px,1fr))]'
                      )}
                    >
                      {activeEffectSelectableCardIds.map((cardId, candidateIndex) => {
                        const presentation = getVisibleCardPresentation(cardId);
                        const cardData = presentation?.cardData;
                        const candidateObjectId =
                          activeEffect?.selectableObjectIds?.[candidateIndex];
                        const candidateObject = candidateObjectId
                          ? playerViewState?.objects[candidateObjectId]
                          : undefined;
                        const isEnergyCandidate = cardData?.cardType === CardType.ENERGY;
                        const isWaitingEnergy =
                          isEnergyCandidate &&
                          candidateObject?.orientation === OrientationState.WAITING;
                        const skipsNextActivePhase = candidateObject?.skipsNextActivePhase === true;
                        const candidateCanBeSelected =
                          activeEffectSelectableObjectsFaceDown || presentation !== null;
                        const selectedOrderIndex = activeEffectOrderedSelection.indexOf(cardId);
                        const isOrderedSelected = selectedOrderIndex >= 0;
                        const isSingleSelected = activeEffectSelectedCardId === cardId;
                        const label = activeEffectSelectableObjectsFaceDown
                          ? `第${candidateIndex + 1}张手牌`
                          : cardData
                            ? formatActiveEffectCardCompactLabel(cardId, cardData as AnyCardData)
                            : '选择此卡';
                        const energyStatusLabel = isEnergyCandidate
                          ? `；当前状态：${isWaitingEnergy ? '等待' : '活跃'}`
                          : '';
                        const candidateTitle = `${label}${energyStatusLabel}${
                          skipsNextActivePhase ? '；下次活跃阶段不会自动变为活跃' : ''
                        }`;
                        if (isReadOnly) {
                          return (
                            <CardDetailPressTarget
                              key={cardId}
                              cardId={
                                activeEffectSelectableObjectsFaceDown
                                  ? null
                                  : (presentation?.instanceId ?? null)
                              }
                              disabled={activeEffectSelectableObjectsFaceDown || !presentation}
                              title={candidateTitle}
                              className="flex min-w-0 flex-col items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_70%,transparent)] p-1.5"
                            >
                              {activeEffectSelectableObjectsFaceDown ? (
                                <div className="h-[90px] w-[64px] overflow-hidden rounded-lg shadow md:h-[105px] md:w-[75px]">
                                  <img
                                    src="/back.jpg"
                                    alt="不可见的手牌"
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                              ) : presentation ? (
                                <div
                                  className={cn(
                                    'h-[90px] w-[64px] rounded-lg transition-transform md:h-[105px] md:w-[75px]',
                                    isWaitingEnergy && 'rotate-90',
                                    skipsNextActivePhase &&
                                      'ring-2 ring-red-500 ring-offset-2 ring-offset-[var(--bg-surface)]'
                                  )}
                                >
                                  <Card
                                    cardData={presentation.cardData as AnyCardData}
                                    instanceId={presentation.instanceId}
                                    imagePath={presentation.imagePath}
                                    size="sm"
                                    faceUp={true}
                                    showHover={false}
                                    className={cn(
                                      'h-full w-full transition-[filter,opacity]',
                                      isWaitingEnergy && 'opacity-60 grayscale'
                                    )}
                                  />
                                </div>
                              ) : (
                                <div className="flex h-[90px] w-[64px] items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-[10px] text-[var(--text-muted)] md:h-[84px] md:w-[60px]">
                                  ?
                                </div>
                              )}
                              <span className="line-clamp-2 min-h-[2.4em] text-center text-[10px] font-semibold leading-tight text-[var(--text-secondary)]">
                                {label}
                              </span>
                            </CardDetailPressTarget>
                          );
                        }
                        return (
                          <button
                            key={cardId}
                            type="button"
                            disabled={!canConfirmActiveEffect || !candidateCanBeSelected}
                            onClick={() => {
                              setHoveredCard(null);
                              if (activeEffectUsesOrderedMultiSelect) {
                                setActiveEffectOrderedSelection((current) => {
                                  const currentSelectable = current.filter((selectedId) =>
                                    activeEffectSelectableCardIds.includes(selectedId)
                                  );
                                  if (currentSelectable.includes(cardId)) {
                                    return currentSelectable.filter(
                                      (selectedId) => selectedId !== cardId
                                    );
                                  }
                                  if (currentSelectable.length >= activeEffectMaxSelectableCards) {
                                    return currentSelectable;
                                  }
                                  return [...currentSelectable, cardId];
                                });
                                return;
                              }
                              if (activeEffectUsesCardOptionSelection) {
                                setActiveEffectSingleSelection((current) =>
                                  current === cardId ? null : cardId
                                );
                                return;
                              }
                              confirmEffectStep(activeEffect.id, cardId);
                            }}
                            className={`group relative flex min-w-0 flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors ${
                              isOrderedSelected || isSingleSelected
                                ? 'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)]'
                                : 'border-transparent'
                            } ${
                              canConfirmActiveEffect && candidateCanBeSelected
                                ? 'hover:border-[var(--border-active)] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)]'
                                : 'cursor-not-allowed opacity-50'
                            }`}
                            title={candidateTitle}
                          >
                            {isOrderedSelected && (
                              <span className="absolute right-1 top-1 z-10 flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--border-active)] bg-[var(--accent-primary)] px-1 text-[11px] font-bold text-white shadow">
                                {selectedOrderIndex + 1}
                              </span>
                            )}
                            {isSingleSelected && (
                              <span className="absolute right-1 top-1 z-10 flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--border-active)] bg-[var(--accent-primary)] px-1 text-white shadow">
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              </span>
                            )}
                            {activeEffectSelectableObjectsFaceDown ? (
                              <div className="h-[90px] w-[64px] overflow-hidden rounded-lg shadow md:h-[105px] md:w-[75px]">
                                <img
                                  src="/back.jpg"
                                  alt="不可见的手牌"
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            ) : presentation ? (
                              <CardDetailPressTarget
                                cardId={presentation.instanceId}
                                className="flex h-[90px] w-[90px] items-center justify-center md:h-[105px] md:w-[105px]"
                                title={candidateTitle}
                              >
                                <div
                                  className={cn(
                                    'h-[90px] w-[64px] rounded-lg transition-transform md:h-[105px] md:w-[75px]',
                                    isWaitingEnergy && 'rotate-90',
                                    skipsNextActivePhase &&
                                      'ring-2 ring-red-500 ring-offset-2 ring-offset-[var(--bg-surface)]'
                                  )}
                                >
                                  <Card
                                    cardData={presentation.cardData as AnyCardData}
                                    instanceId={presentation.instanceId}
                                    imagePath={presentation.imagePath}
                                    size="sm"
                                    faceUp={true}
                                    showHover={false}
                                    className={cn(
                                      'h-full w-full transition-[filter,opacity]',
                                      isWaitingEnergy && 'opacity-60 grayscale'
                                    )}
                                  />
                                </div>
                              </CardDetailPressTarget>
                            ) : (
                              <div className="flex h-[90px] w-[64px] items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-[10px] text-[var(--text-muted)] md:h-[84px] md:w-[60px]">
                                ?
                              </div>
                            )}
                            <span className="line-clamp-2 min-h-[2.4em] text-center text-[10px] font-semibold leading-tight text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                              {label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div
                className={cn(
                  'flex shrink-0 gap-2 border-t border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] p-3 md:mt-4 md:border-t-0 md:bg-transparent md:p-0',
                  isActiveEffectOrderSelectionWindow
                    ? 'flex-col items-stretch justify-start'
                    : 'flex-wrap justify-end',
                  isReadOnly && 'hidden'
                )}
              >
                {isPublicCardSelectionAutoAdvance && publicSelectionFallbackReady && (
                  <button
                    type="button"
                    disabled={isReadOnly || !canConfirmEffectCommand}
                    onClick={() =>
                      autoAdvancePublicCardSelection(
                        activeEffect.id,
                        activeEffect.publicCardSelectionAutoAdvanceAt
                      )
                    }
                    className="button-secondary inline-flex min-h-10 items-center justify-center px-3 text-sm font-semibold"
                  >
                    继续处理
                  </button>
                )}
                {isPublicEffectChoiceAutoAdvance && publicEffectChoiceFallbackReady && (
                  <button
                    type="button"
                    disabled={isReadOnly || !canConfirmEffectCommand}
                    onClick={() =>
                      autoAdvancePublicEffectChoice(
                        activeEffect.id,
                        activeEffect.publicEffectChoiceAutoAdvanceAt
                      )
                    }
                    className="button-secondary inline-flex min-h-10 items-center justify-center px-3 text-sm font-semibold"
                  >
                    继续处理
                  </button>
                )}
                {showLegacyActiveEffectControls && activeEffectStageFormation && (
                  <button
                    type="button"
                    disabled={!canConfirmActiveEffect}
                    onClick={handleConfirmStageFormation}
                    className={`button-primary inline-flex min-h-10 items-center justify-center gap-1.5 px-4 text-sm font-semibold ${
                      canConfirmActiveEffect ? '' : 'cursor-not-allowed opacity-50'
                    }`}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    确认站位
                  </button>
                )}
                {showLegacyActiveEffectControls &&
                  activeEffectSelectableSlots.map((slot) => {
                    const slotLabel =
                      slot === SlotPosition.LEFT
                        ? '左侧'
                        : slot === SlotPosition.CENTER
                          ? '中央'
                          : '右侧';
                    const slotActionLabel =
                      activeEffect.confirmSelectionLabel === '登场' ? '登场至' : '移动到';
                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={!canConfirmActiveEffect}
                        onClick={() =>
                          confirmEffectStep(activeEffect.id, undefined, slot as SlotPosition)
                        }
                        className={`button-secondary inline-flex min-h-10 items-center justify-center px-3 text-sm font-semibold ${
                          canConfirmActiveEffect ? '' : 'cursor-not-allowed opacity-50'
                        }`}
                      >
                        {slotActionLabel}
                        {slotLabel}
                      </button>
                    );
                  })}
                {showLegacyActiveEffectControls &&
                  activeEffectSelectableOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={
                        !canConfirmActiveEffect ||
                        (activeEffectUsesCardOptionSelection && !activeEffectSelectedCardId)
                      }
                      onClick={() =>
                        confirmEffectStep(
                          activeEffect.id,
                          activeEffectUsesCardOptionSelection
                            ? activeEffectSelectedCardId
                            : undefined,
                          undefined,
                          undefined,
                          option.id
                        )
                      }
                      className={cn(
                        'button-secondary inline-flex min-h-10 items-center px-3 text-sm font-semibold',
                        isActiveEffectOrderSelectionWindow
                          ? 'w-full justify-start py-3 text-left leading-relaxed'
                          : 'justify-center',
                        canConfirmActiveEffect &&
                          (!activeEffectUsesCardOptionSelection || activeEffectSelectedCardId)
                          ? ''
                          : 'cursor-not-allowed opacity-50'
                      )}
                    >
                      <CardEffectText
                        as="span"
                        text={option.label}
                        className={cn(
                          'whitespace-normal break-normal',
                          isActiveEffectOrderSelectionWindow
                            ? 'block w-full text-left leading-relaxed'
                            : 'inline-flex items-center justify-center gap-1'
                        )}
                      />
                    </button>
                  ))}
                {showLegacyActiveEffectControls && activeEffectNumericInput && (
                  <div className="flex min-w-[180px] flex-col gap-1">
                    <label className="text-xs font-semibold text-[var(--text-secondary)]">
                      {activeEffectNumericInput.label ?? '数字'}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={activeEffectNumericInput.min ?? undefined}
                        max={activeEffectNumericInput.max ?? undefined}
                        step={activeEffectNumericInput.integerOnly === true ? 1 : undefined}
                        value={activeEffectNumberInput}
                        placeholder={activeEffectNumericInput.placeholder}
                        onChange={(event) => setActiveEffectNumberInput(event.currentTarget.value)}
                        className="min-h-10 w-28 rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--border-active)]"
                      />
                      <button
                        type="button"
                        disabled={!canConfirmActiveEffectNumber}
                        onClick={() =>
                          confirmEffectStep(
                            activeEffect.id,
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            activeEffectSelectedNumber
                          )
                        }
                        className={`button-primary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold ${
                          canConfirmActiveEffectNumber ? '' : 'cursor-not-allowed opacity-50'
                        }`}
                      >
                        {activeEffectNumericInput.confirmLabel ?? '确认'}
                      </button>
                    </div>
                  </div>
                )}
                {showLegacyActiveEffectControls &&
                  activeEffectUsesOrderedMultiSelect &&
                  (activeEffectSelectableCardIds.length > 0 ||
                    activeEffectMinSelectableCards === 0) && (
                    <button
                      type="button"
                      disabled={!canConfirmOrderedEffectSelection}
                      onClick={() =>
                        confirmEffectStep(
                          activeEffect.id,
                          undefined,
                          undefined,
                          undefined,
                          undefined,
                          activeEffectOrderedSelection
                        )
                      }
                      className={`button-primary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold ${
                        canConfirmOrderedEffectSelection ? '' : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      {`${activeEffect.confirmSelectionLabel ?? '确认选择'}（${activeEffectOrderedSelection.length}张）`}
                    </button>
                  )}
                {showLegacyActiveEffectControls && activeEffect.canResolveInOrder && (
                  <button
                    type="button"
                    disabled={!canConfirmActiveEffect}
                    onClick={() => confirmEffectStep(activeEffect.id, undefined, null, true)}
                    className={cn(
                      'button-primary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold',
                      isActiveEffectOrderSelectionWindow && 'self-end',
                      canConfirmActiveEffect ? '' : 'cursor-not-allowed opacity-50'
                    )}
                  >
                    顺序发动
                  </button>
                )}
                {showLegacyActiveEffectControls &&
                  activeEffect.canSkipSelection &&
                  (activeEffectSelectableCardIds.length > 0 ||
                    activeEffectSelectableSlots.length > 0 ||
                    activeEffectSelectableOptions.length > 0 ||
                    !!activeEffectStageFormation ||
                    !!activeEffectNumericInput ||
                    activeEffect.canResolveInOrder) && (
                    <button
                      type="button"
                      disabled={!canConfirmActiveEffect}
                      onClick={() => confirmEffectStep(activeEffect.id, null)}
                      className={`button-secondary inline-flex min-h-10 items-center justify-center px-3 text-sm font-semibold ${
                        canConfirmActiveEffect ? '' : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      {activeEffect.skipSelectionLabel ?? '不加入'}
                    </button>
                  )}
                {showLegacyActiveEffectControls &&
                  activeEffectSelectableCardIds.length === 0 &&
                  activeEffectSelectableSlots.length === 0 &&
                  activeEffectSelectableOptions.length === 0 &&
                  !activeEffectStageFormation &&
                  !activeEffectNumericInput &&
                  !activeEffect.canSkipSelection &&
                  !activeEffect.canResolveInOrder && (
                    <button
                      type="button"
                      disabled={!canConfirmActiveEffect}
                      onClick={() => confirmEffectStep(activeEffect.id)}
                      className={`button-primary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold ${
                        canConfirmActiveEffect ? '' : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      {activeEffect.confirmSelectionLabel ?? '继续处理'}
                    </button>
                  )}
                {showLegacyActiveEffectControls &&
                  activeEffectSelectableCardIds.length === 0 &&
                  activeEffectSelectableSlots.length === 0 &&
                  activeEffectSelectableOptions.length === 0 &&
                  !activeEffectStageFormation &&
                  !activeEffectNumericInput &&
                  activeEffect.canSkipSelection && (
                    <button
                      type="button"
                      disabled={!canConfirmActiveEffect}
                      onClick={() => confirmEffectStep(activeEffect.id, null)}
                      className={`button-secondary inline-flex min-h-10 items-center justify-center px-3 text-sm font-semibold ${
                        canConfirmActiveEffect ? '' : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      {activeEffect.skipSelectionLabel ?? '继续处理'}
                    </button>
                  )}
              </div>
            </motion.div>
          </div>
        )}

        {pendingSpecialMemberPlay && (
          <div className="pointer-events-auto fixed left-1/2 top-1/2 z-[97] w-[min(94vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_97%,transparent)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl">
            {controlsPendingSpecialPlay ? (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                  {pendingSpecialMemberPlay.selectionLabel}
                </div>
                <p className="mt-2 text-sm leading-relaxed">{pendingSpecialMemberPlay.stepText}</p>
                <div className="mt-3 grid max-h-[48vh] grid-cols-[repeat(auto-fill,minmax(78px,1fr))] gap-3 overflow-y-auto rounded-lg border border-[var(--border-subtle)] p-3">
                  {pendingSpecialPlayCandidateIds.map((cardId) => {
                    const presentation = getVisibleCardPresentation(cardId);
                    if (!presentation) return null;
                    const selected = specialPlayPaymentSelection.includes(cardId);
                    return (
                      <button
                        key={cardId}
                        type="button"
                        onClick={() => handleToggleSpecialPlayPayment(cardId)}
                        className={cn(
                          'relative flex min-w-0 flex-col items-center rounded-lg border p-1.5 transition-colors',
                          selected
                            ? 'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                        )}
                        title={formatCardCompactLabel(presentation.cardData as AnyCardData)}
                      >
                        <div className="h-[105px] w-[75px] overflow-hidden rounded-lg">
                          <Card
                            cardData={presentation.cardData as AnyCardData}
                            instanceId={presentation.instanceId}
                            imagePath={presentation.imagePath}
                            size="sm"
                            faceUp={true}
                            showHover={false}
                            className="h-full w-full"
                          />
                        </div>
                        {selected && (
                          <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[10px] font-bold text-white">
                            {specialPlayPaymentSelection.indexOf(cardId) + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => cancelSpecialMemberPlay(pendingSpecialMemberPlay.id)}
                    className="button-secondary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={specialPlayPaymentSelection.length !== 3}
                    onClick={() =>
                      confirmSpecialMemberPlay(
                        pendingSpecialMemberPlay.id,
                        specialPlayPaymentSelection
                      )
                    }
                    className={cn(
                      'button-primary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold',
                      specialPlayPaymentSelection.length !== 3 && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    {pendingSpecialMemberPlay.confirmSelectionLabel}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-center text-sm font-semibold">等待对方完成特殊登场</p>
            )}
          </div>
        )}

        {pendingCostPayment && (
          <div className="pointer-events-auto fixed left-1/2 top-1/2 z-[96] w-[min(92vw,540px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                  支付登场费用
                </div>
                <div className="mt-1 text-sm font-semibold">
                  {pendingCostSource
                    ? formatCardCompactLabel(pendingCostSource.cardData as AnyCardData)
                    : '成员登场'}
                </div>
              </div>
              <div className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                {pendingCostPayment.finalEnergyCost}费
              </div>
            </div>
            <div className="rounded border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] p-3">
              <p className="text-sm leading-relaxed">
                确认支付 {pendingCostPayment.finalEnergyCost} 费让这张成员登场。
              </p>
              {pendingCostPayment.explanation && (
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {pendingCostPayment.explanation}
                </p>
              )}
              {pendingCostEnergyIds.length < pendingCostPayment.finalEnergyCost && (
                <p className="mt-1 text-xs text-[var(--danger)]">可用能量不足，无法支付。</p>
              )}
            </div>
            {!isReadOnly && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={!canConfirmCostPayment}
                  onClick={() => confirmCostPayment(pendingCostPayment.id, autoCostEnergyIds)}
                  className={`button-primary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold ${
                    canConfirmCostPayment ? '' : 'cursor-not-allowed opacity-50'
                  }`}
                >
                  确认支付
                </button>
              </div>
            )}
          </div>
        )}

        {/* 左侧唤出按钮（判定区关闭时显示） */}
        {!isMobileBattlefield && isJudgmentPanelRelevant && !judgmentPanelOpen && (
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
        {!isMobileBattlefield && canShowPublicBattleLog && <PublicBattleLogPanel />}
        {!isMobileBattlefield && canShowDebugLog && <GameLog />}

        {/* 阶段提示横幅 */}
        <PhaseBanner />

        {/* 调试控制面板 */}
        {!isReadOnly && !isMobileBattlefield && <DebugControl />}

        {/* 卡牌详情浮窗 */}
        <CardDetailOverlay />

        {/* Live 结果动画 */}
        <LiveResultAnimation
          visible={!isReadOnly && shouldShowWinnerAnimation}
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
          animationKey={liveResultAnimationKey}
          onComplete={handleLiveAnimationComplete}
        />

        {/* Live 判定面板 */}
        <JudgmentPanel
          isOpen={isJudgmentPanelRelevant && judgmentPanelOpen}
          onClose={handleJudgmentPanelClose}
        />

        {/* Live 分数最终确认弹窗（居中） */}
        {!isReadOnly && <ScoreConfirmModal />}

        {/* 换牌面板 */}
        <MulliganPanel isOpen={!isReadOnly && mulliganPanelOpen} />

        {!isReadOnly && pendingUndoRequest && (
          <div className="pointer-events-auto fixed inset-0 z-[110] flex items-center justify-center px-4">
            <div className="modal-backdrop absolute inset-0" />
            <div className="modal-surface modal-accent-indigo relative w-[min(92vw,460px)] p-5 text-[var(--text-primary)]">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-[var(--accent-primary)]">
                  <Undo2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                    撤销请求
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {pendingUndoRequesterName} 请求撤销上一步
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                    {pendingUndoRequest.summary}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                    如果这一步公开了隐藏信息，撤销只回滚局面，不能消除已经看到的信息。
                  </p>
                  {pendingUndoCanRespond && (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                      也可以允许对手连续撤销这一串操作；换阶段或有新动作后会失效。
                    </p>
                  )}
                </div>
              </div>

              {pendingUndoIsRequester ? (
                <div className="mt-4 rounded border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                  等待对手回应
                </div>
              ) : (
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={!pendingUndoCanRespond}
                    onClick={() => respondRemoteUndoRequest(pendingUndoRequest.requestId, false)}
                    className="button-secondary inline-flex min-h-10 items-center justify-center gap-1.5 px-3 text-sm font-semibold"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    拒绝
                  </button>
                  <button
                    type="button"
                    disabled={!pendingUndoCanRespond}
                    onClick={() => respondRemoteUndoRequest(pendingUndoRequest.requestId, true)}
                    className="button-primary inline-flex min-h-10 items-center justify-center gap-1.5 px-4 text-sm font-semibold"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    接受
                  </button>
                  <button
                    type="button"
                    disabled={!pendingUndoCanRespond}
                    onClick={() =>
                      respondRemoteUndoRequest(pendingUndoRequest.requestId, true, {
                        grantContinuous: true,
                      })
                    }
                    className="button-secondary inline-flex min-h-10 items-center justify-center gap-1.5 px-3 text-sm font-semibold"
                  >
                    <Repeat2 className="h-4 w-4" aria-hidden="true" />
                    允许连续
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {!isReadOnly && pendingManualOperationRequest && (
          <div className="pointer-events-auto fixed inset-0 z-[111] flex items-center justify-center px-4">
            <div className="modal-backdrop absolute inset-0" />
            <div className="modal-surface modal-accent-indigo relative w-[min(92vw,460px)] p-5 text-[var(--text-primary)]">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--semantic-warning)]/40 bg-[var(--semantic-warning)]/10 text-[var(--semantic-warning)]">
                  <Zap className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
                    自由模式请求
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {pendingManualOperationRequesterName} 请求开启自由模式
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                    开启后，双方可免费登场及手动调整己方区域，用于人工处理尚未自动化的规则。
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                    不会获得操作对手或读取对手隐藏信息的权限。任意一方都可在安全时点单方恢复规则模式。
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {pendingManualOperationIsRequester ? (
                  <button
                    type="button"
                    onClick={() =>
                      respondManualOperationModeRequest(
                        pendingManualOperationRequest.requestId,
                        'cancel'
                      )
                    }
                    className="button-secondary inline-flex min-h-10 items-center justify-center gap-1.5 px-3 text-sm font-semibold"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    取消请求
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!pendingManualOperationCanRespond}
                      onClick={() =>
                        respondManualOperationModeRequest(
                          pendingManualOperationRequest.requestId,
                          'reject'
                        )
                      }
                      className="button-secondary inline-flex min-h-10 items-center justify-center gap-1.5 px-3 text-sm font-semibold"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      拒绝
                    </button>
                    <button
                      type="button"
                      disabled={!pendingManualOperationCanRespond}
                      onClick={() =>
                        respondManualOperationModeRequest(
                          pendingManualOperationRequest.requestId,
                          'accept'
                        )
                      }
                      className="button-primary inline-flex min-h-10 items-center justify-center gap-1.5 px-4 text-sm font-semibold"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                      同意开启
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 拖拽覆盖层 - 显示正在拖拽的卡牌 */}
        <DragOverlay>
          {activeCard ? (
            <DragOverlayCard card={activeCard} fromZone={activeDragFromZone} />
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

function DragOverlayCard({
  card,
  fromZone,
}: {
  readonly card: VisibleCardPresentation;
  readonly fromZone: ZoneType | null;
}) {
  const cardContent = (
    <Card
      cardData={card.cardData as AnyCardData}
      instanceId={card.instanceId}
      imagePath={card.imagePath}
      size="sm"
      faceUp={true}
      showHover={false}
    />
  );

  if (!isHorizontalDragPreviewZone(fromZone)) {
    return cardContent;
  }

  return (
    <div className="flex h-[80px] w-[112px] items-center justify-center">
      <div className="-rotate-90 origin-center">{cardContent}</div>
    </div>
  );
}

function isHorizontalDragPreviewZone(zone: ZoneType | null): boolean {
  return zone === ZoneType.LIVE_ZONE || zone === ZoneType.SUCCESS_ZONE;
}

export default GameBoard;
