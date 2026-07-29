import { isMemberCardData } from '../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingSpecialMemberPlayState,
} from '../domain/entities/game.js';
import {
  canMemberBeRelayedAway,
  costCalculator,
  type CostPaymentPlan,
} from '../domain/rules/cost-calculator.js';
import { getMemberEffectiveCost } from '../domain/rules/member-effective-cost.js';
import type { CardDefinedSpecialMemberPlayMode } from '../shared/rules/member-play-options.js';
import { N_BP7_011_CONTINUOUS_PLAY_SHUFFLE_WAITING_MEMBERS_COST_MINUS_TWO_ABILITY_ID } from './card-effects/ability-ids.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  enqueueEnterWaitingRoomTriggersFromDiscardResult,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from './card-effects/runtime/enter-waiting-room-triggers.js';
import { shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from './card-effects/runtime/waiting-room-main-deck-triggers.js';
import type {
  BeginSpecialMemberPlayCommand,
  ConfirmSpecialMemberPlayCommand,
  PlayMemberToSlotCommand,
} from './game-commands.js';
import { GameCommandType } from './game-commands.js';
import { getManualOperationMode } from './manual-operation-mode.js';
import { buildPlayMemberCostResources } from './effects/play-member-cost.js';
import {
  LL_BP7_001_SPECIAL_PLAY_COST,
  LL_BP7_001_SPECIAL_PLAY_PRINTED_COST,
  LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES,
  N_BP7_011_SPECIAL_PLAY_COST,
  N_BP7_011_SPECIAL_PLAY_PRINTED_COST,
  assignLlBp7001SpecialPlayPayment,
  canAssignLlBp7001SpecialPlayPayment,
  getLlBp7001SpecialPlayHandCandidateIds,
  getLlBp7001SpecialPlayPaymentAssignment,
  getLlBp7001SpecialPlayTargetSlots,
  getNBp7011SpecialPlayTargetSlots,
  getNBp7011WaitingRoomMemberCardIds,
  isLlBp7001SpecialPlaySource,
  isNBp7011SpecialPlaySource,
} from './effects/special-member-play.js';

interface SpecialMemberPlayProcedure {
  readonly mode: CardDefinedSpecialMemberPlayMode;
  readonly pendingUi: SpecialMemberPlayPendingUiConfig;
  validateBegin(game: GameState, command: BeginSpecialMemberPlayCommand): string | null;
  createPending(
    game: GameState,
    command: BeginSpecialMemberPlayCommand,
    pendingId: string
  ): PendingSpecialMemberPlayState;
  validateConfirm(
    game: GameState,
    command: ConfirmSpecialMemberPlayCommand,
    pending: PendingSpecialMemberPlayState
  ): string | null;
  resolve<TPublicEvent>(
    game: GameState,
    command: ConfirmSpecialMemberPlayCommand,
    pending: PendingSpecialMemberPlayState,
    dependencies: SpecialMemberPlayProcedureDependencies<TPublicEvent>
  ): SpecialMemberPlayProcedureResult<TPublicEvent>;
}

export interface SpecialMemberPlayPendingUiConfig {
  readonly minSelectableObjects: number;
  readonly maxSelectableObjects: number;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly confirmSelectionLabel: string;
}

export interface SpecialMemberPlayConfirmationQuery {
  readonly pendingUi: SpecialMemberPlayPendingUiConfig;
  readonly candidateCardIds: readonly string[];
  readonly confirmation:
    | {
        readonly available: true;
        readonly witnessCardIds: readonly string[];
        readonly paymentPreview: {
          readonly modifiedCost: number;
          readonly energyCost: number;
          readonly relayDiscount: number;
        };
      }
    | {
        readonly available: false;
        readonly reason: string;
      };
}

export interface SpecialMemberPlayProcedureDependencies<TPublicEvent> {
  readonly applyCostPaymentToState: (
    game: GameState,
    payment: NonNullable<GameState['pendingCostPayment']>,
    energyCardIds: readonly string[]
  ) => GameState;
  readonly applyPlayMemberToSlotWithoutCostPrompt: (
    game: GameState,
    command: PlayMemberToSlotCommand,
    isRelayOverride?: boolean
  ) =>
    | {
        readonly success: true;
        readonly gameState: GameState;
        readonly extraPublicEvents?: readonly TPublicEvent[];
      }
    | {
        readonly success: false;
        readonly gameState: GameState;
        readonly error?: string;
      };
  readonly formatPlayMemberCostExplanation: (plan: CostPaymentPlan) => string;
  readonly enqueueTriggeredCardEffectsForEnterWaitingRoom: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}

export type SpecialMemberPlayProcedureResult<TPublicEvent> =
  | {
      readonly success: false;
      readonly gameState: GameState;
      readonly error: string;
    }
  | {
      readonly success: true;
      readonly gameState: GameState;
      readonly extraPublicEvents?: readonly TPublicEvent[];
      readonly revealedHandCardIds?: readonly string[];
      readonly sealedAuditPayload?: Readonly<Record<string, unknown>>;
    };

function buildProcedurePayment(
  pending: PendingSpecialMemberPlayState,
  resources: NonNullable<ReturnType<typeof buildPlayMemberCostResources>>,
  plan: CostPaymentPlan,
  explanation: string
): NonNullable<GameState['pendingCostPayment']> {
  return {
    id: `${pending.id}-cost`,
    playerId: pending.playerId,
    source: 'PLAY_MEMBER',
    sourceCardId: pending.sourceCardId,
    targetSlot: pending.targetSlot,
    baseCost: plan.totalCost,
    finalEnergyCost: plan.actualEnergyCost,
    relayDiscount: plan.relayDiscount,
    replacedMemberCardId: plan.memberToRelay,
    relayReplacements: plan.relayReplacements,
    payableEnergyCardIds: resources.activeEnergyIds,
    explanation,
  };
}

function buildPlayCommand(
  pending: PendingSpecialMemberPlayState,
  timestamp: number,
  occupiedTarget: boolean
): PlayMemberToSlotCommand {
  return {
    type: GameCommandType.PLAY_MEMBER_TO_SLOT,
    playerId: pending.playerId,
    cardId: pending.sourceCardId,
    targetSlot: pending.targetSlot,
    ...(occupiedTarget ? { relayMode: 'SINGLE' as const } : {}),
    timestamp,
  };
}

function shouldUseFreeModeRelay(game: GameState, pending: PendingSpecialMemberPlayState): boolean {
  const player = getPlayerById(game, pending.playerId);
  const source = game.cardRegistry.get(pending.sourceCardId);
  const occupantId = player?.memberSlots.slots[pending.targetSlot] ?? null;
  const occupant = occupantId ? game.cardRegistry.get(occupantId) : null;
  return (
    source !== undefined &&
    occupant !== null &&
    occupant !== undefined &&
    isMemberCardData(source.data) &&
    isMemberCardData(occupant.data) &&
    canMemberBeRelayedAway(occupant.data, source.data)
  );
}

function playAfterProcedure<TPublicEvent>(
  game: GameState,
  command: ConfirmSpecialMemberPlayCommand,
  pending: PendingSpecialMemberPlayState,
  dependencies: SpecialMemberPlayProcedureDependencies<TPublicEvent>,
  specialPlayCost: number
):
  | {
      readonly success: true;
      readonly gameState: GameState;
      readonly extraPublicEvents?: readonly TPublicEvent[];
      readonly audit: Readonly<Record<string, unknown>>;
    }
  | {
      readonly success: false;
      readonly gameState: GameState;
      readonly error: string;
    } {
  const player = getPlayerById(game, pending.playerId);
  const sourceCard = game.cardRegistry.get(pending.sourceCardId);
  if (!player || !sourceCard || !isMemberCardData(sourceCard.data)) {
    return { success: false, gameState: game, error: '特殊登场来源已失效' };
  }

  const occupiedTarget = player.memberSlots.slots[pending.targetSlot] !== null;
  if (getManualOperationMode(game) === 'FREE') {
    const replacedMemberCardId = player.memberSlots.slots[pending.targetSlot] ?? null;
    const useRelay = shouldUseFreeModeRelay(game, pending);
    const effectiveCost =
      useRelay && replacedMemberCardId
        ? getMemberEffectiveCost(game, pending.playerId, replacedMemberCardId)
        : 0;
    const relayReplacements =
      useRelay && replacedMemberCardId
        ? [
            {
              cardId: replacedMemberCardId,
              slot: pending.targetSlot,
              effectiveCost,
            },
          ]
        : [];
    const playResult = dependencies.applyPlayMemberToSlotWithoutCostPrompt(
      game,
      {
        type: GameCommandType.PLAY_MEMBER_TO_SLOT,
        playerId: pending.playerId,
        cardId: pending.sourceCardId,
        targetSlot: pending.targetSlot,
        timestamp: command.timestamp,
      },
      useRelay
    );
    if (!playResult.success) {
      return {
        success: false,
        gameState: game,
        error: playResult.error ?? '特殊登场执行失败',
      };
    }
    return {
      success: true,
      gameState: playResult.gameState,
      extraPublicEvents: playResult.extraPublicEvents,
      audit: {
        manualOperationMode: 'FREE',
        relayReplacement: useRelay ? replacedMemberCardId : null,
        relayReplacements,
        relayDiscount: useRelay ? effectiveCost : 0,
        paidEnergyCardIds: [],
        paidEnergyCount: 0,
      },
    };
  }

  const costQuery = querySpecialMemberPlayCostPlan(game, pending, specialPlayCost);
  if (!costQuery.ok) {
    return {
      success: false,
      gameState: game,
      error: costQuery.reason,
    };
  }
  const { resources, plan } = costQuery;

  const payment = buildProcedurePayment(
    pending,
    resources,
    plan,
    dependencies.formatPlayMemberCostExplanation(plan)
  );
  const paidState = dependencies.applyCostPaymentToState(game, payment, plan.energyToTap);
  const playResult = dependencies.applyPlayMemberToSlotWithoutCostPrompt(
    paidState,
    buildPlayCommand(pending, command.timestamp, occupiedTarget),
    plan.isRelay
  );
  if (!playResult.success) {
    return {
      success: false,
      gameState: game,
      error: playResult.error ?? '特殊登场执行失败',
    };
  }
  return {
    success: true,
    gameState: playResult.gameState,
    extraPublicEvents: playResult.extraPublicEvents,
    audit: {
      manualOperationMode: 'RULES',
      relayReplacement: plan.memberToRelay,
      relayReplacements: plan.relayReplacements,
      relayDiscount: plan.relayDiscount,
      paidEnergyCardIds: [...plan.energyToTap],
      paidEnergyCount: plan.actualEnergyCost,
    },
  };
}

function querySpecialMemberPlayCostPlan(
  game: GameState,
  pending: PendingSpecialMemberPlayState,
  specialPlayCost: number
):
  | {
      readonly ok: true;
      readonly resources: NonNullable<ReturnType<typeof buildPlayMemberCostResources>>;
      readonly plan: CostPaymentPlan;
    }
  | { readonly ok: false; readonly reason: string } {
  const player = getPlayerById(game, pending.playerId);
  const sourceCard = game.cardRegistry.get(pending.sourceCardId);
  if (!player || !sourceCard || !isMemberCardData(sourceCard.data)) {
    return { ok: false, reason: '特殊登场来源已失效' };
  }
  const resources = buildPlayMemberCostResources(game, pending.playerId, pending.sourceCardId);
  if (!resources) {
    return { ok: false, reason: '无法计算本次特殊登场费用' };
  }
  const occupiedTarget = player.memberSlots.slots[pending.targetSlot] !== null;
  const costCheck = costCalculator.checkCanPayCost(sourceCard.data, pending.targetSlot, resources, {
    specialPlayBaseCost: specialPlayCost,
    ...(occupiedTarget ? { relayMode: 'SINGLE' as const } : {}),
  });
  const plan = costCalculator.selectOptimalPlan(costCheck.availablePlans);
  return plan
    ? { ok: true, resources, plan }
    : {
        ok: false,
        reason: costCheck.reason ?? '活跃能量不足以完成本次特殊登场',
      };
}

const LL_BP7_001_PROCEDURE: SpecialMemberPlayProcedure = {
  mode: 'LL_BP7_001_SPECIAL_PLAY',
  pendingUi: {
    minSelectableObjects: 3,
    maxSelectableObjects: 3,
    stepText: '请选择「国木田花丸」「优木雪菜」「岚千砂都」的成员卡各1张放置入休息室。',
    selectionLabel: '选择要放置入休息室的指定成员',
    confirmSelectionLabel: '放置入休息室并登场',
  },
  validateBegin(game, command) {
    if (!isLlBp7001SpecialPlaySource(game, command.playerId, command.cardId)) {
      return '特殊登场来源已失效';
    }
    if (
      !getLlBp7001SpecialPlayTargetSlots(game, command.playerId, command.cardId).includes(
        command.targetSlot
      )
    ) {
      return '该成员区不能用于本次特殊登场';
    }
    return canAssignLlBp7001SpecialPlayPayment(game, command.playerId, command.cardId)
      ? null
      : '手牌中没有可完成指定姓名支付的成员';
  },
  createPending(game, command, pendingId) {
    return {
      id: pendingId,
      playerId: command.playerId,
      sourceCardId: command.cardId,
      targetSlot: command.targetSlot,
      mode: 'LL_BP7_001_SPECIAL_PLAY',
      printedCost: LL_BP7_001_SPECIAL_PLAY_PRINTED_COST,
      specialPlayCost: LL_BP7_001_SPECIAL_PLAY_COST,
      candidateCardIds: getLlBp7001SpecialPlayHandCandidateIds(
        game,
        command.playerId,
        command.cardId
      ),
    };
  },
  validateConfirm(game, command, pending) {
    return assignLlBp7001SpecialPlayPayment(
      game,
      command.playerId,
      pending.sourceCardId,
      command.selectedCardIds
    ).length === LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES.length
      ? null
      : '必须选择可分别满足三个指定姓名的三张不同成员';
  },
  resolve(game, command, pending, dependencies) {
    if (
      !isLlBp7001SpecialPlaySource(game, command.playerId, pending.sourceCardId) ||
      !getLlBp7001SpecialPlayTargetSlots(game, command.playerId, pending.sourceCardId).includes(
        pending.targetSlot
      )
    ) {
      return { success: false, gameState: game, error: '特殊登场来源或目标已失效' };
    }
    const sourceCard = game.cardRegistry.get(pending.sourceCardId);
    if (
      !sourceCard ||
      !isMemberCardData(sourceCard.data) ||
      sourceCard.data.cost !== LL_BP7_001_SPECIAL_PLAY_PRINTED_COST ||
      pending.printedCost !== LL_BP7_001_SPECIAL_PLAY_PRINTED_COST ||
      pending.specialPlayCost !== LL_BP7_001_SPECIAL_PLAY_COST
    ) {
      return { success: false, gameState: game, error: '特殊登场费用上下文已失效' };
    }
    const assignment = assignLlBp7001SpecialPlayPayment(
      game,
      command.playerId,
      pending.sourceCardId,
      command.selectedCardIds
    );
    if (assignment.length !== LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES.length) {
      return { success: false, gameState: game, error: '指定姓名支付不完整' };
    }

    const selectedIds = assignment.map(({ cardId }) => cardId);
    const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
      { ...game, pendingSpecialMemberPlay: null },
      command.playerId,
      selectedIds,
      { count: 3, candidateCardIds: pending.candidateCardIds },
      (nextGame) => nextGame
    );
    if (!discardResult?.enterWaitingRoomEvent) {
      return { success: false, gameState: game, error: '指定姓名支付已失效' };
    }

    const played = playAfterProcedure(
      discardResult.gameState,
      command,
      pending,
      dependencies,
      LL_BP7_001_SPECIAL_PLAY_COST
    );
    if (!played.success) {
      return { ...played, gameState: game };
    }
    const completedState = enqueueEnterWaitingRoomTriggersFromDiscardResult(
      played.gameState,
      discardResult,
      dependencies.enqueueTriggeredCardEffectsForEnterWaitingRoom
    );
    const auditPayload = {
      step: 'CONFIRM',
      sourceCardId: pending.sourceCardId,
      targetSlot: pending.targetSlot,
      mode: pending.mode,
      printedCost: pending.printedCost,
      specialPlayCost: pending.specialPlayCost,
      namedPayments: assignment,
      ...played.audit,
      waitingRoomEventId: discardResult.enterWaitingRoomEvent.eventId,
    };
    return {
      success: true,
      gameState: addAction(completedState, 'SPECIAL_MEMBER_PLAY', command.playerId, auditPayload),
      extraPublicEvents: played.extraPublicEvents,
      revealedHandCardIds: selectedIds,
      sealedAuditPayload: auditPayload,
    };
  },
};

const N_BP7_011_PROCEDURE: SpecialMemberPlayProcedure = {
  mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
  pendingUi: {
    minSelectableObjects: 0,
    maxSelectableObjects: 0,
    stepText: '将自己休息室中的所有成员卡洗切并放置于卡组底，使此卡本次登场费用减2。',
    selectionLabel: '将放置于卡组底的成员卡',
    confirmSelectionLabel: '放置于卡组底并登场',
  },
  validateBegin(game, command) {
    if (!isNBp7011SpecialPlaySource(game, command.playerId, command.cardId)) {
      return '特殊登场来源已失效';
    }
    if (
      !getNBp7011SpecialPlayTargetSlots(game, command.playerId, command.cardId).includes(
        command.targetSlot
      )
    ) {
      return '该成员区不能用于本次特殊登场';
    }
    return getNBp7011WaitingRoomMemberCardIds(game, command.playerId, command.cardId).length > 0
      ? null
      : '休息室中没有可放置于卡组底的成员卡';
  },
  createPending(game, command, pendingId) {
    return {
      id: pendingId,
      playerId: command.playerId,
      sourceCardId: command.cardId,
      targetSlot: command.targetSlot,
      mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
      printedCost: N_BP7_011_SPECIAL_PLAY_PRINTED_COST,
      specialPlayCost: N_BP7_011_SPECIAL_PLAY_COST,
      candidateCardIds: getNBp7011WaitingRoomMemberCardIds(game, command.playerId, command.cardId),
    };
  },
  validateConfirm(_game, command) {
    return command.selectedCardIds.length === 0 ? null : '本次特殊登场不需要选择卡牌';
  },
  resolve(game, command, pending, dependencies) {
    if (
      command.selectedCardIds.length !== 0 ||
      !isNBp7011SpecialPlaySource(game, command.playerId, pending.sourceCardId) ||
      !getNBp7011SpecialPlayTargetSlots(game, command.playerId, pending.sourceCardId).includes(
        pending.targetSlot
      ) ||
      pending.printedCost !== N_BP7_011_SPECIAL_PLAY_PRINTED_COST ||
      pending.specialPlayCost !== N_BP7_011_SPECIAL_PLAY_COST
    ) {
      return {
        success: false,
        gameState: game,
        error: '特殊登场来源或费用上下文已失效',
      };
    }
    const waitingRoomMemberCardIds = getNBp7011WaitingRoomMemberCardIds(
      game,
      command.playerId,
      pending.sourceCardId
    );
    if (waitingRoomMemberCardIds.length === 0) {
      return {
        success: false,
        gameState: game,
        error: '休息室中没有可放置于卡组底的成员卡',
      };
    }

    const moved = shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
      { ...game, pendingSpecialMemberPlay: null },
      command.playerId,
      waitingRoomMemberCardIds,
      {
        kind: 'CARD_EFFECT',
        playerId: command.playerId,
        sourceCardId: pending.sourceCardId,
        abilityId: N_BP7_011_CONTINUOUS_PLAY_SHUFFLE_WAITING_MEMBERS_COST_MINUS_TWO_ABILITY_ID,
      }
    );
    if (!moved || moved.movedCardIds.length !== waitingRoomMemberCardIds.length) {
      return { success: false, gameState: game, error: '休息室成员卡移动已失效' };
    }

    const played = playAfterProcedure(
      moved.gameState,
      command,
      pending,
      dependencies,
      N_BP7_011_SPECIAL_PLAY_COST
    );
    if (!played.success) {
      return { ...played, gameState: game };
    }
    const auditPayload = {
      step: 'CONFIRM_WAITING_MEMBERS_COST_MINUS_TWO',
      sourceCardId: pending.sourceCardId,
      targetSlot: pending.targetSlot,
      mode: pending.mode,
      printedCost: pending.printedCost,
      specialPlayCost: pending.specialPlayCost,
      movedCardIds: moved.movedCardIds,
      waitingRoomToMainDeckEventId: moved.waitingRoomCardsMovedToMainDeckEvent?.eventId ?? null,
      ...played.audit,
    };
    return {
      success: true,
      gameState: addAction(played.gameState, 'SPECIAL_MEMBER_PLAY', command.playerId, auditPayload),
      extraPublicEvents: played.extraPublicEvents,
    };
  },
};

const SPECIAL_MEMBER_PLAY_PROCEDURES = {
  [LL_BP7_001_PROCEDURE.mode]: LL_BP7_001_PROCEDURE,
  [N_BP7_011_PROCEDURE.mode]: N_BP7_011_PROCEDURE,
} as const;

function getProcedure(mode: string): SpecialMemberPlayProcedure | null {
  return (
    SPECIAL_MEMBER_PLAY_PROCEDURES[mode as keyof typeof SPECIAL_MEMBER_PLAY_PROCEDURES] ?? null
  );
}

export function getSpecialMemberPlayPendingUiConfig(
  pending: PendingSpecialMemberPlayState
): SpecialMemberPlayPendingUiConfig | null {
  return getProcedure(pending.mode)?.pendingUi ?? null;
}

export function querySpecialMemberPlayConfirmation(
  game: GameState,
  pending: PendingSpecialMemberPlayState
): SpecialMemberPlayConfirmationQuery | null {
  const procedure = getProcedure(pending.mode);
  if (!procedure) return null;

  if (pending.mode === 'LL_BP7_001_SPECIAL_PLAY') {
    const currentCandidateIds = getLlBp7001SpecialPlayHandCandidateIds(
      game,
      pending.playerId,
      pending.sourceCardId
    ).filter((cardId) => pending.candidateCardIds.includes(cardId));
    const witnessCardIds = getLlBp7001SpecialPlayPaymentAssignment(
      game,
      pending.playerId,
      pending.sourceCardId,
      currentCandidateIds
    ).map(({ cardId }) => cardId);
    const contextError =
      !isLlBp7001SpecialPlaySource(game, pending.playerId, pending.sourceCardId) ||
      !getLlBp7001SpecialPlayTargetSlots(game, pending.playerId, pending.sourceCardId).includes(
        pending.targetSlot
      ) ||
      pending.printedCost !== LL_BP7_001_SPECIAL_PLAY_PRINTED_COST ||
      pending.specialPlayCost !== LL_BP7_001_SPECIAL_PLAY_COST
        ? '特殊登场来源、目标或费用上下文已失效'
        : witnessCardIds.length !== LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES.length
          ? '手牌中没有可完成指定姓名支付的成员'
          : null;
    return buildSpecialMemberPlayConfirmationQuery(
      game,
      pending,
      procedure.pendingUi,
      currentCandidateIds,
      witnessCardIds,
      contextError
    );
  }

  const currentCandidateIds = getNBp7011WaitingRoomMemberCardIds(
    game,
    pending.playerId,
    pending.sourceCardId
  );
  const contextError =
    !isNBp7011SpecialPlaySource(game, pending.playerId, pending.sourceCardId) ||
    !getNBp7011SpecialPlayTargetSlots(game, pending.playerId, pending.sourceCardId).includes(
      pending.targetSlot
    ) ||
    pending.printedCost !== N_BP7_011_SPECIAL_PLAY_PRINTED_COST ||
    pending.specialPlayCost !== N_BP7_011_SPECIAL_PLAY_COST ||
    currentCandidateIds.length === 0
      ? '特殊登场来源、目标、费用或休息室成员上下文已失效'
      : null;
  return buildSpecialMemberPlayConfirmationQuery(
    game,
    pending,
    procedure.pendingUi,
    currentCandidateIds,
    [],
    contextError
  );
}

function buildSpecialMemberPlayConfirmationQuery(
  game: GameState,
  pending: PendingSpecialMemberPlayState,
  pendingUi: SpecialMemberPlayPendingUiConfig,
  candidateCardIds: readonly string[],
  witnessCardIds: readonly string[],
  contextError: string | null
): SpecialMemberPlayConfirmationQuery {
  const costQuery = contextError
    ? null
    : querySpecialMemberPlayCostPlan(game, pending, pending.specialPlayCost);
  const confirmation =
    contextError !== null
      ? ({ available: false, reason: contextError } as const)
      : costQuery?.ok
        ? ({
            available: true,
            witnessCardIds,
            paymentPreview: {
              modifiedCost: costQuery.plan.modifiedCost,
              energyCost: costQuery.plan.actualEnergyCost,
              relayDiscount: costQuery.plan.relayDiscount,
            },
          } as const)
        : ({
            available: false,
            reason: costQuery?.reason ?? '无法计算本次特殊登场费用',
          } as const);
  return { pendingUi, candidateCardIds, confirmation };
}

export function validateBeginSpecialMemberPlay(
  game: GameState,
  command: BeginSpecialMemberPlayCommand
): string | null {
  const procedure = getProcedure(command.mode);
  return procedure ? procedure.validateBegin(game, command) : '不支持的特殊登场方式';
}

export function createPendingSpecialMemberPlay(
  game: GameState,
  command: BeginSpecialMemberPlayCommand,
  pendingId: string
): PendingSpecialMemberPlayState | null {
  return getProcedure(command.mode)?.createPending(game, command, pendingId) ?? null;
}

export function validateConfirmSpecialMemberPlay(
  game: GameState,
  command: ConfirmSpecialMemberPlayCommand,
  pending: PendingSpecialMemberPlayState
): string | null {
  const procedure = getProcedure(pending.mode);
  return procedure ? procedure.validateConfirm(game, command, pending) : '特殊登场选择窗口已失效';
}

export function resolveSpecialMemberPlay<TPublicEvent>(
  game: GameState,
  command: ConfirmSpecialMemberPlayCommand,
  pending: PendingSpecialMemberPlayState,
  dependencies: SpecialMemberPlayProcedureDependencies<TPublicEvent>
): SpecialMemberPlayProcedureResult<TPublicEvent> {
  const procedure = getProcedure(pending.mode);
  return procedure
    ? procedure.resolve(game, command, pending, dependencies)
    : { success: false, gameState: game, error: '特殊登场选择窗口已失效' };
}
