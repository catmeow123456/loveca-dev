import { GameCommandType } from '@game/application/game-commands';
import { CardType, GamePhase, SlotPosition, SubPhase, ZoneType } from '@game/shared/types/enums';
import type { ActiveEffectViewState, Seat, ViewerSurface } from '@game/online';

export type BattleActionTargetKind = 'ZONE' | 'CARD' | 'SLOT' | 'OPTION' | 'NUMBER' | 'NONE';

export type BattleInteractionOrigin =
  'CLICK' | 'DRAG' | 'BUTTON' | 'MODAL' | 'SYSTEM' | 'REMOTE' | 'REPLAY';

export type BattleOperationCause =
  'TABLETOP' | 'FLOW_TASK' | 'ACTIVE_EFFECT' | 'COST_PAYMENT' | 'LIVE_JUDGMENT' | 'DEBUG_ASSIST';

export type BattleAnimationPolicy =
  | 'LOCAL_DIRECT_DRAG_SETTLE'
  | 'LOCAL_DIRECT_DRAG_REJECT'
  | 'LOCAL_CLICK_MOVE'
  | 'LOCAL_BUTTON_OR_MODAL'
  | 'REMOTE_OPPONENT_MOVE'
  | 'SYSTEM_MOVE'
  | 'CARD_EFFECT_MOVE'
  | 'REPLAY_TIMELINE'
  | 'REDUCED_MOTION';

export type BattleInteractionSurface =
  | 'LOCAL_DEBUG'
  | 'SOLITAIRE'
  | 'ONLINE'
  | 'REMOTE_DEBUG'
  | 'SPECTATOR_READONLY'
  | 'REPLAY_READONLY';

export type BattleActionCommandPayload =
  | {
      readonly type: GameCommandType.PLAY_MEMBER_TO_SLOT;
      readonly cardId: string;
      readonly targetSlot: SlotPosition;
    }
  | {
      readonly type: GameCommandType.MOVE_MEMBER_TO_SLOT;
      readonly cardId: string;
      readonly sourceSlot: SlotPosition;
      readonly targetSlot: SlotPosition;
    }
  | {
      readonly type: GameCommandType.ATTACH_ENERGY_TO_MEMBER;
      readonly cardId: string;
      readonly fromZone: ZoneType.MEMBER_SLOT | ZoneType.ENERGY_ZONE | ZoneType.ENERGY_DECK;
      readonly targetSlot: SlotPosition;
      readonly sourceSlot?: SlotPosition;
    }
  | {
      readonly type: GameCommandType.SET_LIVE_CARD;
      readonly cardId: string;
      readonly faceDown: boolean;
    }
  | {
      readonly type: GameCommandType.MOVE_PUBLIC_CARD_TO_HAND;
      readonly cardId: string;
      readonly fromZone:
        ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE | ZoneType.WAITING_ROOM;
      readonly sourceSlot?: SlotPosition;
    }
  | {
      readonly type: GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM;
      readonly cardId: string;
      readonly fromZone: ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE;
      readonly sourceSlot?: SlotPosition;
    }
  | {
      readonly type: GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK;
      readonly cardId: string;
      readonly fromZone: ZoneType.ENERGY_ZONE;
    }
  | {
      readonly type: GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE;
      readonly cardId: string;
      readonly toZone: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.EXILE_ZONE;
    }
  | {
      readonly type: GameCommandType.MOVE_INSPECTED_CARD_TO_TOP;
      readonly cardId: string;
    }
  | {
      readonly type: GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM;
      readonly cardId: string;
    }
  | {
      readonly type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE;
      readonly cardId: string;
      readonly toZone:
        ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.MAIN_DECK | ZoneType.EXILE_ZONE;
      readonly position?: 'TOP' | 'BOTTOM';
    }
  | {
      readonly type: GameCommandType.CONFIRM_EFFECT_STEP;
      readonly effectId: string;
      readonly selectedCardId?: string | null;
      readonly selectedSlot?: SlotPosition | null;
    };

export interface BattleActionTarget {
  readonly targetId: string;
  readonly kind: BattleActionTargetKind;
  readonly zone?: ZoneType;
  readonly slot?: SlotPosition;
  readonly objectId?: string;
  readonly enabled: boolean;
  readonly reason?: string;
  readonly label: string;
  readonly detail?: string;
  readonly anchor: {
    readonly targetId?: string;
    readonly objectId?: string;
    readonly zone?: ZoneType;
    readonly slot?: SlotPosition;
  };
  readonly commandPayload?: BattleActionCommandPayload;
  readonly visibilityPolicy?: ViewerSurface;
}

export interface BattleActionIntent {
  readonly intentId: string;
  readonly commandType: GameCommandType;
  readonly actorSeat: Seat | null;
  readonly sourceObjectId: string;
  readonly sourceCardId: string;
  readonly sourceZone: ZoneType | null;
  readonly sourceSlot?: SlotPosition | null;
  readonly label: string;
  readonly detail?: string;
  readonly targetKind: BattleActionTargetKind;
  readonly targets: readonly BattleActionTarget[];
  readonly animationPolicy: BattleAnimationPolicy;
  readonly isDebugAssist: boolean;
  readonly isEffectStep: boolean;
  readonly battleSurface: BattleInteractionSurface;
  readonly interactionOrigin: BattleInteractionOrigin;
  readonly operationCause: BattleOperationCause;
  readonly recordingHint: {
    readonly label: string;
    readonly cause: BattleOperationCause;
  };
}

export interface BattleMemberSlotSnapshot {
  readonly seat: Seat;
  readonly slot: SlotPosition;
  readonly cardId: string | null;
  readonly enteredStageThisTurn?: boolean;
}

export interface BattleActionIntentInput {
  readonly sourceCardId: string;
  readonly sourceZone: ZoneType | null;
  readonly sourceCardType: CardType | null;
  readonly sourceSlot?: SlotPosition | null;
  readonly currentPhase: GamePhase | null;
  readonly currentSubPhase: SubPhase;
  readonly actorSeat: Seat | null;
  readonly viewerSeat: Seat | null;
  readonly sourceSeat?: Seat | null;
  readonly surface: BattleInteractionSurface;
  readonly isReadOnly: boolean;
  readonly availableCommandTypes: readonly GameCommandType[];
  readonly manualOperationMode?: 'RULES' | 'FREE';
  readonly memberSlots: readonly BattleMemberSlotSnapshot[];
  readonly liveZoneCount?: number;
  readonly liveZoneMax?: number;
  readonly activeEffect?: ActiveEffectViewState | null;
  readonly activeEffectCanConfirm?: boolean;
}

export function canUseLegacyManualDropFallback(
  manualOperationMode: BattleActionIntentInput['manualOperationMode']
): boolean {
  return manualOperationMode === 'FREE';
}

const MEMBER_SLOT_LABELS: Record<SlotPosition, string> = {
  [SlotPosition.LEFT]: '左侧',
  [SlotPosition.CENTER]: '中心',
  [SlotPosition.RIGHT]: '右侧',
};

const INSPECTION_TARGET_IDS = {
  hand: 'inspection-target-hand',
  waitingRoom: 'inspection-target-waiting-room',
  mainDeckTop: 'inspection-target-main-deck-top',
  mainDeckBottom: 'inspection-target-main-deck-bottom',
} as const;

const RESOLUTION_TARGET_IDS = {
  hand: 'resolution-target-hand',
  waitingRoom: 'resolution-target-waiting-room',
  mainDeckTop: 'resolution-target-main-deck-top',
} as const;

export function buildBattleActionIntents(
  input: BattleActionIntentInput
): readonly BattleActionIntent[] {
  if (input.isReadOnly) {
    return [];
  }

  const activeEffectIntents = buildActiveEffectIntents(input);
  if (input.activeEffect && input.activeEffectCanConfirm) {
    return activeEffectIntents;
  }

  if (
    input.sourceZone === ZoneType.HAND &&
    input.currentPhase === GamePhase.LIVE_SET_PHASE &&
    isLiveSetPlayerSubPhase(input.currentSubPhase) &&
    isCommandAvailable(input, GameCommandType.SET_LIVE_CARD)
  ) {
    return [createSetLiveIntent(input)].filter((intent) => intent.targets.length > 0);
  }

  const intents: BattleActionIntent[] = [];

  if (
    input.sourceZone === ZoneType.HAND &&
    input.sourceCardType === CardType.MEMBER &&
    isCommandAvailable(input, GameCommandType.PLAY_MEMBER_TO_SLOT)
  ) {
    intents.push(createPlayMemberIntent(input));
  }

  if (
    input.sourceZone === ZoneType.MEMBER_SLOT &&
    input.sourceCardType === CardType.MEMBER &&
    input.sourceSlot &&
    isCommandAvailable(input, GameCommandType.MOVE_MEMBER_TO_SLOT)
  ) {
    intents.push(createMoveMemberIntent(input, input.sourceSlot));
  }

  if (
    (input.sourceZone === ZoneType.ENERGY_ZONE ||
      input.sourceZone === ZoneType.ENERGY_DECK ||
      input.sourceZone === ZoneType.MEMBER_SLOT) &&
    input.sourceCardType === CardType.ENERGY &&
    isCommandAvailable(input, GameCommandType.ATTACH_ENERGY_TO_MEMBER)
  ) {
    intents.push(createAttachEnergyIntent(input));
  }

  if (
    input.sourceZone &&
    isPublicCardToHandSource(input.sourceZone) &&
    isCommandAvailable(input, GameCommandType.MOVE_PUBLIC_CARD_TO_HAND)
  ) {
    intents.push(createMovePublicToHandIntent(input, input.sourceZone));
  }

  if (
    input.sourceZone &&
    isPublicCardToWaitingRoomSource(input.sourceZone) &&
    isCommandAvailable(input, GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM)
  ) {
    intents.push(createMovePublicToWaitingRoomIntent(input, input.sourceZone));
  }

  if (
    input.sourceZone === ZoneType.ENERGY_ZONE &&
    isCommandAvailable(input, GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK)
  ) {
    intents.push(createMoveEnergyToDeckIntent(input));
  }

  if (input.sourceZone === ZoneType.INSPECTION_ZONE) {
    if (isCommandAvailable(input, GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE)) {
      intents.push(createMoveInspectedToZoneIntent(input));
    }
    if (isCommandAvailable(input, GameCommandType.MOVE_INSPECTED_CARD_TO_TOP)) {
      intents.push(createMoveInspectedToTopIntent(input));
    }
    if (isCommandAvailable(input, GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM)) {
      intents.push(createMoveInspectedToBottomIntent(input));
    }
  }

  if (
    input.sourceZone === ZoneType.RESOLUTION_ZONE &&
    isCommandAvailable(input, GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE)
  ) {
    intents.push(createMoveResolutionToZoneIntent(input));
  }

  return intents.filter((intent) => intent.targets.length > 0);
}

export function findEnabledBattleActionSlotTarget(
  intents: readonly BattleActionIntent[],
  zone: ZoneType,
  slot: SlotPosition
): { readonly intent: BattleActionIntent; readonly target: BattleActionTarget } | null {
  for (const intent of intents) {
    const target = intent.targets.find(
      (candidate) =>
        candidate.enabled &&
        candidate.kind === 'SLOT' &&
        candidate.zone === zone &&
        candidate.slot === slot
    );
    if (target) {
      return { intent, target };
    }
  }
  return null;
}

export function findEnabledBattleActionZoneTarget(
  intents: readonly BattleActionIntent[],
  zone: ZoneType
): { readonly intent: BattleActionIntent; readonly target: BattleActionTarget } | null {
  for (const intent of intents) {
    const target = intent.targets.find(
      (candidate) => candidate.enabled && candidate.kind === 'ZONE' && candidate.zone === zone
    );
    if (target) {
      return { intent, target };
    }
  }
  return null;
}

export function findEnabledBattleActionTargetForZoneDrop(
  intents: readonly BattleActionIntent[],
  zone: ZoneType,
  slot?: SlotPosition
): { readonly intent: BattleActionIntent; readonly target: BattleActionTarget } | null {
  if (zone === ZoneType.MEMBER_SLOT && slot) {
    return findEnabledBattleActionSlotTarget(intents, zone, slot);
  }
  return findEnabledBattleActionZoneTarget(intents, zone);
}

export function findEnabledBattleActionTargetByTargetId(
  intents: readonly BattleActionIntent[],
  targetId: string
): { readonly intent: BattleActionIntent; readonly target: BattleActionTarget } | null {
  for (const intent of intents) {
    const target = intent.targets.find(
      (candidate) => candidate.enabled && candidate.targetId === targetId
    );
    if (target) {
      return { intent, target };
    }
  }
  return null;
}

function buildActiveEffectIntents(input: BattleActionIntentInput): readonly BattleActionIntent[] {
  const effect = input.activeEffect;
  if (!effect || !input.activeEffectCanConfirm) {
    return [];
  }

  const sourceObjectId = toPublicObjectId(input.sourceCardId);
  const selectableCardIds =
    effect.selectableObjectIds?.map((objectId) => getCardIdFromPublicObjectId(objectId)) ?? [];
  const intents: BattleActionIntent[] = [];

  if (selectableCardIds.includes(input.sourceCardId)) {
    intents.push(
      createIntent(input, {
        commandType: GameCommandType.CONFIRM_EFFECT_STEP,
        label: effect.confirmSelectionLabel ?? '选择此卡',
        targetKind: 'NONE',
        animationPolicy: 'LOCAL_BUTTON_OR_MODAL',
        isEffectStep: true,
        operationCause: 'ACTIVE_EFFECT',
        targets: [
          {
            targetId: `effect-card:${effect.id}:${sourceObjectId}`,
            kind: 'NONE',
            enabled: true,
            label: effect.confirmSelectionLabel ?? '选择此卡',
            anchor: { objectId: sourceObjectId },
            commandPayload: {
              type: GameCommandType.CONFIRM_EFFECT_STEP,
              effectId: effect.id,
              selectedCardId: input.sourceCardId,
            },
          },
        ],
      })
    );
  }

  const selectableSlots = effect.selectableSlots ?? [];
  if (effect.sourceObjectId === sourceObjectId && selectableSlots.length > 0) {
    const targets = selectableSlots.filter(isSlotPosition).map((slot) => ({
      targetId: `effect-slot:${effect.id}:${slot}`,
      kind: 'SLOT' as const,
      zone: ZoneType.MEMBER_SLOT,
      slot,
      enabled: true,
      label: effect.confirmSelectionLabel ?? '选择槽位',
      detail: MEMBER_SLOT_LABELS[slot],
      anchor: { zone: ZoneType.MEMBER_SLOT, slot },
      commandPayload: {
        type: GameCommandType.CONFIRM_EFFECT_STEP as const,
        effectId: effect.id,
        selectedSlot: slot,
      },
    }));

    if (targets.length > 0) {
      intents.push(
        createIntent(input, {
          commandType: GameCommandType.CONFIRM_EFFECT_STEP,
          label: effect.confirmSelectionLabel ?? '选择槽位',
          targetKind: 'SLOT',
          animationPolicy: 'LOCAL_BUTTON_OR_MODAL',
          isEffectStep: true,
          operationCause: 'ACTIVE_EFFECT',
          targets,
        })
      );
    }
  }

  return intents;
}

function createPlayMemberIntent(input: BattleActionIntentInput): BattleActionIntent {
  const targets = getViewerMemberSlots(input)
    .filter((slot) => input.manualOperationMode !== 'RULES' || slot.enteredStageThisTurn !== true)
    .map((slot) => ({
      targetId: targetIdForMemberSlot(slot.slot),
      kind: 'SLOT' as const,
      zone: ZoneType.MEMBER_SLOT,
      slot: slot.slot,
      enabled: true,
      label: slot.cardId ? '在此登场' : '登场',
      detail: MEMBER_SLOT_LABELS[slot.slot],
      anchor: { zone: ZoneType.MEMBER_SLOT, slot: slot.slot },
      commandPayload: {
        type: GameCommandType.PLAY_MEMBER_TO_SLOT as const,
        cardId: input.sourceCardId,
        targetSlot: slot.slot,
      },
    }));

  return createIntent(input, {
    commandType: GameCommandType.PLAY_MEMBER_TO_SLOT,
    label: '登场',
    detail: '选择成员区槽位',
    targetKind: 'SLOT',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets,
  });
}

function createMoveMemberIntent(
  input: BattleActionIntentInput,
  sourceSlot: SlotPosition
): BattleActionIntent {
  const targets = getViewerMemberSlots(input)
    .filter((slot) => slot.slot !== sourceSlot)
    .map((slot) => ({
      targetId: targetIdForMemberSlot(slot.slot),
      kind: 'SLOT' as const,
      zone: ZoneType.MEMBER_SLOT,
      slot: slot.slot,
      enabled: true,
      label: '成员换位',
      detail: MEMBER_SLOT_LABELS[slot.slot],
      anchor: { zone: ZoneType.MEMBER_SLOT, slot: slot.slot },
      commandPayload: {
        type: GameCommandType.MOVE_MEMBER_TO_SLOT as const,
        cardId: input.sourceCardId,
        sourceSlot,
        targetSlot: slot.slot,
      },
    }));

  return createIntent(input, {
    commandType: GameCommandType.MOVE_MEMBER_TO_SLOT,
    label: '移动成员',
    detail: '选择目标成员区',
    targetKind: 'SLOT',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets,
  });
}

function createAttachEnergyIntent(input: BattleActionIntentInput): BattleActionIntent {
  const fromZone = getAttachEnergySourceZone(input.sourceZone);
  if (!fromZone) {
    return createIntent(input, {
      commandType: GameCommandType.ATTACH_ENERGY_TO_MEMBER,
      label: '附着能量',
      detail: '选择有成员的槽位',
      targetKind: 'SLOT',
      animationPolicy: 'LOCAL_CLICK_MOVE',
      operationCause: 'TABLETOP',
      targets: [],
    });
  }

  const targets = getViewerMemberSlots(input)
    .filter((slot) => slot.cardId !== null)
    .map((slot) => ({
      targetId: targetIdForMemberSlot(slot.slot),
      kind: 'SLOT' as const,
      zone: ZoneType.MEMBER_SLOT,
      slot: slot.slot,
      enabled: true,
      label: '附着能量',
      detail: MEMBER_SLOT_LABELS[slot.slot],
      anchor: { zone: ZoneType.MEMBER_SLOT, slot: slot.slot },
      commandPayload: {
        type: GameCommandType.ATTACH_ENERGY_TO_MEMBER as const,
        cardId: input.sourceCardId,
        fromZone,
        targetSlot: slot.slot,
        sourceSlot: input.sourceSlot ?? undefined,
      },
    }));

  return createIntent(input, {
    commandType: GameCommandType.ATTACH_ENERGY_TO_MEMBER,
    label: '附着能量',
    detail: '选择有成员的槽位',
    targetKind: 'SLOT',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets,
  });
}

function createSetLiveIntent(input: BattleActionIntentInput): BattleActionIntent {
  const liveZoneCount = input.liveZoneCount ?? 0;
  const liveZoneMax = input.liveZoneMax ?? 3;
  const enabled = liveZoneCount < liveZoneMax;
  const target: BattleActionTarget = {
    targetId: 'live-zone',
    kind: 'ZONE',
    zone: ZoneType.LIVE_ZONE,
    enabled,
    reason: enabled ? undefined : 'Live 区已满',
    label: '里侧放置',
    detail: 'Live 设置',
    anchor: { zone: ZoneType.LIVE_ZONE, targetId: 'live-zone' },
    commandPayload: enabled
      ? {
          type: GameCommandType.SET_LIVE_CARD,
          cardId: input.sourceCardId,
          faceDown: true,
        }
      : undefined,
  };

  return createIntent(input, {
    commandType: GameCommandType.SET_LIVE_CARD,
    label: 'Live 设置',
    detail: '手牌里侧放置到 Live 区',
    targetKind: 'ZONE',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'FLOW_TASK',
    targets: [target],
  });
}

function createMovePublicToHandIntent(
  input: BattleActionIntentInput,
  fromZone:
    ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE | ZoneType.WAITING_ROOM
): BattleActionIntent {
  return createIntent(input, {
    commandType: GameCommandType.MOVE_PUBLIC_CARD_TO_HAND,
    label: '加入手牌',
    targetKind: 'ZONE',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets: [
      {
        targetId: 'hand',
        kind: 'ZONE',
        zone: ZoneType.HAND,
        enabled: true,
        label: '加入手牌',
        anchor: { zone: ZoneType.HAND, targetId: 'hand' },
        commandPayload: {
          type: GameCommandType.MOVE_PUBLIC_CARD_TO_HAND,
          cardId: input.sourceCardId,
          fromZone,
          sourceSlot: input.sourceSlot ?? undefined,
        },
      },
    ],
  });
}

function createMovePublicToWaitingRoomIntent(
  input: BattleActionIntentInput,
  fromZone: ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE
): BattleActionIntent {
  return createIntent(input, {
    commandType: GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM,
    label: '放入休息室',
    targetKind: 'ZONE',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets: [
      {
        targetId: 'waiting-room',
        kind: 'ZONE',
        zone: ZoneType.WAITING_ROOM,
        enabled: true,
        label: '放入休息室',
        anchor: { zone: ZoneType.WAITING_ROOM, targetId: 'waiting-room' },
        commandPayload: {
          type: GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM,
          cardId: input.sourceCardId,
          fromZone,
          sourceSlot: input.sourceSlot ?? undefined,
        },
      },
    ],
  });
}

function createMoveEnergyToDeckIntent(input: BattleActionIntentInput): BattleActionIntent {
  return createIntent(input, {
    commandType: GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK,
    label: '回能量卡组',
    targetKind: 'ZONE',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets: [
      {
        targetId: 'energy-deck',
        kind: 'ZONE',
        zone: ZoneType.ENERGY_DECK,
        enabled: true,
        label: '回能量卡组',
        anchor: { zone: ZoneType.ENERGY_DECK, targetId: 'energy-deck' },
        commandPayload: {
          type: GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK,
          cardId: input.sourceCardId,
          fromZone: ZoneType.ENERGY_ZONE,
        },
      },
    ],
  });
}

function createMoveInspectedToZoneIntent(input: BattleActionIntentInput): BattleActionIntent {
  const targets: readonly BattleActionTarget[] = [
    {
      targetId: INSPECTION_TARGET_IDS.hand,
      kind: 'ZONE',
      zone: ZoneType.HAND,
      enabled: true,
      label: '加入手牌',
      anchor: { zone: ZoneType.HAND, targetId: INSPECTION_TARGET_IDS.hand },
      commandPayload: {
        type: GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
        cardId: input.sourceCardId,
        toZone: ZoneType.HAND,
      },
    },
    {
      targetId: INSPECTION_TARGET_IDS.waitingRoom,
      kind: 'ZONE',
      zone: ZoneType.WAITING_ROOM,
      enabled: true,
      label: '放入休息室',
      anchor: { zone: ZoneType.WAITING_ROOM, targetId: INSPECTION_TARGET_IDS.waitingRoom },
      commandPayload: {
        type: GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
        cardId: input.sourceCardId,
        toZone: ZoneType.WAITING_ROOM,
      },
    },
  ];

  return createIntent(input, {
    commandType: GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
    label: '整理检视牌',
    detail: '选择检视牌目标区域',
    targetKind: 'ZONE',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets,
  });
}

function createMoveInspectedToTopIntent(input: BattleActionIntentInput): BattleActionIntent {
  return createIntent(input, {
    commandType: GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
    label: '回卡组顶',
    targetKind: 'ZONE',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets: [
      {
        targetId: INSPECTION_TARGET_IDS.mainDeckTop,
        kind: 'ZONE',
        zone: ZoneType.MAIN_DECK,
        enabled: true,
        label: '回卡组顶',
        anchor: { zone: ZoneType.MAIN_DECK, targetId: INSPECTION_TARGET_IDS.mainDeckTop },
        commandPayload: {
          type: GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
          cardId: input.sourceCardId,
        },
      },
    ],
  });
}

function createMoveInspectedToBottomIntent(input: BattleActionIntentInput): BattleActionIntent {
  return createIntent(input, {
    commandType: GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
    label: '放卡组底',
    targetKind: 'ZONE',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets: [
      {
        targetId: INSPECTION_TARGET_IDS.mainDeckBottom,
        kind: 'ZONE',
        zone: ZoneType.MAIN_DECK,
        enabled: true,
        label: '放卡组底',
        anchor: { zone: ZoneType.MAIN_DECK, targetId: INSPECTION_TARGET_IDS.mainDeckBottom },
        commandPayload: {
          type: GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
          cardId: input.sourceCardId,
        },
      },
    ],
  });
}

function createMoveResolutionToZoneIntent(input: BattleActionIntentInput): BattleActionIntent {
  return createIntent(input, {
    commandType: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
    label: '整理解决区卡牌',
    detail: '选择解决区卡牌目标区域',
    targetKind: 'ZONE',
    animationPolicy: 'LOCAL_CLICK_MOVE',
    operationCause: 'TABLETOP',
    targets: [
      {
        targetId: RESOLUTION_TARGET_IDS.hand,
        kind: 'ZONE',
        zone: ZoneType.HAND,
        enabled: true,
        label: '加入手牌',
        anchor: { zone: ZoneType.HAND, targetId: RESOLUTION_TARGET_IDS.hand },
        commandPayload: {
          type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
          cardId: input.sourceCardId,
          toZone: ZoneType.HAND,
        },
      },
      {
        targetId: RESOLUTION_TARGET_IDS.waitingRoom,
        kind: 'ZONE',
        zone: ZoneType.WAITING_ROOM,
        enabled: true,
        label: '放入休息室',
        anchor: { zone: ZoneType.WAITING_ROOM, targetId: RESOLUTION_TARGET_IDS.waitingRoom },
        commandPayload: {
          type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
          cardId: input.sourceCardId,
          toZone: ZoneType.WAITING_ROOM,
        },
      },
      {
        targetId: RESOLUTION_TARGET_IDS.mainDeckTop,
        kind: 'ZONE',
        zone: ZoneType.MAIN_DECK,
        enabled: true,
        label: '回卡组顶',
        anchor: { zone: ZoneType.MAIN_DECK, targetId: RESOLUTION_TARGET_IDS.mainDeckTop },
        commandPayload: {
          type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
          cardId: input.sourceCardId,
          toZone: ZoneType.MAIN_DECK,
          position: 'TOP',
        },
      },
    ],
  });
}

function createIntent(
  input: BattleActionIntentInput,
  options: {
    readonly commandType: GameCommandType;
    readonly label: string;
    readonly detail?: string;
    readonly targetKind: BattleActionTargetKind;
    readonly targets: readonly BattleActionTarget[];
    readonly animationPolicy: BattleAnimationPolicy;
    readonly isEffectStep?: boolean;
    readonly operationCause: BattleOperationCause;
  }
): BattleActionIntent {
  const sourceObjectId = toPublicObjectId(input.sourceCardId);
  return {
    intentId: `${options.commandType}:${sourceObjectId}`,
    commandType: options.commandType,
    actorSeat: input.actorSeat,
    sourceObjectId,
    sourceCardId: input.sourceCardId,
    sourceZone: input.sourceZone,
    sourceSlot: input.sourceSlot ?? null,
    label: options.label,
    detail: options.detail,
    targetKind: options.targetKind,
    targets: options.targets,
    animationPolicy: options.animationPolicy,
    isDebugAssist: options.operationCause === 'DEBUG_ASSIST',
    isEffectStep: options.isEffectStep === true,
    battleSurface: input.surface,
    interactionOrigin: 'CLICK',
    operationCause: options.operationCause,
    recordingHint: {
      label: options.label,
      cause: options.operationCause,
    },
  };
}

function isCommandAvailable(input: BattleActionIntentInput, command: GameCommandType): boolean {
  return input.availableCommandTypes.includes(command);
}

function getViewerMemberSlots(input: BattleActionIntentInput): readonly BattleMemberSlotSnapshot[] {
  if (!input.viewerSeat) {
    return [];
  }
  return input.memberSlots.filter((slot) => slot.seat === input.viewerSeat);
}

function isLiveSetPlayerSubPhase(subPhase: SubPhase): boolean {
  return (
    subPhase === SubPhase.LIVE_SET_FIRST_PLAYER || subPhase === SubPhase.LIVE_SET_SECOND_PLAYER
  );
}

function isPublicCardToHandSource(
  zone: ZoneType
): zone is
  ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE | ZoneType.WAITING_ROOM {
  return (
    zone === ZoneType.MEMBER_SLOT ||
    zone === ZoneType.LIVE_ZONE ||
    zone === ZoneType.SUCCESS_ZONE ||
    zone === ZoneType.WAITING_ROOM
  );
}

function isPublicCardToWaitingRoomSource(
  zone: ZoneType
): zone is ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE {
  return (
    zone === ZoneType.MEMBER_SLOT || zone === ZoneType.LIVE_ZONE || zone === ZoneType.SUCCESS_ZONE
  );
}

function getAttachEnergySourceZone(
  zone: ZoneType | null
): ZoneType.MEMBER_SLOT | ZoneType.ENERGY_ZONE | ZoneType.ENERGY_DECK | null {
  if (
    zone === ZoneType.MEMBER_SLOT ||
    zone === ZoneType.ENERGY_ZONE ||
    zone === ZoneType.ENERGY_DECK
  ) {
    return zone;
  }
  return null;
}

function toPublicObjectId(cardId: string): string {
  return cardId.startsWith('obj_') ? cardId : `obj_${cardId}`;
}

function getCardIdFromPublicObjectId(objectId: string): string {
  return objectId.startsWith('obj_') ? objectId.slice(4) : objectId;
}

function targetIdForMemberSlot(slot: SlotPosition): string {
  return `member-slot:${slot}`;
}

function isSlotPosition(value: string): value is SlotPosition {
  return (
    value === SlotPosition.LEFT || value === SlotPosition.CENTER || value === SlotPosition.RIGHT
  );
}
