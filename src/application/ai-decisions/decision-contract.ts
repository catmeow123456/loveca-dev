import { isLiveCardData } from '../../domain/entities/card.js';
import type {
  ActiveEffectState,
  GameState,
  PendingSpecialMemberPlayState,
} from '../../domain/entities/game.js';
import {
  getLiveSetCardIdsForPlayer,
  getLiveSetCardLimitForPlayer,
  getCardById,
  getPlayerById,
} from '../../domain/entities/game.js';
import {
  getCurrentSuccessLiveSettlementPlayerId,
  getSuccessLiveSelectionCandidateIds,
} from '../../domain/rules/success-live-placement.js';
import { FaceState, GamePhase, SlotPosition, SubPhase } from '../../shared/types/enums.js';
import { createBlindCardSelectionToken } from '../../shared/utils/blind-card-selection.js';
import {
  getPublicCardSelectionConfirmationConfig,
  matchesPublicCardSelectionGroups,
} from '../card-effects/runtime/public-card-selection-confirmation.js';
import {
  GameCommandType,
  type ConfirmEffectStepCommand,
  type GameCommand,
} from '../game-commands.js';
import { getManualOperationMode } from '../manual-operation-mode.js';
import { getSeatForPlayer, projectPlayerViewState, type Seat } from '../../online/index.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';
import {
  querySpecialMemberPlayConfirmation,
  validateConfirmSpecialMemberPlay,
} from '../special-member-play-procedures.js';
import {
  collectAiMainPhaseLegalActions,
  type AiLegalMainPhaseAction,
} from './main-phase-legal-actions.js';

export const AI_DECISION_CONTRACT_SCHEMA_VERSION = AI_BATTLE_PROTOCOL_VERSIONS.decision.contract;
export const AI_DECISION_COMMAND_ADAPTER_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.decision.commandAdapter;

export interface AiDecisionCandidate {
  /** 只在当前 contract 内有效，不包含权威实体 ID。 */
  readonly candidateId: string;
  readonly projectedIndex: number;
}

export interface AiDecisionOption {
  /** 只在当前 contract 内有效，不直接暴露 workflow option ID。 */
  readonly optionId: string;
  readonly label: string;
}

export interface AiDecisionSelectionGroup {
  readonly groupId: string;
  readonly candidateIds: readonly string[];
  readonly minCount: number;
  readonly maxCount: number;
}

interface AiDecisionContractBase {
  readonly schemaVersion: typeof AI_DECISION_CONTRACT_SCHEMA_VERSION;
  readonly commandAdapterVersion: typeof AI_DECISION_COMMAND_ADAPTER_VERSION;
  readonly decisionId: string;
  readonly authorityRevision: number;
  readonly seat: Seat;
  readonly windowSignature: string;
  readonly mandatory: boolean;
}

export interface AiMulliganDecisionContract extends AiDecisionContractBase {
  readonly kind: 'MULLIGAN';
  readonly candidates: readonly AiDecisionCandidate[];
  readonly minSelections: 0;
  readonly maxSelections: number;
}

export interface AiCostPaymentDecisionContract extends AiDecisionContractBase {
  readonly kind: 'COST_PAYMENT';
  readonly candidates: readonly AiDecisionCandidate[];
  readonly requiredCount: number;
}

export interface AiScoreConfirmationDecisionContract extends AiDecisionContractBase {
  readonly kind: 'SCORE_CONFIRMATION';
  readonly authorityScore: number;
}

export interface AiJudgmentConfirmationDecisionContract extends AiDecisionContractBase {
  readonly kind: 'JUDGMENT_CONFIRMATION';
}

export interface AiSuccessLiveDecisionContract extends AiDecisionContractBase {
  readonly kind: 'SUCCESS_LIVE_SELECTION';
  readonly candidates: readonly AiDecisionCandidate[];
}

export interface AiPhaseConfirmationDecisionContract extends AiDecisionContractBase {
  readonly kind: 'PHASE_CONFIRMATION';
  readonly subPhase: SubPhase;
}

export interface AiMainPhaseAction {
  readonly actionId: string;
  readonly kind:
    'PLAY_MEMBER' | 'BEGIN_SPECIAL_MEMBER_PLAY' | 'ACTIVATE_ABILITY' | 'END_MAIN_PHASE';
  readonly sourceCandidateId?: string;
  readonly targetSlot?: SlotPosition;
  readonly relayMode?: 'DOUBLE';
  readonly relayReplacementSlots?: readonly SlotPosition[];
  readonly label?: string;
  readonly paymentPreview?: {
    readonly modifiedCost: number;
    readonly energyCost: number;
    readonly relayDiscount: number;
    readonly replacementCount: number;
  };
}

export interface AiMainPhaseDecisionContract extends AiDecisionContractBase {
  readonly kind: 'MAIN_PHASE';
  readonly candidates: readonly AiDecisionCandidate[];
  readonly actions: readonly AiMainPhaseAction[];
}

export interface AiLiveSetAction {
  readonly actionId: string;
  readonly kind: 'SET_LIVE' | 'UNSET_LIVE' | 'CONFIRM_LIVE_SET';
  readonly candidateId?: string;
  /** Own-hand card type is visible and lets conservative policy prefer an actual LIVE. */
  readonly isLiveCard?: boolean;
}

export interface AiLiveSetDecisionContract extends AiDecisionContractBase {
  readonly kind: 'LIVE_SET';
  readonly handCandidates: readonly AiDecisionCandidate[];
  readonly liveZoneCandidates: readonly AiDecisionCandidate[];
  readonly actions: readonly AiLiveSetAction[];
  readonly setCount: number;
  readonly setLimit: number;
}

export interface AiSpecialMemberPlayDecisionContract extends AiDecisionContractBase {
  readonly kind: 'SPECIAL_MEMBER_PLAY';
  readonly mode: PendingSpecialMemberPlayState['mode'];
  readonly candidates: readonly AiDecisionCandidate[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly canConfirm: boolean;
  readonly canCancel: true;
  readonly stepText: string;
  readonly confirmationLabel: string;
  readonly confirmationUnavailableReason?: string;
  readonly paymentPreview?: {
    readonly modifiedCost: number;
    readonly energyCost: number;
    readonly relayDiscount: number;
  };
}

export interface AiEffectConfirmationInput {
  readonly kind: 'CONFIRM';
}

export interface AiEffectCardSelectionInput {
  readonly kind: 'CARD_SELECTION';
  readonly candidates: readonly AiDecisionCandidate[];
  readonly ordered: boolean;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly canSkip: boolean;
  readonly groups: readonly AiDecisionSelectionGroup[];
}

export interface AiEffectOptionSelectionInput {
  readonly kind: 'OPTION_SELECTION';
  readonly options: readonly AiDecisionOption[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly canSkip: boolean;
}

export interface AiEffectSlotSelectionInput {
  readonly kind: 'SLOT_SELECTION';
  readonly slots: readonly SlotPosition[];
  readonly canSkip: boolean;
}

export interface AiEffectNumberInput {
  readonly kind: 'NUMBER_INPUT';
  readonly min?: number;
  readonly max?: number;
  readonly integerOnly: boolean;
}

export interface AiEffectStageFormationInput {
  readonly kind: 'STAGE_FORMATION';
  readonly members: readonly {
    readonly candidateId: string;
    readonly originalSlot: SlotPosition;
  }[];
  readonly slots: readonly SlotPosition[];
  readonly canSkip: boolean;
}

export interface AiEffectAbilityOrderInput {
  readonly kind: 'ABILITY_ORDER';
  readonly candidates: readonly AiDecisionCandidate[];
  readonly options: readonly AiDecisionOption[];
  readonly canResolveInOrder: boolean;
}

export type AiEffectDeadlineInput =
  | {
      readonly kind: 'DEADLINE_CONFIRMATION';
      readonly deadlineKind: 'PUBLIC_CARD_SELECTION' | 'PUBLIC_EFFECT_CHOICE';
      readonly autoAdvanceAt: number;
    }
  | {
      readonly kind: 'DEADLINE_CONFIRMATION';
      readonly deadlineKind: 'PUBLIC_REVEAL';
      readonly autoAdvanceAt: number;
      readonly generation: string;
    };

export type AiEffectDecisionInput =
  | AiEffectConfirmationInput
  | AiEffectCardSelectionInput
  | AiEffectOptionSelectionInput
  | AiEffectSlotSelectionInput
  | AiEffectNumberInput
  | AiEffectStageFormationInput
  | AiEffectAbilityOrderInput
  | AiEffectDeadlineInput;

export interface AiActiveEffectDecisionContract extends AiDecisionContractBase {
  readonly kind: 'ACTIVE_EFFECT';
  readonly effectRef: 'CURRENT';
  readonly abilityId: string;
  readonly stepId: string;
  readonly input: AiEffectDecisionInput;
}

export type AiDecisionContract =
  | AiMulliganDecisionContract
  | AiCostPaymentDecisionContract
  | AiJudgmentConfirmationDecisionContract
  | AiScoreConfirmationDecisionContract
  | AiSuccessLiveDecisionContract
  | AiPhaseConfirmationDecisionContract
  | AiMainPhaseDecisionContract
  | AiLiveSetDecisionContract
  | AiSpecialMemberPlayDecisionContract
  | AiActiveEffectDecisionContract;

export type AiDecisionSelection =
  | { readonly kind: 'MULLIGAN'; readonly candidateIds: readonly string[] }
  | { readonly kind: 'PAY_COST'; readonly candidateIds: readonly string[] }
  | { readonly kind: 'CONFIRM_JUDGMENT' }
  | { readonly kind: 'CONFIRM_SCORE' }
  | { readonly kind: 'SELECT_SUCCESS_LIVE'; readonly candidateId: string }
  | { readonly kind: 'CONFIRM_PHASE' }
  | { readonly kind: 'SELECT_MAIN_PHASE_ACTION'; readonly actionId: string }
  | { readonly kind: 'SELECT_LIVE_SET_ACTION'; readonly actionId: string }
  | {
      readonly kind: 'CONFIRM_SPECIAL_MEMBER_PLAY';
      readonly candidateIds: readonly string[];
    }
  | { readonly kind: 'CANCEL_SPECIAL_MEMBER_PLAY' }
  | { readonly kind: 'CONFIRM_EFFECT' }
  | { readonly kind: 'SELECT_EFFECT_CARDS'; readonly candidateIds: readonly string[] }
  | { readonly kind: 'SELECT_EFFECT_OPTIONS'; readonly optionIds: readonly string[] }
  | { readonly kind: 'SELECT_EFFECT_SLOT'; readonly slot: SlotPosition }
  | { readonly kind: 'SELECT_EFFECT_NUMBER'; readonly value: number }
  | {
      readonly kind: 'SET_STAGE_FORMATION';
      readonly placements: readonly {
        readonly candidateId: string;
        readonly toSlot: SlotPosition;
      }[];
    }
  | { readonly kind: 'RESOLVE_ABILITIES_IN_ORDER' }
  | { readonly kind: 'CONFIRM_DEADLINE' };

export interface AiDecisionContractHandle {
  readonly contract: AiDecisionContract;
}

export type AiDecisionContractBuildResult =
  | { readonly ok: true; readonly handle: AiDecisionContractHandle }
  | {
      readonly ok: false;
      readonly reason: 'NO_DECISION' | 'UNSUPPORTED_WINDOW' | 'INVALID_STATE';
      readonly detail: string;
    };

export type AiDecisionSelectionValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

export type AiDecisionCommandMaterializationResult =
  | { readonly ok: true; readonly command: GameCommand }
  | { readonly ok: false; readonly error: string };

interface CandidateBinding {
  readonly candidateId: string;
  readonly value: string;
  readonly projectedIndex?: number;
}

interface OptionBinding {
  readonly optionId: string;
  readonly value: string;
  readonly label: string;
}

interface ActionBinding {
  readonly actionId: string;
  readonly materialize: (playerId: string, timestamp: number) => GameCommand;
}

interface HandleBindings {
  readonly playerId: string;
  readonly cardCandidates: readonly CandidateBinding[];
  readonly options: readonly OptionBinding[];
  readonly actions?: readonly ActionBinding[];
  readonly paymentId?: string;
  readonly effect?: ActiveEffectState;
  readonly specialMemberPlay?: PendingSpecialMemberPlayState;
  readonly specialMemberPlayWitnessCandidateIds?: readonly string[];
  readonly validateSpecialMemberPlaySelection?: (cardIds: readonly string[]) => string | null;
}

const bindingsByHandle = new WeakMap<AiDecisionContractHandle, HandleBindings>();

export function buildAiDecisionContract(
  game: GameState,
  playerId: string,
  authorityRevision: number,
  now: number = Date.now()
): AiDecisionContractBuildResult {
  if (!Number.isSafeInteger(authorityRevision) || authorityRevision < 0) {
    return {
      ok: false,
      reason: 'INVALID_STATE',
      detail: 'authorityRevision 必须是非负安全整数',
    };
  }
  if (getManualOperationMode(game) !== 'RULES') {
    return {
      ok: false,
      reason: 'UNSUPPORTED_WINDOW',
      detail: 'AI typed decision contract 当前只支持 RULES 模式',
    };
  }
  const player = getPlayerById(game, playerId);
  const seat = getSeatForPlayer(game, playerId);
  if (!player || !seat) {
    return { ok: false, reason: 'INVALID_STATE', detail: '玩家不存在' };
  }

  const view = projectPlayerViewState(game, playerId, { seq: authorityRevision });
  const windowSignature = buildSemanticWindowSignature(game, playerId, view);
  const base = {
    schemaVersion: AI_DECISION_CONTRACT_SCHEMA_VERSION,
    commandAdapterVersion: AI_DECISION_COMMAND_ADAPTER_VERSION,
    decisionId: `${game.gameId}:${authorityRevision}:${seat}:${windowSignature}`,
    authorityRevision,
    seat,
    windowSignature,
  } as const;

  if (game.pendingSpecialMemberPlay) {
    return buildSpecialMemberPlayContract(game, playerId, base);
  }
  if (game.pendingChoice) {
    return {
      ok: false,
      reason: 'INVALID_STATE',
      detail: 'legacy pendingChoice 没有权威命令或 resolver，不能作为机器决策窗口',
    };
  }

  if (game.pendingCostPayment) {
    if (game.pendingCostPayment.playerId !== playerId) {
      return { ok: false, reason: 'NO_DECISION', detail: '当前费用不由该席位支付' };
    }
    const cardCandidates = createCandidateBindings(game.pendingCostPayment.payableEnergyCardIds);
    if (cardCandidates.length < game.pendingCostPayment.finalEnergyCost) {
      return {
        ok: false,
        reason: 'INVALID_STATE',
        detail: '强制费用窗口没有足够的合法支付候选',
      };
    }
    return successHandle(
      {
        ...base,
        kind: 'COST_PAYMENT',
        mandatory: true,
        candidates: toCandidates(cardCandidates),
        requiredCount: game.pendingCostPayment.finalEnergyCost,
      },
      {
        playerId,
        cardCandidates,
        options: [],
        paymentId: game.pendingCostPayment.id,
      }
    );
  }

  if (game.activeEffect) {
    return buildActiveEffectContract(game.activeEffect, playerId, now, base);
  }

  if (game.currentPhase === GamePhase.MULLIGAN_PHASE) {
    if (game.mulliganCompletedPlayers.includes(playerId)) {
      return { ok: false, reason: 'NO_DECISION', detail: '该席位已完成换牌' };
    }
    if (!hasEnabledCommand(view, GameCommandType.MULLIGAN)) {
      return { ok: false, reason: 'NO_DECISION', detail: '当前换牌不由该席位处理' };
    }
    const cardCandidates = createCandidateBindings(player.hand.cardIds);
    return successHandle(
      {
        ...base,
        kind: 'MULLIGAN',
        mandatory: true,
        candidates: toCandidates(cardCandidates),
        minSelections: 0,
        maxSelections: cardCandidates.length,
      },
      { playerId, cardCandidates, options: [] }
    );
  }

  if (
    game.currentPhase === GamePhase.PERFORMANCE_PHASE &&
    game.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT &&
    game.players[game.activePlayerIndex]?.id === playerId
  ) {
    const hasAutomaticJudgmentDraft = player.liveZone.cardIds.every((cardId) =>
      game.liveResolution.liveResults.has(cardId)
    );
    return successHandle(
      hasAutomaticJudgmentDraft
        ? {
            ...base,
            kind: 'PHASE_CONFIRMATION',
            mandatory: true,
            subPhase: game.currentSubPhase,
          }
        : {
            ...base,
            kind: 'JUDGMENT_CONFIRMATION',
            mandatory: true,
          },
      { playerId, cardCandidates: [], options: [] }
    );
  }

  if (
    game.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
    game.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM &&
    !game.liveResolution.scoreConfirmedBy.includes(playerId)
  ) {
    return successHandle(
      {
        ...base,
        kind: 'SCORE_CONFIRMATION',
        mandatory: true,
        authorityScore: game.liveResolution.playerScores.get(playerId) ?? 0,
      },
      { playerId, cardCandidates: [], options: [] }
    );
  }

  if (
    game.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
    game.currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
    getCurrentSuccessLiveSettlementPlayerId(game) === playerId
  ) {
    const cardCandidates = createCandidateBindings(
      getSuccessLiveSelectionCandidateIds(game, playerId)
    );
    if (cardCandidates.length > 0) {
      return successHandle(
        {
          ...base,
          kind: 'SUCCESS_LIVE_SELECTION',
          mandatory: true,
          candidates: toCandidates(cardCandidates),
        },
        { playerId, cardCandidates, options: [] }
      );
    }
  }

  if (game.currentPhase === GamePhase.MAIN_PHASE) {
    return buildMainPhaseContract(game, playerId, base, view);
  }

  if (game.currentPhase === GamePhase.LIVE_SET_PHASE) {
    return buildLiveSetContract(game, playerId, base, view);
  }

  const confirmHint = view.permissions.availableCommands.find(
    (hint) => hint.command === GameCommandType.CONFIRM_STEP && hint.enabled
  );
  if (confirmHint) {
    return successHandle(
      {
        ...base,
        kind: 'PHASE_CONFIRMATION',
        mandatory: true,
        subPhase: game.currentSubPhase,
      },
      { playerId, cardCandidates: [], options: [] }
    );
  }

  return { ok: false, reason: 'NO_DECISION', detail: '当前没有该席位的机器决策窗口' };
}

function buildSpecialMemberPlayContract(
  game: GameState,
  playerId: string,
  base: Omit<AiDecisionContractBase, 'mandatory'>
): AiDecisionContractBuildResult {
  const pending = game.pendingSpecialMemberPlay;
  if (!pending) {
    return { ok: false, reason: 'INVALID_STATE', detail: '特殊登场窗口不存在' };
  }
  if (pending.playerId !== playerId) {
    return { ok: false, reason: 'NO_DECISION', detail: '当前特殊登场不由该席位处理' };
  }
  const query = querySpecialMemberPlayConfirmation(game, pending);
  if (!query) {
    return {
      ok: false,
      reason: 'UNSUPPORTED_WINDOW',
      detail: `不支持的特殊登场确认方式：${pending.mode}`,
    };
  }

  const player = getPlayerById(game, playerId);
  const cardCandidates = createCandidateBindings(
    query.candidateCardIds,
    1,
    query.candidateCardIds.map((cardId) => {
      const handIndex = player?.hand.cardIds.indexOf(cardId) ?? -1;
      if (handIndex >= 0) return handIndex;
      const waitingRoomIndex = player?.waitingRoom.cardIds.indexOf(cardId) ?? -1;
      return waitingRoomIndex >= 0 ? waitingRoomIndex : query.candidateCardIds.indexOf(cardId);
    })
  );
  const witnessCandidateIds = query.confirmation.available
    ? query.confirmation.witnessCardIds.flatMap((cardId) => {
        const candidateId = cardCandidates.find(
          (candidate) => candidate.value === cardId
        )?.candidateId;
        return candidateId ? [candidateId] : [];
      })
    : [];
  if (
    query.confirmation.available &&
    (witnessCandidateIds.length < query.pendingUi.minSelectableObjects ||
      witnessCandidateIds.length > query.pendingUi.maxSelectableObjects)
  ) {
    return {
      ok: false,
      reason: 'INVALID_STATE',
      detail: '特殊登场确认查询没有生成满足数量约束的 witness',
    };
  }

  return successHandle(
    {
      ...base,
      kind: 'SPECIAL_MEMBER_PLAY',
      mandatory: false,
      mode: pending.mode,
      candidates: toCandidates(cardCandidates),
      minSelections: query.pendingUi.minSelectableObjects,
      maxSelections: query.pendingUi.maxSelectableObjects,
      canConfirm: query.confirmation.available,
      canCancel: true,
      stepText: query.pendingUi.stepText,
      confirmationLabel: query.pendingUi.confirmSelectionLabel,
      confirmationUnavailableReason: query.confirmation.available
        ? undefined
        : query.confirmation.reason,
      paymentPreview: query.confirmation.available ? query.confirmation.paymentPreview : undefined,
    },
    {
      playerId,
      cardCandidates,
      options: [],
      specialMemberPlay: pending,
      specialMemberPlayWitnessCandidateIds: witnessCandidateIds,
      validateSpecialMemberPlaySelection: (cardIds) =>
        validateConfirmSpecialMemberPlay(
          game,
          {
            type: GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY,
            playerId,
            pendingId: pending.id,
            selectedCardIds: cardIds,
            timestamp: 0,
          },
          pending
        ),
    }
  );
}

function buildMainPhaseContract(
  game: GameState,
  playerId: string,
  base: Omit<AiDecisionContractBase, 'mandatory'>,
  view: ReturnType<typeof projectPlayerViewState>
): AiDecisionContractBuildResult {
  if (!hasEnabledCommand(view, GameCommandType.END_PHASE)) {
    return { ok: false, reason: 'NO_DECISION', detail: '当前主要阶段不由该席位行动' };
  }

  const query = collectAiMainPhaseLegalActions(game, playerId);
  if (query.unqueriedActivatedAbilities.length > 0) {
    return {
      ok: false,
      reason: 'UNSUPPORTED_WINDOW',
      detail: `当前主要阶段存在 ${query.unqueriedActivatedAbilities.length} 个尚无共源 preflight 的起动能力`,
    };
  }

  const sourceCardIds = [...new Set(query.actions.map((action) => action.sourceCardId))];
  const player = getPlayerById(game, playerId);
  const cardCandidates = createCandidateBindings(
    sourceCardIds,
    1,
    sourceCardIds.map((cardId) => {
      const handIndex = player?.hand.cardIds.indexOf(cardId) ?? -1;
      if (handIndex >= 0) return handIndex;
      const stageIndex = player
        ? [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].findIndex(
            (slot) => player.memberSlots.slots[slot] === cardId
          )
        : -1;
      if (stageIndex >= 0) return stageIndex;
      const waitingRoomIndex = player?.waitingRoom.cardIds.indexOf(cardId) ?? -1;
      return waitingRoomIndex >= 0 ? waitingRoomIndex : sourceCardIds.indexOf(cardId);
    })
  );
  const actionBindings: ActionBinding[] = [];
  const actions: AiMainPhaseAction[] = [];
  for (const legalAction of query.actions) {
    const actionId = `action-${actions.length + 1}`;
    const sourceCandidateId = cardCandidates.find(
      (candidate) => candidate.value === legalAction.sourceCardId
    )?.candidateId;
    if (!sourceCandidateId) continue;
    actions.push(toMainPhaseAction(actionId, sourceCandidateId, legalAction));
    actionBindings.push({
      actionId,
      materialize: (boundPlayerId, timestamp) =>
        materializeMainPhaseAction(legalAction, boundPlayerId, timestamp),
    });
  }

  const endActionId = `action-${actions.length + 1}`;
  actions.push({ actionId: endActionId, kind: 'END_MAIN_PHASE' });
  actionBindings.push({
    actionId: endActionId,
    materialize: (boundPlayerId, timestamp) => ({
      type: GameCommandType.END_PHASE,
      playerId: boundPlayerId,
      timestamp,
    }),
  });

  return successHandle(
    {
      ...base,
      kind: 'MAIN_PHASE',
      mandatory: true,
      candidates: toCandidates(cardCandidates),
      actions,
    },
    { playerId, cardCandidates, options: [], actions: actionBindings }
  );
}

function buildLiveSetContract(
  game: GameState,
  playerId: string,
  base: Omit<AiDecisionContractBase, 'mandatory'>,
  view: ReturnType<typeof projectPlayerViewState>
): AiDecisionContractBuildResult {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { ok: false, reason: 'INVALID_STATE', detail: '玩家不存在' };
  }
  const canSet = hasEnabledCommand(view, GameCommandType.SET_LIVE_CARD);
  const canUnset = hasEnabledCommand(view, GameCommandType.UNSET_LIVE_CARD);
  const canConfirm = hasEnabledCommand(view, GameCommandType.CONFIRM_STEP);
  if (!canSet && !canUnset && !canConfirm) {
    return { ok: false, reason: 'NO_DECISION', detail: '当前 LIVE 设置不由该席位行动' };
  }

  const setCount = getLiveSetCardIdsForPlayer(game, playerId).length;
  const setLimit = getLiveSetCardLimitForPlayer(game, playerId);
  const handCardIds = canSet && setCount < setLimit ? player.hand.cardIds : [];
  const liveZoneCardIds = canUnset
    ? getLiveSetCardIdsForPlayer(game, playerId).filter(
        (cardId) => player.liveZone.cardStates.get(cardId)?.face === FaceState.FACE_DOWN
      )
    : [];
  const handBindings = createCandidateBindings(
    handCardIds,
    1,
    handCardIds.map((cardId) => player.hand.cardIds.indexOf(cardId))
  );
  const liveZoneBindings = createCandidateBindings(
    liveZoneCardIds,
    handBindings.length + 1,
    liveZoneCardIds.map((cardId) => player.liveZone.cardIds.indexOf(cardId))
  );
  const cardCandidates = [...handBindings, ...liveZoneBindings];
  const actions: AiLiveSetAction[] = [];
  const actionBindings: ActionBinding[] = [];

  const addAction = (
    action: Omit<AiLiveSetAction, 'actionId'>,
    materialize: ActionBinding['materialize']
  ) => {
    const actionId = `action-${actions.length + 1}`;
    actions.push({ ...action, actionId });
    actionBindings.push({ actionId, materialize });
  };

  for (const binding of handBindings) {
    const card = getCardById(game, binding.value);
    addAction(
      {
        kind: 'SET_LIVE',
        candidateId: binding.candidateId,
        isLiveCard: card !== null && isLiveCardData(card.data),
      },
      (boundPlayerId, timestamp) => ({
        type: GameCommandType.SET_LIVE_CARD,
        playerId: boundPlayerId,
        cardId: binding.value,
        faceDown: true,
        timestamp,
      })
    );
  }
  for (const binding of liveZoneBindings) {
    addAction(
      { kind: 'UNSET_LIVE', candidateId: binding.candidateId },
      (boundPlayerId, timestamp) => ({
        type: GameCommandType.UNSET_LIVE_CARD,
        playerId: boundPlayerId,
        cardId: binding.value,
        timestamp,
      })
    );
  }
  if (canConfirm) {
    addAction({ kind: 'CONFIRM_LIVE_SET' }, (boundPlayerId, timestamp) => ({
      type: GameCommandType.CONFIRM_STEP,
      playerId: boundPlayerId,
      subPhase: game.currentSubPhase,
      timestamp,
    }));
  }
  if (actions.length === 0) {
    return {
      ok: false,
      reason: 'INVALID_STATE',
      detail: 'LIVE 设置窗口没有可执行动作或确认入口',
    };
  }

  return successHandle(
    {
      ...base,
      kind: 'LIVE_SET',
      mandatory: true,
      handCandidates: toCandidates(handBindings),
      liveZoneCandidates: toCandidates(liveZoneBindings),
      actions,
      setCount,
      setLimit,
    },
    { playerId, cardCandidates, options: [], actions: actionBindings }
  );
}

function hasEnabledCommand(
  view: ReturnType<typeof projectPlayerViewState>,
  command: GameCommandType
): boolean {
  return view.permissions.availableCommands.some(
    (hint) => hint.command === command && hint.enabled
  );
}

function toMainPhaseAction(
  actionId: string,
  sourceCandidateId: string,
  legalAction: AiLegalMainPhaseAction
): AiMainPhaseAction {
  switch (legalAction.kind) {
    case 'PLAY_MEMBER':
      return {
        actionId,
        kind: legalAction.kind,
        sourceCandidateId,
        targetSlot: legalAction.targetSlot,
        relayMode: legalAction.relayMode,
        relayReplacementSlots: legalAction.relayReplacementSlots,
        paymentPreview: legalAction.paymentPreview,
      };
    case 'BEGIN_SPECIAL_MEMBER_PLAY':
      return {
        actionId,
        kind: legalAction.kind,
        sourceCandidateId,
        targetSlot: legalAction.targetSlot,
        label: legalAction.label,
      };
    case 'ACTIVATE_ABILITY':
      return {
        actionId,
        kind: legalAction.kind,
        sourceCandidateId,
        label: legalAction.label,
      };
  }
}

function materializeMainPhaseAction(
  action: AiLegalMainPhaseAction,
  playerId: string,
  timestamp: number
): GameCommand {
  switch (action.kind) {
    case 'PLAY_MEMBER':
      return {
        type: GameCommandType.PLAY_MEMBER_TO_SLOT,
        playerId,
        cardId: action.sourceCardId,
        targetSlot: action.targetSlot,
        relayMode: action.relayMode,
        relayReplacementSlots: action.relayReplacementSlots,
        timestamp,
      };
    case 'BEGIN_SPECIAL_MEMBER_PLAY':
      return {
        type: GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY,
        playerId,
        cardId: action.sourceCardId,
        targetSlot: action.targetSlot,
        mode: action.mode,
        timestamp,
      };
    case 'ACTIVATE_ABILITY':
      return {
        type: GameCommandType.ACTIVATE_ABILITY,
        playerId,
        cardId: action.sourceCardId,
        abilityId: action.abilityId,
        timestamp,
      };
  }
}

export function validateAiDecisionSelection(
  handle: AiDecisionContractHandle,
  selection: AiDecisionSelection
): AiDecisionSelectionValidationResult {
  const bindings = bindingsByHandle.get(handle);
  if (!bindings) {
    return { ok: false, error: '未知或已失效的 decision contract handle' };
  }
  const { contract } = handle;
  switch (contract.kind) {
    case 'MULLIGAN':
      return validateCandidateIds(
        selection,
        'MULLIGAN',
        contract.candidates,
        contract.minSelections,
        contract.maxSelections
      );
    case 'COST_PAYMENT':
      return validateCandidateIds(
        selection,
        'PAY_COST',
        contract.candidates,
        contract.requiredCount,
        contract.requiredCount
      );
    case 'JUDGMENT_CONFIRMATION':
      return selection.kind === 'CONFIRM_JUDGMENT'
        ? { ok: true }
        : invalidSelection('当前契约需要接受权威自动 Live 判定');
    case 'SCORE_CONFIRMATION':
      return selection.kind === 'CONFIRM_SCORE'
        ? { ok: true }
        : invalidSelection('当前契约需要确认权威分数');
    case 'SUCCESS_LIVE_SELECTION':
      return selection.kind === 'SELECT_SUCCESS_LIVE' &&
        contract.candidates.some((candidate) => candidate.candidateId === selection.candidateId)
        ? { ok: true }
        : invalidSelection('请选择当前契约中的成功 LIVE 候选');
    case 'PHASE_CONFIRMATION':
      return selection.kind === 'CONFIRM_PHASE'
        ? { ok: true }
        : invalidSelection('当前契约需要确认阶段');
    case 'MAIN_PHASE':
      return validateActionSelection(contract.actions, selection, 'SELECT_MAIN_PHASE_ACTION');
    case 'LIVE_SET':
      return validateActionSelection(contract.actions, selection, 'SELECT_LIVE_SET_ACTION');
    case 'SPECIAL_MEMBER_PLAY':
      return validateSpecialMemberPlayContractSelection(contract, bindings, selection);
    case 'ACTIVE_EFFECT':
      return validateEffectSelection(contract.input, selection);
  }
}

export function materializeAiDecisionCommand(
  handle: AiDecisionContractHandle,
  selection: AiDecisionSelection,
  timestamp: number = Date.now()
): AiDecisionCommandMaterializationResult {
  const validation = validateAiDecisionSelection(handle, selection);
  if (!validation.ok) {
    return validation;
  }
  const bindings = bindingsByHandle.get(handle);
  if (!bindings) {
    return { ok: false, error: '未知或已失效的 decision contract handle' };
  }
  const { contract } = handle;
  const base = { playerId: bindings.playerId, timestamp };
  switch (contract.kind) {
    case 'MULLIGAN':
      return {
        ok: true,
        command: {
          ...base,
          type: GameCommandType.MULLIGAN,
          cardIdsToMulligan: mapCandidateIds(bindings, selection, 'MULLIGAN'),
        },
      };
    case 'COST_PAYMENT':
      return {
        ok: true,
        command: {
          ...base,
          type: GameCommandType.CONFIRM_COST_PAYMENT,
          paymentId: bindings.paymentId ?? '',
          energyCardIds: mapCandidateIds(bindings, selection, 'PAY_COST'),
        },
      };
    case 'JUDGMENT_CONFIRMATION':
      return {
        ok: true,
        command: {
          ...base,
          type: GameCommandType.SUBMIT_JUDGMENT,
          judgmentResults: new Map(),
        },
      };
    case 'SCORE_CONFIRMATION':
      return {
        ok: true,
        command: {
          ...base,
          type: GameCommandType.SUBMIT_SCORE,
          adjustedScore: contract.authorityScore,
        },
      };
    case 'SUCCESS_LIVE_SELECTION': {
      const candidateId = selection.kind === 'SELECT_SUCCESS_LIVE' ? selection.candidateId : '';
      return {
        ok: true,
        command: {
          ...base,
          type: GameCommandType.SELECT_SUCCESS_LIVE,
          cardId: resolveCandidate(bindings, candidateId),
        },
      };
    }
    case 'PHASE_CONFIRMATION':
      return {
        ok: true,
        command: {
          ...base,
          type: GameCommandType.CONFIRM_STEP,
          subPhase: contract.subPhase,
        },
      };
    case 'MAIN_PHASE':
      return materializeBoundAction(bindings, selection, 'SELECT_MAIN_PHASE_ACTION', timestamp);
    case 'LIVE_SET':
      return materializeBoundAction(bindings, selection, 'SELECT_LIVE_SET_ACTION', timestamp);
    case 'SPECIAL_MEMBER_PLAY': {
      const pendingId = bindings.specialMemberPlay?.id ?? '';
      return selection.kind === 'CANCEL_SPECIAL_MEMBER_PLAY'
        ? {
            ok: true,
            command: {
              ...base,
              type: GameCommandType.CANCEL_SPECIAL_MEMBER_PLAY,
              pendingId,
            },
          }
        : {
            ok: true,
            command: {
              ...base,
              type: GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY,
              pendingId,
              selectedCardIds: mapCandidateIds(bindings, selection, 'CONFIRM_SPECIAL_MEMBER_PLAY'),
            },
          };
    }
    case 'ACTIVE_EFFECT':
      return {
        ok: true,
        command: materializeEffectCommand(contract, bindings, selection, timestamp),
      };
  }
}

export function getAiDecisionWitness(handle: AiDecisionContractHandle): AiDecisionSelection | null {
  const { contract } = handle;
  switch (contract.kind) {
    case 'MULLIGAN':
      return { kind: 'MULLIGAN', candidateIds: [] };
    case 'COST_PAYMENT':
      return {
        kind: 'PAY_COST',
        candidateIds: contract.candidates
          .slice(0, contract.requiredCount)
          .map((candidate) => candidate.candidateId),
      };
    case 'JUDGMENT_CONFIRMATION':
      return { kind: 'CONFIRM_JUDGMENT' };
    case 'SCORE_CONFIRMATION':
      return { kind: 'CONFIRM_SCORE' };
    case 'SUCCESS_LIVE_SELECTION':
      return contract.candidates[0]
        ? {
            kind: 'SELECT_SUCCESS_LIVE',
            candidateId: contract.candidates[0].candidateId,
          }
        : null;
    case 'PHASE_CONFIRMATION':
      return { kind: 'CONFIRM_PHASE' };
    case 'MAIN_PHASE': {
      const endAction = contract.actions.find((action) => action.kind === 'END_MAIN_PHASE');
      return endAction
        ? { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: endAction.actionId }
        : contract.actions[0]
          ? { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: contract.actions[0].actionId }
          : null;
    }
    case 'LIVE_SET': {
      const confirmAction = contract.actions.find((action) => action.kind === 'CONFIRM_LIVE_SET');
      return confirmAction
        ? { kind: 'SELECT_LIVE_SET_ACTION', actionId: confirmAction.actionId }
        : contract.actions[0]
          ? { kind: 'SELECT_LIVE_SET_ACTION', actionId: contract.actions[0].actionId }
          : null;
    }
    case 'SPECIAL_MEMBER_PLAY':
      return { kind: 'CANCEL_SPECIAL_MEMBER_PLAY' };
    case 'ACTIVE_EFFECT':
      return getEffectWitness(contract.input);
  }
}

export function sampleAiDecisionSelection(
  handle: AiDecisionContractHandle,
  random: () => number
): AiDecisionSelection | null {
  const { contract } = handle;
  if (contract.kind !== 'ACTIVE_EFFECT') {
    if (contract.kind === 'MULLIGAN') {
      const selected = shuffled(contract.candidates, random).filter(() => random() < 0.5);
      return { kind: 'MULLIGAN', candidateIds: selected.map((item) => item.candidateId) };
    }
    if (contract.kind === 'SUCCESS_LIVE_SELECTION' && contract.candidates.length > 0) {
      return {
        kind: 'SELECT_SUCCESS_LIVE',
        candidateId:
          contract.candidates[randomIndex(contract.candidates.length, random)]!.candidateId,
      };
    }
    if (contract.kind === 'MAIN_PHASE' && contract.actions.length > 0) {
      return {
        kind: 'SELECT_MAIN_PHASE_ACTION',
        actionId: contract.actions[randomIndex(contract.actions.length, random)]!.actionId,
      };
    }
    if (contract.kind === 'LIVE_SET' && contract.actions.length > 0) {
      return {
        kind: 'SELECT_LIVE_SET_ACTION',
        actionId: contract.actions[randomIndex(contract.actions.length, random)]!.actionId,
      };
    }
    if (contract.kind === 'SPECIAL_MEMBER_PLAY') {
      const bindings = bindingsByHandle.get(handle);
      return contract.canConfirm && random() >= 0.5
        ? {
            kind: 'CONFIRM_SPECIAL_MEMBER_PLAY',
            candidateIds: bindings?.specialMemberPlayWitnessCandidateIds ?? [],
          }
        : { kind: 'CANCEL_SPECIAL_MEMBER_PLAY' };
    }
    return getAiDecisionWitness(handle);
  }

  const input = contract.input;
  if (input.kind === 'CARD_SELECTION') {
    if (input.canSkip && random() < 0.5) {
      return { kind: 'SELECT_EFFECT_CARDS', candidateIds: [] };
    }
    const candidateIds = buildGroupedSelection(
      shuffled(input.candidates, random).map((candidate) => candidate.candidateId),
      input.minSelections,
      input.maxSelections,
      input.groups,
      random
    );
    return candidateIds ? { kind: 'SELECT_EFFECT_CARDS', candidateIds } : null;
  }
  if (input.kind === 'OPTION_SELECTION') {
    if (input.canSkip && random() < 0.5) {
      return { kind: 'SELECT_EFFECT_OPTIONS', optionIds: [] };
    }
    const count =
      input.minSelections + randomIndex(input.maxSelections - input.minSelections + 1, random);
    return {
      kind: 'SELECT_EFFECT_OPTIONS',
      optionIds: shuffled(input.options, random)
        .slice(0, count)
        .map((option) => option.optionId),
    };
  }
  if (input.kind === 'SLOT_SELECTION' && input.slots.length > 0) {
    return {
      kind: 'SELECT_EFFECT_SLOT',
      slot: input.slots[randomIndex(input.slots.length, random)]!,
    };
  }
  if (input.kind === 'NUMBER_INPUT') {
    const min = input.min ?? 0;
    const max = input.max ?? min;
    const raw = min + random() * Math.max(0, max - min);
    return {
      kind: 'SELECT_EFFECT_NUMBER',
      value: input.integerOnly ? Math.floor(raw) : raw,
    };
  }
  return getAiDecisionWitness(handle);
}

function buildActiveEffectContract(
  effect: ActiveEffectState,
  playerId: string,
  now: number,
  base: Omit<AiDecisionContractBase, 'mandatory'>
): AiDecisionContractBuildResult {
  const isPublicDeadline =
    effect.publicCardSelectionAutoAdvanceAt !== undefined ||
    effect.publicEffectChoiceAutoAdvanceAt !== undefined ||
    effect.publicRevealAutoAdvanceAt !== undefined;
  if (!isPublicDeadline && effect.awaitingPlayerId !== playerId) {
    return { ok: false, reason: 'NO_DECISION', detail: '当前效果不等待该席位' };
  }

  const cardCandidates = createEffectCandidateBindings(effect);
  const options = createEffectOptionBindings(effect);
  const inputResult = buildEffectInput(effect, cardCandidates, options, now);
  if (!inputResult.ok) {
    return inputResult;
  }
  const result = successHandle(
    {
      ...base,
      kind: 'ACTIVE_EFFECT',
      mandatory: !effect.canSkipSelection,
      effectRef: 'CURRENT',
      abilityId: effect.abilityId,
      stepId: effect.stepId,
      input: inputResult.input,
    },
    { playerId, cardCandidates, options, effect }
  );
  if (!result.ok) return result;
  const witness = getAiDecisionWitness(result.handle);
  if (!witness || !validateAiDecisionSelection(result.handle, witness).ok) {
    return {
      ok: false,
      reason: 'INVALID_STATE',
      detail: '效果窗口无法生成通过契约校验的合法 witness',
    };
  }
  return result;
}

function buildEffectInput(
  effect: ActiveEffectState,
  cardCandidates: readonly CandidateBinding[],
  options: readonly OptionBinding[],
  now: number
):
  | { readonly ok: true; readonly input: AiEffectDecisionInput }
  | {
      readonly ok: false;
      readonly reason: 'NO_DECISION' | 'UNSUPPORTED_WINDOW' | 'INVALID_STATE';
      readonly detail: string;
    } {
  if (effect.publicCardSelectionAutoAdvanceAt !== undefined) {
    return now < effect.publicCardSelectionAutoAdvanceAt
      ? {
          ok: false,
          reason: 'NO_DECISION',
          detail: '公开选卡展示 deadline 尚未到期',
        }
      : {
          ok: true,
          input: {
            kind: 'DEADLINE_CONFIRMATION',
            deadlineKind: 'PUBLIC_CARD_SELECTION',
            autoAdvanceAt: effect.publicCardSelectionAutoAdvanceAt,
          },
        };
  }
  if (effect.publicEffectChoiceAutoAdvanceAt !== undefined) {
    return now < effect.publicEffectChoiceAutoAdvanceAt
      ? {
          ok: false,
          reason: 'NO_DECISION',
          detail: '效果选项展示 deadline 尚未到期',
        }
      : {
          ok: true,
          input: {
            kind: 'DEADLINE_CONFIRMATION',
            deadlineKind: 'PUBLIC_EFFECT_CHOICE',
            autoAdvanceAt: effect.publicEffectChoiceAutoAdvanceAt,
          },
        };
  }
  if (effect.publicRevealAutoAdvanceAt !== undefined) {
    if (!effect.publicRevealGeneration) {
      return {
        ok: false,
        reason: 'INVALID_STATE',
        detail: '公开卡牌展示缺少 generation',
      };
    }
    return now < effect.publicRevealAutoAdvanceAt
      ? {
          ok: false,
          reason: 'NO_DECISION',
          detail: '公开卡牌展示 deadline 尚未到期',
        }
      : {
          ok: true,
          input: {
            kind: 'DEADLINE_CONFIRMATION',
            deadlineKind: 'PUBLIC_REVEAL',
            autoAdvanceAt: effect.publicRevealAutoAdvanceAt,
            generation: effect.publicRevealGeneration,
          },
        };
  }

  const surfaces = [
    effect.effectChoice ? 'effectChoice' : null,
    effect.stageFormation ? 'stageFormation' : null,
    effect.numericInput ? 'numericInput' : null,
    effect.selectableCardMode || (effect.selectableCardIds?.length ?? 0) > 0 ? 'cards' : null,
    !effect.effectChoice && (effect.selectableOptions?.length ?? 0) > 0 ? 'options' : null,
    (effect.selectableSlots?.length ?? 0) > 0 ? 'slots' : null,
  ].filter((surface): surface is string => surface !== null);

  if (effect.canResolveInOrder === true && Array.isArray(effect.metadata?.pendingAbilityIds)) {
    return {
      ok: true,
      input: {
        kind: 'ABILITY_ORDER',
        candidates: toCandidates(cardCandidates),
        options: toOptions(options),
        canResolveInOrder: effect.canResolveInOrder === true,
      },
    };
  }
  if (surfaces.length > 1) {
    return {
      ok: false,
      reason: 'UNSUPPORTED_WINDOW',
      detail: `active effect 同时暴露多个输入面: ${surfaces.join(', ')}`,
    };
  }
  if (effect.effectChoice) {
    return {
      ok: true,
      input: {
        kind: 'OPTION_SELECTION',
        options: toOptions(options),
        minSelections: effect.effectChoice.minSelections,
        maxSelections: effect.effectChoice.maxSelections,
        canSkip: effect.canSkipSelection === true,
      },
    };
  }
  if (effect.stageFormation) {
    return {
      ok: true,
      input: {
        kind: 'STAGE_FORMATION',
        members: effect.stageFormation.slots.flatMap((slot) => {
          if (!slot.cardId) return [];
          const binding = cardCandidates.find((candidate) => candidate.value === slot.cardId);
          return binding
            ? [{ candidateId: binding.candidateId, originalSlot: slot.originalSlot }]
            : [];
        }),
        slots: [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT],
        canSkip: effect.canSkipSelection === true,
      },
    };
  }
  if (effect.numericInput) {
    return {
      ok: true,
      input: {
        kind: 'NUMBER_INPUT',
        min: effect.numericInput.min,
        max: effect.numericInput.max,
        integerOnly: effect.numericInput.integerOnly === true,
      },
    };
  }
  if (effect.selectableCardMode || (effect.selectableCardIds?.length ?? 0) > 0) {
    const minSelections =
      effect.selectableCardMode === 'ORDERED_MULTI'
        ? (effect.minSelectableCards ?? 0)
        : effect.canSkipSelection
          ? 0
          : 1;
    const maxSelections =
      effect.selectableCardMode === 'ORDERED_MULTI'
        ? (effect.maxSelectableCards ?? cardCandidates.length)
        : 1;
    const groups = getPublicCardSelectionConfirmationConfig(effect)?.groups ?? [];
    return {
      ok: true,
      input: {
        kind: 'CARD_SELECTION',
        candidates: toCandidates(cardCandidates),
        ordered: effect.selectableCardMode === 'ORDERED_MULTI',
        minSelections,
        maxSelections,
        canSkip: effect.canSkipSelection === true,
        groups: groups.map((group, index) => ({
          groupId: `group-${index + 1}`,
          candidateIds: group.candidateCardIds.flatMap((cardId) => {
            const binding = cardCandidates.find((candidate) => candidate.value === cardId);
            return binding ? [binding.candidateId] : [];
          }),
          minCount: group.minCount,
          maxCount: group.maxCount,
        })),
      },
    };
  }
  if ((effect.selectableOptions?.length ?? 0) > 0) {
    return {
      ok: true,
      input: {
        kind: 'OPTION_SELECTION',
        options: toOptions(options),
        minSelections: effect.canSkipSelection ? 0 : 1,
        maxSelections: 1,
        canSkip: effect.canSkipSelection === true,
      },
    };
  }
  if ((effect.selectableSlots?.length ?? 0) > 0) {
    return {
      ok: true,
      input: {
        kind: 'SLOT_SELECTION',
        slots: effect.selectableSlots ?? [],
        canSkip: effect.canSkipSelection === true,
      },
    };
  }
  return { ok: true, input: { kind: 'CONFIRM' } };
}

function validateEffectSelection(
  input: AiEffectDecisionInput,
  selection: AiDecisionSelection
): AiDecisionSelectionValidationResult {
  switch (input.kind) {
    case 'CONFIRM':
      return selection.kind === 'CONFIRM_EFFECT'
        ? { ok: true }
        : invalidSelection('当前效果只需要确认');
    case 'DEADLINE_CONFIRMATION':
      return selection.kind === 'CONFIRM_DEADLINE'
        ? { ok: true }
        : invalidSelection('当前效果只接受 deadline 推进');
    case 'CARD_SELECTION': {
      if (selection.kind !== 'SELECT_EFFECT_CARDS') {
        return invalidSelection('当前效果需要选择卡牌');
      }
      const basic = validateIds(
        selection.candidateIds,
        input.candidates.map((candidate) => candidate.candidateId),
        input.canSkip ? 0 : input.minSelections,
        input.maxSelections
      );
      if (!basic.ok) return basic;
      const rawGroups = input.groups.map((group) => ({
        candidateCardIds: group.candidateIds,
        minCount: group.minCount,
        maxCount: group.maxCount,
      }));
      return matchesPublicCardSelectionGroups(selection.candidateIds, rawGroups)
        ? { ok: true }
        : invalidSelection('卡牌选择不满足分组约束');
    }
    case 'OPTION_SELECTION':
      if (selection.kind !== 'SELECT_EFFECT_OPTIONS') {
        return invalidSelection('当前效果需要选择选项');
      }
      return validateIds(
        selection.optionIds,
        input.options.map((option) => option.optionId),
        input.canSkip ? 0 : input.minSelections,
        input.maxSelections
      );
    case 'SLOT_SELECTION':
      if (input.canSkip && selection.kind === 'CONFIRM_EFFECT') {
        return { ok: true };
      }
      return selection.kind === 'SELECT_EFFECT_SLOT' && input.slots.includes(selection.slot)
        ? { ok: true }
        : invalidSelection('请选择当前效果允许的成员区，或跳过可选效果');
    case 'NUMBER_INPUT':
      if (selection.kind !== 'SELECT_EFFECT_NUMBER' || !Number.isFinite(selection.value)) {
        return invalidSelection('当前效果需要有效数字');
      }
      if (input.integerOnly && !Number.isInteger(selection.value)) {
        return invalidSelection('当前效果需要整数');
      }
      if (input.min !== undefined && selection.value < input.min) {
        return invalidSelection('输入数字低于允许范围');
      }
      return input.max !== undefined && selection.value > input.max
        ? invalidSelection('输入数字高于允许范围')
        : { ok: true };
    case 'STAGE_FORMATION':
      if (selection.kind !== 'SET_STAGE_FORMATION') {
        return input.canSkip && selection.kind === 'CONFIRM_EFFECT'
          ? { ok: true }
          : invalidSelection('当前效果需要提交站位');
      }
      return validateFormation(input, selection);
    case 'ABILITY_ORDER':
      if (selection.kind === 'RESOLVE_ABILITIES_IN_ORDER') {
        return input.canResolveInOrder
          ? { ok: true }
          : invalidSelection('当前能力队列不能顺序发动');
      }
      if (selection.kind === 'SELECT_EFFECT_CARDS') {
        return validateIds(
          selection.candidateIds,
          input.candidates.map((candidate) => candidate.candidateId),
          1,
          1
        );
      }
      if (selection.kind === 'SELECT_EFFECT_OPTIONS') {
        return validateIds(
          selection.optionIds,
          input.options.map((option) => option.optionId),
          1,
          1
        );
      }
      return invalidSelection('当前效果需要选择能力顺序');
  }
}

function materializeEffectCommand(
  contract: AiActiveEffectDecisionContract,
  bindings: HandleBindings,
  selection: AiDecisionSelection,
  timestamp: number
): ConfirmEffectStepCommand {
  const command: ConfirmEffectStepCommand = {
    type: GameCommandType.CONFIRM_EFFECT_STEP,
    playerId: bindings.playerId,
    effectId: bindings.effect?.id ?? '',
    timestamp,
  };
  const input = contract.input;
  if (selection.kind === 'CONFIRM_DEADLINE' && input.kind === 'DEADLINE_CONFIRMATION') {
    switch (input.deadlineKind) {
      case 'PUBLIC_CARD_SELECTION':
        return { ...command, publicCardSelectionAutoAdvanceAt: input.autoAdvanceAt };
      case 'PUBLIC_EFFECT_CHOICE':
        return { ...command, publicEffectChoiceAutoAdvanceAt: input.autoAdvanceAt };
      case 'PUBLIC_REVEAL':
        return {
          ...command,
          publicRevealAutoAdvanceAt: input.autoAdvanceAt,
          publicRevealGeneration: input.generation,
        };
    }
  }
  if (selection.kind === 'SELECT_EFFECT_CARDS') {
    if (selection.candidateIds.length === 0) {
      return input.kind === 'CARD_SELECTION' && input.ordered && !input.canSkip
        ? { ...command, selectedCardIds: [] }
        : { ...command, selectedCardId: null };
    }
    const values = selection.candidateIds.map((id) => resolveCandidate(bindings, id));
    return input.kind === 'CARD_SELECTION' && input.ordered
      ? { ...command, selectedCardIds: values }
      : { ...command, selectedCardId: values[0] };
  }
  if (selection.kind === 'SELECT_EFFECT_OPTIONS') {
    if (selection.optionIds.length === 0) {
      return { ...command, selectedCardId: null };
    }
    const values = selection.optionIds.map((id) => resolveOption(bindings, id));
    return input.kind === 'OPTION_SELECTION' && input.maxSelections > 1
      ? { ...command, selectedEffectOptionIds: values }
      : { ...command, selectedOptionId: values[0] };
  }
  if (selection.kind === 'SELECT_EFFECT_SLOT') {
    return { ...command, selectedSlot: selection.slot };
  }
  if (selection.kind === 'SELECT_EFFECT_NUMBER') {
    return { ...command, selectedNumber: selection.value };
  }
  if (selection.kind === 'SET_STAGE_FORMATION') {
    const placements = selection.placements.map((placement) => ({
      cardId: resolveCandidate(bindings, placement.candidateId),
      toSlot: placement.toSlot,
    }));
    return {
      ...command,
      stageFormationMoveHistory: placements,
      stageFormationPlacements: placements,
    };
  }
  if (selection.kind === 'RESOLVE_ABILITIES_IN_ORDER') {
    return { ...command, resolveInOrder: true };
  }
  return command;
}

function getEffectWitness(input: AiEffectDecisionInput): AiDecisionSelection | null {
  switch (input.kind) {
    case 'CONFIRM':
      return { kind: 'CONFIRM_EFFECT' };
    case 'DEADLINE_CONFIRMATION':
      return { kind: 'CONFIRM_DEADLINE' };
    case 'CARD_SELECTION': {
      if (input.canSkip) return { kind: 'SELECT_EFFECT_CARDS', candidateIds: [] };
      const candidateIds = buildGroupedSelection(
        input.candidates.map((candidate) => candidate.candidateId),
        input.minSelections,
        input.maxSelections,
        input.groups
      );
      return candidateIds ? { kind: 'SELECT_EFFECT_CARDS', candidateIds } : null;
    }
    case 'OPTION_SELECTION':
      if (input.canSkip) return { kind: 'SELECT_EFFECT_OPTIONS', optionIds: [] };
      return input.options.length >= input.minSelections
        ? {
            kind: 'SELECT_EFFECT_OPTIONS',
            optionIds: input.options.slice(0, input.minSelections).map((option) => option.optionId),
          }
        : null;
    case 'SLOT_SELECTION':
      return input.canSkip
        ? { kind: 'CONFIRM_EFFECT' }
        : input.slots[0]
          ? { kind: 'SELECT_EFFECT_SLOT', slot: input.slots[0] }
          : null;
    case 'NUMBER_INPUT': {
      const value = input.min ?? (input.max !== undefined && input.max < 0 ? input.max : 0);
      return {
        kind: 'SELECT_EFFECT_NUMBER',
        value: input.integerOnly ? Math.ceil(value) : value,
      };
    }
    case 'STAGE_FORMATION':
      if (input.canSkip) return { kind: 'CONFIRM_EFFECT' };
      return {
        kind: 'SET_STAGE_FORMATION',
        placements: input.members.map((member) => ({
          candidateId: member.candidateId,
          toSlot: member.originalSlot,
        })),
      };
    case 'ABILITY_ORDER':
      if (input.canResolveInOrder) return { kind: 'RESOLVE_ABILITIES_IN_ORDER' };
      if (input.options[0]) {
        return {
          kind: 'SELECT_EFFECT_OPTIONS',
          optionIds: [input.options[0].optionId],
        };
      }
      return input.candidates[0]
        ? {
            kind: 'SELECT_EFFECT_CARDS',
            candidateIds: [input.candidates[0].candidateId],
          }
        : null;
  }
}

function validateFormation(
  input: AiEffectStageFormationInput,
  selection: Extract<AiDecisionSelection, { kind: 'SET_STAGE_FORMATION' }>
): AiDecisionSelectionValidationResult {
  const expected = new Set(input.members.map((member) => member.candidateId));
  const selected = new Set(selection.placements.map((placement) => placement.candidateId));
  if (
    selected.size !== selection.placements.length ||
    selected.size !== expected.size ||
    [...selected].some((candidateId) => !expected.has(candidateId))
  ) {
    return invalidSelection('站位提交必须且只能包含当前舞台成员');
  }
  const slots = selection.placements.map((placement) => placement.toSlot);
  return new Set(slots).size === slots.length && slots.every((slot) => input.slots.includes(slot))
    ? { ok: true }
    : invalidSelection('站位提交包含重复或非法成员区');
}

function buildGroupedSelection(
  candidateIds: readonly string[],
  minSelections: number,
  maxSelections: number,
  groups: readonly AiDecisionSelectionGroup[],
  random?: () => number
): readonly string[] | null {
  const selected: string[] = [];
  const canAdd = (candidateId: string) =>
    groups.every((group) => {
      if (!group.candidateIds.includes(candidateId)) return true;
      const current = selected.filter((id) => group.candidateIds.includes(id)).length;
      return current < group.maxCount;
    });

  for (const group of groups) {
    while (
      selected.filter((candidateId) => group.candidateIds.includes(candidateId)).length <
      group.minCount
    ) {
      const candidate = group.candidateIds.find(
        (candidateId) =>
          candidateIds.includes(candidateId) &&
          !selected.includes(candidateId) &&
          canAdd(candidateId)
      );
      if (!candidate) return null;
      selected.push(candidate);
    }
  }

  const targetCount = random
    ? minSelections + randomIndex(maxSelections - minSelections + 1, random)
    : minSelections;
  for (const candidateId of candidateIds) {
    if (selected.length >= targetCount) break;
    if (!selected.includes(candidateId) && canAdd(candidateId)) selected.push(candidateId);
  }
  if (selected.length < minSelections || selected.length > maxSelections) return null;
  const rawGroups = groups.map((group) => ({
    candidateCardIds: group.candidateIds,
    minCount: group.minCount,
    maxCount: group.maxCount,
  }));
  return matchesPublicCardSelectionGroups(selected, rawGroups) ? selected : null;
}

function buildSemanticWindowSignature(
  game: GameState,
  playerId: string,
  view: ReturnType<typeof projectPlayerViewState>
): string {
  return JSON.stringify({
    windowType: view.match.window?.windowType ?? null,
    actingSeat: view.match.window?.actingSeat ?? null,
    waitingSeats: view.match.window?.waitingSeats ?? [],
    phase: game.currentPhase,
    subPhase: game.currentSubPhase,
    activeEffectAbilityId: game.activeEffect?.abilityId ?? null,
    activeEffectStepId: game.activeEffect?.stepId ?? null,
    hasPendingCostPayment: game.pendingCostPayment !== null,
    pendingSpecialMemberPlay: game.pendingSpecialMemberPlay
      ? {
          mode: game.pendingSpecialMemberPlay.mode,
          targetSlot: game.pendingSpecialMemberPlay.targetSlot,
        }
      : null,
    mulliganStatus: game.mulliganCompletedPlayers.includes(playerId) ? 'DONE' : 'OPEN',
  });
}

function createEffectCandidateBindings(effect: ActiveEffectState): readonly CandidateBinding[] {
  const values =
    effect.stageFormation?.slots.flatMap((slot) => (slot.cardId ? [slot.cardId] : [])) ??
    effect.selectableCardIds ??
    [];
  const version =
    typeof effect.metadata?.blindSelectionVersion === 'number'
      ? effect.metadata.blindSelectionVersion
      : undefined;
  return values.map((value, index) => ({
    candidateId: `candidate-${index + 1}`,
    value:
      effect.selectableCardVisibility === 'AWAITING_PLAYER_BLIND'
        ? createBlindCardSelectionToken(index, version)
        : value,
  }));
}

function createEffectOptionBindings(effect: ActiveEffectState): readonly OptionBinding[] {
  const values = effect.effectChoice
    ? effect.effectChoice.options
        .filter((option) => option.selectable !== false)
        .map((option) => ({ id: option.id, label: option.text }))
    : (effect.selectableOptions ?? []);
  return values.map((option, index) => ({
    optionId: `option-${index + 1}`,
    value: option.id,
    label: option.label,
  }));
}

function createCandidateBindings(
  values: readonly string[],
  startIndex = 1,
  projectedIndexes?: readonly number[]
): readonly CandidateBinding[] {
  return values.map((value, index) => ({
    candidateId: `candidate-${startIndex + index}`,
    value,
    projectedIndex: projectedIndexes?.[index],
  }));
}

function toCandidates(bindings: readonly CandidateBinding[]): readonly AiDecisionCandidate[] {
  return bindings.map((binding, projectedIndex) => ({
    candidateId: binding.candidateId,
    projectedIndex: binding.projectedIndex ?? projectedIndex,
  }));
}

function toOptions(bindings: readonly OptionBinding[]): readonly AiDecisionOption[] {
  return bindings.map((binding) => ({
    optionId: binding.optionId,
    label: binding.label,
  }));
}

function successHandle(
  contract: AiDecisionContract,
  bindings: HandleBindings
): AiDecisionContractBuildResult {
  const handle: AiDecisionContractHandle = { contract };
  bindingsByHandle.set(handle, bindings);
  return { ok: true, handle };
}

function validateCandidateIds(
  selection: AiDecisionSelection,
  expectedKind: 'MULLIGAN' | 'PAY_COST',
  candidates: readonly AiDecisionCandidate[],
  min: number,
  max: number
): AiDecisionSelectionValidationResult {
  if (selection.kind !== expectedKind) {
    return invalidSelection(`当前契约需要 ${expectedKind} 选择`);
  }
  return validateIds(
    selection.candidateIds,
    candidates.map((candidate) => candidate.candidateId),
    min,
    max
  );
}

function validateActionSelection(
  actions: readonly { readonly actionId: string }[],
  selection: AiDecisionSelection,
  expectedKind: 'SELECT_MAIN_PHASE_ACTION' | 'SELECT_LIVE_SET_ACTION'
): AiDecisionSelectionValidationResult {
  const selectedActionId = selection.kind === expectedKind ? selection.actionId : null;
  return selectedActionId && actions.some((action) => action.actionId === selectedActionId)
    ? { ok: true }
    : invalidSelection('请选择当前契约中的合法动作');
}

function validateSpecialMemberPlayContractSelection(
  contract: AiSpecialMemberPlayDecisionContract,
  bindings: HandleBindings,
  selection: AiDecisionSelection
): AiDecisionSelectionValidationResult {
  if (selection.kind === 'CANCEL_SPECIAL_MEMBER_PLAY') {
    return { ok: true };
  }
  if (selection.kind !== 'CONFIRM_SPECIAL_MEMBER_PLAY') {
    return invalidSelection('当前契约需要确认或取消特殊登场');
  }
  if (!contract.canConfirm) {
    return invalidSelection(contract.confirmationUnavailableReason ?? '当前无法确认特殊登场');
  }
  const candidateValidation = validateIds(
    selection.candidateIds,
    contract.candidates.map((candidate) => candidate.candidateId),
    contract.minSelections,
    contract.maxSelections
  );
  if (!candidateValidation.ok) return candidateValidation;

  const selectedCardIds = selection.candidateIds.map((candidateId) =>
    resolveCandidate(bindings, candidateId)
  );
  const selectionError = bindings.validateSpecialMemberPlaySelection?.(selectedCardIds) ?? null;
  return selectionError ? invalidSelection(selectionError) : { ok: true };
}

function materializeBoundAction(
  bindings: HandleBindings,
  selection: AiDecisionSelection,
  expectedKind: 'SELECT_MAIN_PHASE_ACTION' | 'SELECT_LIVE_SET_ACTION',
  timestamp: number
): AiDecisionCommandMaterializationResult {
  const actionId = selection.kind === expectedKind ? selection.actionId : null;
  const action = bindings.actions?.find((candidate) => candidate.actionId === actionId);
  return action
    ? { ok: true, command: action.materialize(bindings.playerId, timestamp) }
    : { ok: false, error: '动作 contract binding 已失效' };
}

function validateIds(
  selectedIds: readonly string[],
  allowedIds: readonly string[],
  min: number,
  max: number
): AiDecisionSelectionValidationResult {
  if (new Set(selectedIds).size !== selectedIds.length) {
    return invalidSelection('不能重复选择同一候选');
  }
  if (selectedIds.length < min || selectedIds.length > max) {
    return invalidSelection(`选择数量必须在 ${min} 到 ${max} 之间`);
  }
  return selectedIds.every((id) => allowedIds.includes(id))
    ? { ok: true }
    : invalidSelection('选择包含当前契约之外的候选');
}

function mapCandidateIds(
  bindings: HandleBindings,
  selection: AiDecisionSelection,
  kind: 'MULLIGAN' | 'PAY_COST' | 'CONFIRM_SPECIAL_MEMBER_PLAY'
): readonly string[] {
  return selection.kind === kind
    ? selection.candidateIds.map((candidateId) => resolveCandidate(bindings, candidateId))
    : [];
}

function resolveCandidate(bindings: HandleBindings, candidateId: string): string {
  const value = bindings.cardCandidates.find(
    (candidate) => candidate.candidateId === candidateId
  )?.value;
  if (!value) throw new Error(`Missing candidate binding: ${candidateId}`);
  return value;
}

function resolveOption(bindings: HandleBindings, optionId: string): string {
  const value = bindings.options.find((option) => option.optionId === optionId)?.value;
  if (!value) throw new Error(`Missing option binding: ${optionId}`);
  return value;
}

function invalidSelection(error: string): AiDecisionSelectionValidationResult {
  return { ok: false, error };
}

function shuffled<T>(values: readonly T[], random: () => number): readonly T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function randomIndex(length: number, random: () => number): number {
  if (length <= 1) return 0;
  const value = random();
  return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}
