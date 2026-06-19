import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../shared/types/enums.js';
import { isMemberCardData, type CardInstance } from '../domain/entities/card.js';
import type { ActiveEffectState, GameState, PendingAbilityState } from '../domain/entities/game.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  updatePlayer,
} from '../domain/entities/game.js';
import { addCardToZone } from '../domain/entities/zone.js';
import { addLiveModifier } from '../domain/rules/live-modifiers.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  selectWaitingRoomCardIds,
} from './effects/zone-selection.js';
import {
  and,
  cardNameAliasIs,
  costGte,
  costLte,
  groupAliasIs,
  hasBladeHeart as hasBladeHeartSelector,
  memberPrintedBladeLte,
  normalizeCardName,
  not,
  or,
  typeIs,
  unitAliasIs,
} from './effects/card-selectors.js';
import {
  countCardsMatchingSelector,
  countStageMembers,
  getCardIdsInZoneMatching,
  getCardIdsMatchingSelector,
  getCardIdsInZone,
  hasStageMemberMatching,
} from './effects/conditions.js';
import { payImmediateEffectCosts } from './effects/effect-costs.js';
import {
  clearInspectionCards,
  inspectTopCards,
  moveTopDeckCardsToWaitingRoom,
} from './effects/look-top.js';
import { moveMemberBetweenSlots } from './effects/member-state.js';
import {
  addBladeLiveModifierForSourceMember,
  discardHandCardsToWaitingRoomForPlayer,
  drawCardsForEachPlayer,
  drawCardsForPlayer,
  recoverCardsFromWaitingRoomToHandForPlayer,
  shuffleWaitingRoomCardsToDeckBottomForPlayer,
} from './card-effects/runtime/actions.js';
import {
  finishConfirmOnlyPendingAbilityEffect,
  startConfirmOnlyPendingAbilityEffect,
} from './card-effects/runtime/active-effect.js';
import { resolveActivatedAbilityWithRegistry } from './card-effects/runtime/activated-registry.js';
import { resolvePendingAbilityStarterWithRegistry } from './card-effects/runtime/starter-registry.js';
import { resolveActiveEffectStepWithRegistry } from './card-effects/runtime/step-registry.js';
import { registerBp5003KotoriWorkflowHandlers } from './card-effects/workflows/cards/bp5-003-kotori.js';
import { registerBp5005RinWorkflowHandlers } from './card-effects/workflows/cards/bp5-005-rin.js';
import {
  registerBp6024SuccessReplacementWorkflowHandlers,
} from './card-effects/workflows/cards/bp6-024-success-replacement.js';
import { registerHsBp1002SayakaWorkflowHandlers } from './card-effects/workflows/cards/hs-bp1-002-sayaka.js';
import { registerHsBp6004GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-004-ginko.js';
import { registerHsBp5003RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-003-rurino.js';
import { registerHsBp5001KahoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-001-kaho.js';
import { registerHsBp5008IzumiWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-008-izumi.js';
import { registerHsPb1004GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-004-ginko.js';
import { registerHsPb1009KahoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-009-kaho.js';
import { registerHsPr019GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-pr-019-ginko.js';
import { registerKekeOnEnterPlaceWaitingEnergyWorkflowHandlers } from './card-effects/workflows/cards/keke-on-enter-place-waiting-energy.js';
import { registerMakiOnEnterWorkflowHandlers } from './card-effects/workflows/cards/maki-on-enter.js';
import { registerNozomiOnEnterWorkflowHandlers } from './card-effects/workflows/cards/nozomi-on-enter.js';
import {
  isHsSd1001HighCostHasunosoraRelayReplacement,
  registerHsSd1001KahoWorkflowHandlers,
} from './card-effects/workflows/cards/hs-sd1-001-kaho.js';
import { registerHsSd1006HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-006-hime.js';
import { registerEmmaWorkflowHandlers } from './card-effects/workflows/cards/n-pb1-008-emma.js';
import { registerPlBp3014RinWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-014-rin.js';
import { registerPr017NicoWorkflowHandlers } from './card-effects/workflows/cards/pr-017-nico.js';
import { registerShikiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-008-shiki.js';
import { registerChisatoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-003-chisato.js';
import { registerYoshikoPlayLowCostMembersWorkflowHandlers } from './card-effects/workflows/cards/yoshiko-play-low-cost-members.js';
import { registerArrangeInspectedDeckTopWorkflowHandlers } from './card-effects/workflows/shared/arrange-inspected-deck-top.js';
import { registerConditionalLiveModifierWorkflowHandlers } from './card-effects/workflows/shared/conditional-live-modifier.js';
import { registerDiscardCostWaitingRoomToHandWorkflowHandlers } from './card-effects/workflows/shared/discard-cost-waiting-room-to-hand.js';
import { registerDiscardLookTopSelectToHandWorkflowHandlers } from './card-effects/workflows/shared/discard-look-top-select-to-hand.js';
import { registerDrawThenDiscardWorkflowHandlers } from './card-effects/workflows/shared/draw-then-discard.js';
import { registerGroupedRecoveryWorkflowHandlers } from './card-effects/workflows/shared/grouped-recovery.js';
import { registerLookTopSelectToHandWorkflowHandlers } from './card-effects/workflows/shared/look-top-select-to-hand.js';
import { registerLiveStartDiscardGainHeartWorkflowHandlers } from './card-effects/workflows/shared/live-start-discard-gain-heart.js';
import { registerNamedHandDiscardLiveStartWorkflowHandlers } from './card-effects/workflows/shared/named-hand-discard-live-start.js';
import { registerOpponentWaitTargetWorkflowHandlers } from './card-effects/workflows/shared/opponent-wait-target.js';
import { registerPayEnergyGainBladeWorkflowHandlers } from './card-effects/workflows/shared/pay-energy-gain-blade.js';
import { registerPayEnergyWaitingRoomToHandWorkflowHandlers } from './card-effects/workflows/shared/pay-energy-waiting-room-to-hand.js';
import { registerRevealedCheerSelectionWorkflowHandlers } from './card-effects/workflows/shared/revealed-cheer-selection.js';
import { registerSelfSacrificeWaitingRoomToHandWorkflowHandlers } from './card-effects/workflows/shared/self-sacrifice-waiting-room-to-hand.js';
import { registerWaitingRoomToHandWorkflowHandlers } from './card-effects/workflows/shared/waiting-room-to-hand.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from './effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from './effects/stage-targets.js';
import type {
  CheerEvent,
  EnterStageEvent,
  LeaveStageEvent,
  LiveStartEvent,
  LiveSuccessEvent,
  MemberStateChangedEvent,
  MemberSlotMovedEvent,
} from '../domain/events/game-events.js';
import {
  cardCodeMatchesBase,
  getBaseCardCode,
  normalizeCardCode,
} from '../shared/utils/card-code.js';
import {
  KARIN_LIVE_START_ABILITY_ID,
  HANAYO_ACTIVATED_ABILITY_ID,
  BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID,
  HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
  HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
  HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
  HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
} from './card-effects/ability-ids.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type ActivatedAbilityUiConfig,
  type CardAbilityDefinition,
} from './card-effects/ability-definition-types.js';
import { CARD_ABILITY_DEFINITIONS } from './card-effects/definitions/index.js';

export * from './card-effects/ability-ids.js';
export * from './card-effects/ability-definition-types.js';
export { CARD_ABILITY_DEFINITIONS } from './card-effects/definitions/index.js';

export const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';
const DECLINE_OPTION_LABEL = '不发动';
const ABILITY_USE_STEP = 'ABILITY_USE';
const ACTIVATED_ABILITY_USE_STEP = 'ACTIVATED_ABILITY_USE';
const BP5_007_SELECT_HAND_DISCARD_STEP_ID = 'BP5_007_SELECT_HAND_DISCARD_TO_THREE';
const HS_BP6_031_RECYCLE_OPTION_STEP_ID = 'HS_BP6_031_RECYCLE_MEMBERS_OPTION';
const HS_BP6_031_SELECT_HIME_TARGET_STEP_ID = 'HS_BP6_031_SELECT_HIME_BLADE_TARGET';
const HS_PB1_012_RECYCLE_CONFIRM_STEP_ID = 'HS_PB1_012_RECYCLE_MEMBERS_CONFIRM';
const HS_PB1_012_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'HS_PB1_012_SELECT_WAITING_ROOM_LIVE';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

interface RevealSelectedInspectionCardConfig {
  readonly stepId: string;
  readonly stepText: string;
  readonly actionStep: string;
}

type InspectedCardDestination = 'MAIN_DECK_TOP' | 'WAITING_ROOM';
interface ArrangeInspectedDeckTopConfig {
  readonly ability: PendingAbilityState;
  readonly playerId: string;
  readonly effectText: string;
  readonly inspectCount: number;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly selectMin: number;
  readonly selectMax: number;
  readonly selectedDestination: InspectedCardDestination;
  readonly unselectedDestination: InspectedCardDestination;
  readonly orderedResolution: boolean;
}

interface AbilitySourceEntry {
  readonly cardId: string;
  readonly sourceZone: CardAbilitySourceZone;
  readonly sourceSlot?: SlotPosition;
}

interface OnEnterAbilitySource {
  readonly cardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition | null;
  readonly eventId: string;
  readonly replacedMemberCardId?: string;
  readonly replacedMemberEffectiveCost?: number;
}

interface OnEnterStageAutoSource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly enteredCardId: string;
  readonly eventId: string;
}

interface OnLeaveStageAbilitySource {
  readonly cardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly eventId: string;
  readonly toZone?: ZoneType;
  readonly replacingCardId?: string;
}

interface MemberSlotMovedAbilitySource {
  readonly cardId: string;
  readonly controllerId: string;
  readonly fromSlot: SlotPosition;
  readonly toSlot: SlotPosition;
  readonly eventId: string;
  readonly swappedCardInstanceId?: string;
}

interface MemberStateChangedAbilitySource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly event: MemberStateChangedEvent;
}

interface EnqueueTriggeredCardEffectsOptions {
  readonly onEnterSources?: readonly OnEnterAbilitySource[];
  readonly enterStageEvents?: readonly EnterStageEvent[];
  readonly onLeaveStageSources?: readonly OnLeaveStageAbilitySource[];
  readonly leaveStageEvents?: readonly LeaveStageEvent[];
  readonly liveStartEvents?: readonly LiveStartEvent[];
  readonly liveSuccessEvents?: readonly LiveSuccessEvent[];
  readonly cheerEvents?: readonly CheerEvent[];
  readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  readonly memberSlotMovedEvents?: readonly MemberSlotMovedEvent[];
}

interface StartPendingAbilityEffectOptions {
  readonly orderedResolution?: boolean;
  readonly manualConfirmation?: boolean;
  readonly skipManualConfirmation?: boolean;
}

function getCardAbilityEffectText(abilityId: string): string {
  const effectText = getCardAbilityDefinitionById(abilityId).effectText;
  if (effectText.trim().length === 0) {
    throw new Error(`Missing card ability effect text for abilityId: ${abilityId}`);
  }
  return effectText;
}

function getCardAbilityDefinitionById(abilityId: string): CardAbilityDefinition {
  const definition = CARD_ABILITY_DEFINITIONS.find((ability) => ability.abilityId === abilityId);
  if (!definition) {
    throw new Error(`Missing card ability definition for abilityId: ${abilityId}`);
  }
  return definition;
}

function getCardAbilityBaseCardCodes(abilityId: string): readonly string[] {
  return getCardAbilityDefinitionById(abilityId).baseCardCodes ?? [];
}

const IMPLEMENTED_QUEUED_ABILITY_IDS = new Set(
  CARD_ABILITY_DEFINITIONS.filter((ability) => ability.implemented && ability.queued).map(
    (ability) => ability.abilityId
  )
);

export function getCardAbilityDefinitions(
  cardCode: string | undefined
): readonly CardAbilityDefinition[] {
  if (!cardCode) {
    return [];
  }
  return CARD_ABILITY_DEFINITIONS.filter((definition) =>
    doesAbilityDefinitionMatchCardCode(definition, cardCode)
  );
}

export function doesAbilityDefinitionMatchCardCode(
  definition: CardAbilityDefinition,
  cardCode: string
): boolean {
  const normalizedCardCode = normalizeCardCode(cardCode);
  const baseCardCode = getBaseCardCode(normalizedCardCode);
  return (
    definition.cardCodes?.map(normalizeCardCode).includes(normalizedCardCode) === true ||
    definition.baseCardCodes?.map(normalizeCardCode).includes(baseCardCode) === true
  );
}

export function getActivatedAbilityUiConfig(
  cardCode: string | undefined
): ActivatedAbilityUiConfig | null {
  const definition = getCardAbilityDefinitions(cardCode).find(
    (ability) =>
      ability.category === CardAbilityCategory.ACTIVATED &&
      ability.implemented &&
      ability.activatedUi
  );
  return definition?.activatedUi ?? null;
}

export function isSupportedActivatedAbilityForCard(
  abilityId: string,
  cardCode: string | undefined
): boolean {
  return getCardAbilityDefinitions(cardCode).some(
    (ability) =>
      ability.category === CardAbilityCategory.ACTIVATED &&
      ability.implemented &&
      ability.abilityId === abilityId
  );
}

function getActivatedAbilityDefinition(abilityId: string): CardAbilityDefinition | null {
  return (
    CARD_ABILITY_DEFINITIONS.find(
      (ability) =>
        ability.abilityId === abilityId &&
        ability.category === CardAbilityCategory.ACTIVATED &&
        ability.implemented
    ) ?? null
  );
}

export interface AbilityTurnLimitStatus {
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
}

export type ActivatedAbilityLimitStatus = AbilityTurnLimitStatus;

export function getAbilityTurnLimitStatus(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): AbilityTurnLimitStatus | null {
  const definition = CARD_ABILITY_DEFINITIONS.find(
    (ability) => ability.abilityId === abilityId && ability.implemented
  );
  const limit = definition?.perTurnLimit;
  if (limit === undefined) {
    return null;
  }

  const resolvedUses = game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.playerId === playerId &&
      action.payload.abilityId === abilityId &&
      action.payload.sourceCardId === sourceCardId &&
      (action.payload.step === ABILITY_USE_STEP ||
        action.payload.step === ACTIVATED_ABILITY_USE_STEP) &&
      action.payload.turnCount === game.turnCount
  ).length;
  const pendingUses = game.pendingAbilities.filter(
    (ability) =>
      ability.controllerId === playerId &&
      ability.abilityId === abilityId &&
      ability.sourceCardId === sourceCardId
  ).length;
  const activeUse =
    game.activeEffect?.controllerId === playerId &&
    game.activeEffect.abilityId === abilityId &&
    game.activeEffect.sourceCardId === sourceCardId
      ? 1
      : 0;
  const used = resolvedUses + pendingUses + activeUse;

  return {
    abilityId,
    sourceCardId,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

export function getActivatedAbilityLimitStatus(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): ActivatedAbilityLimitStatus | null {
  const definition = getActivatedAbilityDefinition(abilityId);
  if (!definition) {
    return null;
  }
  return getAbilityTurnLimitStatus(game, playerId, abilityId, sourceCardId);
}

function canUseAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  const status = getAbilityTurnLimitStatus(game, playerId, abilityId, sourceCardId);
  return status === null || status.used < status.limit;
}

export function canUseActivatedAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  const status = getActivatedAbilityLimitStatus(game, playerId, abilityId, sourceCardId);
  return status === null || status.used < status.limit;
}

function getQueuedAbilityDefinitionsForCard(
  cardCode: string | undefined,
  category: CardAbilityCategory,
  sourceZone: CardAbilitySourceZone,
  sourceSlot?: SlotPosition | null
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitions(cardCode).filter(
    (ability) =>
      ability.category === category &&
      ability.sourceZone === sourceZone &&
      ability.queued &&
      ability.implemented &&
      doesSourceSlotSatisfyAbility(ability, sourceSlot)
  );
}

function doesSourceSlotSatisfyAbility(
  ability: CardAbilityDefinition,
  sourceSlot?: SlotPosition | null
): boolean {
  if (!ability.requiredSourceSlots || ability.requiredSourceSlots.length === 0) {
    return true;
  }

  return (
    sourceSlot !== undefined &&
    sourceSlot !== null &&
    ability.requiredSourceSlots.includes(sourceSlot)
  );
}

function toSlotPosition(value: unknown): SlotPosition | null {
  return Object.values(SlotPosition).includes(value as SlotPosition)
    ? (value as SlotPosition)
    : null;
}

function recordAbilityUse(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', playerId, {
    abilityId,
    sourceCardId,
    step: ABILITY_USE_STEP,
    turnCount: game.turnCount,
  });
}

function revealSelectedInspectionCard(
  game: GameState,
  selectedCardId: string,
  config: RevealSelectedInspectionCardConfig
): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.inspectionCardIds?.includes(selectedCardId)) {
    return game;
  }
  if (!effect.selectableCardIds?.includes(selectedCardId)) {
    return game;
  }

  const revealedCardIds = game.inspectionZone.revealedCardIds.includes(selectedCardId)
    ? game.inspectionZone.revealedCardIds
    : [...game.inspectionZone.revealedCardIds, selectedCardId];

  return addAction(
    {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        revealedCardIds,
      },
      activeEffect: {
        ...effect,
        stepId: config.stepId,
        stepText: config.stepText,
        selectableCardIds: [],
        selectionLabel: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.actionStep,
      selectedCardId,
    }
  );
}
const KARIN_REVEAL_STEP_ID = 'KARIN_REVEAL_TOP_CARD';
const KARIN_POSITION_CHANGE_STEP_ID = 'KARIN_POSITION_CHANGE';
const ABILITY_ORDER_SELECTION_STEP_ID = 'SELECT_NEXT_PENDING_ABILITY';

registerLookTopSelectToHandWorkflowHandlers();
registerArrangeInspectedDeckTopWorkflowHandlers();
registerConditionalLiveModifierWorkflowHandlers();
registerDiscardLookTopSelectToHandWorkflowHandlers();
registerBp5003KotoriWorkflowHandlers();
registerBp6024SuccessReplacementWorkflowHandlers();
registerHsBp5008IzumiWorkflowHandlers();
registerDrawThenDiscardWorkflowHandlers();
registerGroupedRecoveryWorkflowHandlers();
registerNamedHandDiscardLiveStartWorkflowHandlers();
registerLiveStartDiscardGainHeartWorkflowHandlers();
registerHsPb1009KahoWorkflowHandlers();
registerHsBp6004GinkoWorkflowHandlers();
registerHsSd1001KahoWorkflowHandlers();
registerHsSd1006HimeWorkflowHandlers();
registerWaitingRoomToHandWorkflowHandlers();
registerSelfSacrificeWaitingRoomToHandWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPayEnergyGainBladeWorkflowHandlers();
registerOpponentWaitTargetWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPayEnergyWaitingRoomToHandWorkflowHandlers();
registerDiscardCostWaitingRoomToHandWorkflowHandlers();
registerPr017NicoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp5005RinWorkflowHandlers();
registerRevealedCheerSelectionWorkflowHandlers({ continuePendingCardEffects });
registerHsBp1002SayakaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5001KahoWorkflowHandlers();
registerHsPr019GinkoWorkflowHandlers();
registerKekeOnEnterPlaceWaitingEnergyWorkflowHandlers();
registerNozomiOnEnterWorkflowHandlers();
registerHsBp5003RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1004GinkoWorkflowHandlers();
registerMakiOnEnterWorkflowHandlers();
registerEmmaWorkflowHandlers();
registerPlBp3014RinWorkflowHandlers();
registerShikiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerChisatoWorkflowHandlers();
registerYoshikoPlayLowCostMembersWorkflowHandlers({ enqueueTriggeredCardEffects });

interface CardEffectRunnerResult {
  readonly gameState: GameState;
  readonly resolvedAbilityIds: readonly string[];
}

export function enqueueTriggeredCardEffects(
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options: EnqueueTriggeredCardEffectsOptions = {}
): GameState {
  let state = game;

  if (triggerConditions.includes(TriggerCondition.ON_ENTER_STAGE)) {
    const enterStageEvents =
      options.enterStageEvents ?? getLatestEnterStageEventsFromLog(state);
    const eventSources =
      enterStageEvents.length > 0
        ? createOnEnterAbilitySourcesFromEvents(enterStageEvents)
        : undefined;
    const onEnterSources =
      options.onEnterSources ?? eventSources;
    state = enqueueOnEnterCardEffects(state, onEnterSources);
    state = enqueueOnEnterStageAutoCardEffects(
      state,
      createOnEnterStageAutoSources(
        state,
        enterStageEvents.length > 0 ? enterStageEvents : undefined,
        onEnterSources
      )
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_LEAVE_STAGE)) {
    const onLeaveSources =
      options.onLeaveStageSources ??
      createOnLeaveStageAbilitySourcesFromEvents(
        options.leaveStageEvents ?? getLeaveStageEventsFromLog(state)
      );
    state = enqueueOnLeaveStageCardEffects(
      state,
      onLeaveSources
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_LIVE_START)) {
    state = enqueueLiveStartCardEffects(
      state,
      options.liveStartEvents ?? getLatestLiveStartEventsFromLog(state)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_LIVE_SUCCESS)) {
    state = enqueueLiveSuccessCardEffects(
      state,
      options.liveSuccessEvents ?? getLatestLiveSuccessEventsFromLog(state)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_MEMBER_STATE_CHANGED)) {
    state = enqueueMemberStateChangedCardEffects(
      state,
      options.memberStateChangedEvents ?? getLatestMemberStateChangedEventsFromLog(state)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_CHEER)) {
    state = enqueueCheerCardEffects(
      state,
      options.cheerEvents ?? getLatestCheerEventsFromLog(state)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_MEMBER_SLOT_MOVED)) {
    state = enqueueMemberSlotMovedCardEffects(
      state,
      options.memberSlotMovedEvents ?? getMemberSlotMovedEventsFromLog(state)
    );
  }

  return state;
}

function getMemberSlotMovedEventsFromLog(game: GameState): readonly MemberSlotMovedEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberSlotMovedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
    );
}

function getNewMemberSlotMovedEvents(
  before: GameState,
  after: GameState
): readonly MemberSlotMovedEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberSlotMovedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
    );
}

function getMemberStateChangedEventsFromLog(game: GameState): readonly MemberStateChangedEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberStateChangedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
    );
}

function getLatestMemberStateChangedEventsFromLog(game: GameState): readonly MemberStateChangedEvent[] {
  const events = getMemberStateChangedEventsFromLog(game);
  const latestEvent = events.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getEnterStageEventsFromLog(game: GameState): readonly EnterStageEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is EnterStageEvent =>
        event.eventType === TriggerCondition.ON_ENTER_STAGE
    );
}

function getLatestEnterStageEventsFromLog(game: GameState): readonly EnterStageEvent[] {
  const enterStageEvents = getEnterStageEventsFromLog(game);
  const latestEvent = enterStageEvents.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getLeaveStageEventsFromLog(game: GameState): readonly LeaveStageEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is LeaveStageEvent =>
        event.eventType === TriggerCondition.ON_LEAVE_STAGE
    );
}

function getLiveStartEventsFromLog(game: GameState): readonly LiveStartEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is LiveStartEvent =>
        event.eventType === TriggerCondition.ON_LIVE_START
    );
}

function getLatestLiveStartEventsFromLog(game: GameState): readonly LiveStartEvent[] {
  const liveStartEvents = getLiveStartEventsFromLog(game);
  const latestEvent = liveStartEvents.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getLiveSuccessEventsFromLog(game: GameState): readonly LiveSuccessEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is LiveSuccessEvent =>
        event.eventType === TriggerCondition.ON_LIVE_SUCCESS
    );
}

function getLatestLiveSuccessEventsFromLog(game: GameState): readonly LiveSuccessEvent[] {
  const liveSuccessEvents = getLiveSuccessEventsFromLog(game);
  const latestEvent = liveSuccessEvents.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getCheerEventsFromLog(game: GameState): readonly CheerEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter((event): event is CheerEvent => event.eventType === TriggerCondition.ON_CHEER);
}

function getLatestCheerEventsFromLog(game: GameState): readonly CheerEvent[] {
  const cheerEvents = getCheerEventsFromLog(game);
  const latestEvent = cheerEvents.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getNewLeaveStageEvents(before: GameState, after: GameState): readonly LeaveStageEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is LeaveStageEvent =>
        event.eventType === TriggerCondition.ON_LEAVE_STAGE
    );
}

function createMemberSlotMovedAbilitySourcesFromEvents(
  events: readonly MemberSlotMovedEvent[]
): readonly MemberSlotMovedAbilitySource[] {
  return events.map((event) => ({
    cardId: event.cardInstanceId,
    controllerId: event.controllerId,
    fromSlot: event.fromSlot,
    toSlot: event.toSlot,
    eventId: event.eventId,
    swappedCardInstanceId: event.swappedCardInstanceId,
  }));
}

function enqueueMemberStateChangedCardEffects(
  game: GameState,
  events: readonly MemberStateChangedEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    for (const source of createMemberStateChangedAbilitySources(state, event)) {
      state = enqueueSingleMemberStateChangedCardEffect(state, source);
    }
  }
  return state;
}

function createMemberStateChangedAbilitySources(
  game: GameState,
  event: MemberStateChangedEvent
): readonly MemberStateChangedAbilitySource[] {
  const sources: MemberStateChangedAbilitySource[] = [];
  const changedController = getPlayerById(game, event.controllerId);
  if (
    changedController &&
    changedController.memberSlots.slots[event.slot] === event.cardInstanceId
  ) {
    sources.push({
      sourceCardId: event.cardInstanceId,
      controllerId: event.controllerId,
      sourceSlot: event.slot,
      event,
    });
  }

  if (
    event.cause?.kind === 'CARD_EFFECT' &&
    event.cause.playerId !== event.controllerId &&
    event.previousOrientation === OrientationState.ACTIVE &&
    event.nextOrientation === OrientationState.WAITING
  ) {
    const effectController = getPlayerById(game, event.cause.playerId);
    if (effectController) {
      for (const sourceSlot of MEMBER_SLOT_ORDER) {
        const sourceCardId = effectController.memberSlots.slots[sourceSlot];
        if (!sourceCardId) {
          continue;
        }
        sources.push({
          sourceCardId,
          controllerId: effectController.id,
          sourceSlot,
          event,
        });
      }
    }
  }

  return sources;
}

function enqueueSingleMemberStateChangedCardEffect(
  game: GameState,
  source: MemberStateChangedAbilitySource
): GameState {
  const sourceCard = getCardById(game, source.sourceCardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter(
    (ability) =>
      ability.triggerCondition === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
      doesMemberStateChangedEventSatisfyAbility(game, source, ability)
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (!canUseAbilityThisTurn(state, source.controllerId, abilityId, source.sourceCardId)) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.sourceCardId}:${source.event.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.sourceCardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_MEMBER_STATE_CHANGED,
      eventIds: [source.event.eventId],
      sourceSlot: source.sourceSlot,
      metadata: {
        changedCardId: source.event.cardInstanceId,
        changedControllerId: source.event.controllerId,
        changedSlot: source.event.slot,
        previousOrientation: source.event.previousOrientation,
        nextOrientation: source.event.nextOrientation,
        causedByKind: source.event.cause?.kind ?? null,
        causedByPlayerId:
          source.event.cause?.kind === 'CARD_EFFECT' ? source.event.cause.playerId : null,
        causedBySourceCardId:
          source.event.cause?.kind === 'CARD_EFFECT' ? source.event.cause.sourceCardId : null,
        causedByAbilityId:
          source.event.cause?.kind === 'CARD_EFFECT' ? source.event.cause.abilityId ?? null : null,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.sourceCardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        changedCardId: source.event.cardInstanceId,
        changedControllerId: source.event.controllerId,
        previousOrientation: source.event.previousOrientation,
        nextOrientation: source.event.nextOrientation,
      }
    );
  }

  return state;
}

function doesMemberStateChangedEventSatisfyAbility(
  game: GameState,
  source: MemberStateChangedAbilitySource,
  ability: CardAbilityDefinition
): boolean {
  const event = source.event;

  if (ability.abilityId === N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID) {
    const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
    return (
      event.cardInstanceId === source.sourceCardId &&
      event.controllerId === source.controllerId &&
      event.previousOrientation === OrientationState.ACTIVE &&
      event.nextOrientation === OrientationState.WAITING &&
      game.currentPhase === GamePhase.MAIN_PHASE &&
      activePlayerId === source.controllerId
    );
  }

  if (ability.abilityId === PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID) {
    const changedCard = getCardById(game, event.cardInstanceId);
    return (
      event.cause?.kind === 'CARD_EFFECT' &&
      event.cause.playerId === source.controllerId &&
      event.controllerId !== source.controllerId &&
      event.previousOrientation === OrientationState.ACTIVE &&
      event.nextOrientation === OrientationState.WAITING &&
      changedCard !== null &&
      isMemberCardData(changedCard.data) &&
      costLte(4)(changedCard)
    );
  }

  return false;
}

function enqueueMemberSlotMovedCardEffects(
  game: GameState,
  events: readonly MemberSlotMovedEvent[]
): GameState {
  let state = game;
  for (const source of createMemberSlotMovedAbilitySourcesFromEvents(events)) {
    state = enqueueSingleMemberSlotMovedCardEffect(state, source);
  }
  return state;
}

function enqueueSingleMemberSlotMovedCardEffect(
  game: GameState,
  source: MemberSlotMovedAbilitySource
): GameState {
  const player = getPlayerById(game, source.controllerId);
  const sourceCard = getCardById(game, source.cardId);
  if (!player || !sourceCard || player.memberSlots.slots[source.toSlot] !== source.cardId) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.toSlot
  ).filter((ability) => ability.triggerCondition === TriggerCondition.ON_MEMBER_SLOT_MOVED);
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (!canUseAbilityThisTurn(state, source.controllerId, abilityId, source.cardId)) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.cardId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.cardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      eventIds: [source.eventId],
      sourceSlot: source.toSlot,
      metadata: {
        fromSlot: source.fromSlot,
        toSlot: source.toSlot,
        swappedCardInstanceId: source.swappedCardInstanceId ?? null,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.cardId,
        timingId: pendingAbility.timingId,
        fromSlot: source.fromSlot,
        toSlot: source.toSlot,
        swappedCardInstanceId: source.swappedCardInstanceId ?? null,
      }
    );
  }

  return state;
}

function enqueueOnLeaveStageCardEffects(
  game: GameState,
  explicitSources: readonly OnLeaveStageAbilitySource[] | undefined = undefined
): GameState {
  const sources = explicitSources ?? getLatestLeaveStageAbilitySources(game);
  if (sources.length === 0) {
    return game;
  }

  let state = game;
  for (const source of sources) {
    state = enqueueSingleOnLeaveStageCardEffect(state, source);
  }

  return state;
}

function getLatestLeaveStageAbilitySources(game: GameState): readonly OnLeaveStageAbilitySource[] {
  const action = [...game.actionHistory]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === 'PLAY_MEMBER' ||
        (candidate.type === 'MOVE_CARD' &&
          candidate.payload.fromZone === ZoneType.MEMBER_SLOT &&
          candidate.payload.toZone === ZoneType.WAITING_ROOM)
    );
  if (!action) {
    return [];
  }

  if (action.type === 'PLAY_MEMBER') {
    const replacedCardId =
      typeof action.payload.replacedCardId === 'string' ? action.payload.replacedCardId : null;
    const replacingCardId =
      action.payload.isRelay === true && typeof action.payload.cardId === 'string'
        ? action.payload.cardId
        : undefined;
    const sourceSlot = toSlotPosition(action.payload.targetSlot);
    if (!replacedCardId || sourceSlot === null) {
      return [];
    }
    return [
      {
        cardId: replacedCardId,
        controllerId: action.playerId ?? getCardById(game, replacedCardId)?.ownerId ?? '',
        sourceSlot,
        eventId: `action:${action.sequence}`,
        toZone: ZoneType.WAITING_ROOM,
        replacingCardId,
      },
    ].filter((source) => source.controllerId.length > 0);
  }

  const cardId = typeof action.payload.cardId === 'string' ? action.payload.cardId : null;
  const sourceSlot = toSlotPosition(action.payload.sourceSlot);
  if (!cardId || sourceSlot === null) {
    return [];
  }

  return [
    {
      cardId,
      controllerId: action.playerId ?? getCardById(game, cardId)?.ownerId ?? '',
      sourceSlot,
      eventId: `action:${action.sequence}`,
      toZone: ZoneType.WAITING_ROOM,
    },
  ].filter((source) => source.controllerId.length > 0);
}

function createOnLeaveStageAbilitySourcesFromEvents(
  events: readonly LeaveStageEvent[] | undefined
): readonly OnLeaveStageAbilitySource[] | undefined {
  if (!events || events.length === 0) {
    return undefined;
  }

  return events.map((event) => ({
    cardId: event.cardInstanceId,
    controllerId: event.controllerId,
    sourceSlot: event.fromSlot,
    eventId: event.eventId,
    toZone: event.toZone,
    replacingCardId: event.replacingCardId,
  }));
}

function isHighCostHasunosoraRelayReplacement(
  game: GameState,
  source: OnLeaveStageAbilitySource
): boolean {
  return isHsSd1001HighCostHasunosoraRelayReplacement(game, source.replacingCardId);
}

function enqueueSingleOnLeaveStageCardEffect(
  game: GameState,
  source: OnLeaveStageAbilitySource
): GameState {
  const sourceCard = getCardById(game, source.cardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter((ability) => ability.triggerCondition === TriggerCondition.ON_LEAVE_STAGE);
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (
      abilityId === HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID &&
      !isHighCostHasunosoraRelayReplacement(state, source)
    ) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.cardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_LEAVE_STAGE,
      eventIds: [source.eventId],
      sourceSlot: source.sourceSlot,
      metadata: {
        replacingCardId: source.replacingCardId ?? null,
        toZone: source.toZone ?? null,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.cardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        toZone: source.toZone ?? null,
        replacingCardId: source.replacingCardId ?? null,
      }
    );
  }

  return state;
}

function enqueueOnEnterCardEffects(
  game: GameState,
  explicitSources: readonly OnEnterAbilitySource[] | undefined = undefined
): GameState {
  const sources = explicitSources ?? getLatestPlayMemberOnEnterSources(game);
  if (sources.length === 0) {
    return game;
  }

  let state = game;
  for (const source of sources) {
    state = enqueueSingleOnEnterCardEffect(state, source);
  }

  return state;
}

function getLatestPlayMemberOnEnterSources(game: GameState): readonly OnEnterAbilitySource[] {
  const action = [...game.actionHistory]
    .reverse()
    .find((candidate) => candidate.type === 'PLAY_MEMBER');
  const sourceCardId = typeof action?.payload.cardId === 'string' ? action.payload.cardId : null;
  if (!action || !sourceCardId) {
    return [];
  }

  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard) {
    return [];
  }

  return [
    {
      cardId: sourceCardId,
      controllerId: action.playerId ?? sourceCard.ownerId,
      sourceSlot: toSlotPosition(action.payload.targetSlot),
      eventId: `action:${action.sequence}`,
      replacedMemberCardId:
        typeof action.payload.replacedCardId === 'string' ? action.payload.replacedCardId : undefined,
    },
  ];
}

function createOnEnterAbilitySourcesFromEvents(
  events: readonly EnterStageEvent[] | undefined
): readonly OnEnterAbilitySource[] | undefined {
  if (!events || events.length === 0) {
    return undefined;
  }

  return events.map((event) => ({
    cardId: event.cardInstanceId,
    controllerId: event.controllerId,
    sourceSlot: event.toSlot,
    eventId: event.eventId,
    replacedMemberCardId: event.replacedMemberCardId,
    replacedMemberEffectiveCost: event.replacedMemberEffectiveCost,
  }));
}

function createOnEnterStageAutoSources(
  game: GameState,
  events: readonly EnterStageEvent[] | undefined,
  onEnterSources: readonly OnEnterAbilitySource[] | undefined
): readonly OnEnterStageAutoSource[] {
  const enterEvents = events ?? createEnterStageEventsFromOnEnterSources(game, onEnterSources);
  if (enterEvents.length === 0) {
    return [];
  }

  const sources: OnEnterStageAutoSource[] = [];
  for (const event of enterEvents) {
    const enteredCard = getCardById(game, event.cardInstanceId);
    if (!enteredCard || !isHasunosoraMemberCard(enteredCard)) {
      continue;
    }

    const player = getPlayerById(game, event.controllerId);
    if (!player) {
      continue;
    }

    for (const sourceSlot of MEMBER_SLOT_ORDER) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      if (!sourceCardId) {
        continue;
      }

      sources.push({
        sourceCardId,
        controllerId: player.id,
        sourceSlot,
        enteredCardId: event.cardInstanceId,
        eventId: event.eventId,
      });
    }
  }

  return sources;
}

function createEnterStageEventsFromOnEnterSources(
  game: GameState,
  onEnterSources: readonly OnEnterAbilitySource[] | undefined
): readonly EnterStageEvent[] {
  const sources = onEnterSources ?? getLatestPlayMemberOnEnterSources(game);
  return sources.flatMap((source) => {
    if (source.sourceSlot === null) {
      return [];
    }
    const card = getCardById(game, source.cardId);
    if (!card) {
      return [];
    }
    return [
      {
        eventId: source.eventId,
        eventType: TriggerCondition.ON_ENTER_STAGE,
        timestamp: 0,
        cardInstanceId: source.cardId,
        fromZone: ZoneType.HAND,
        toZone: ZoneType.MEMBER_SLOT,
        toSlot: source.sourceSlot,
        ownerId: card.ownerId,
        controllerId: source.controllerId,
        triggerPlayerId: source.controllerId,
        replacedMemberCardId: source.replacedMemberCardId,
        replacedMemberEffectiveCost: source.replacedMemberEffectiveCost,
      },
    ];
  });
}

const isHasunosoraCard = groupAliasIs('蓮ノ空');
const isHasunosoraMemberCard = and(typeIs(CardType.MEMBER), isHasunosoraCard);
const hasBladeHeart = hasBladeHeartSelector();

function enqueueSingleOnEnterCardEffect(game: GameState, source: OnEnterAbilitySource): GameState {
  const sourceCard = getCardById(game, source.cardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.ON_ENTER,
    CardAbilitySourceZone.PLAYED_MEMBER,
    source.sourceSlot
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (
      abilityId === BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID &&
      !isBp5007NozomiLowerCostRelayOnEnter(sourceCard, source)
    ) {
      continue;
    }
    const pendingAbilityId = `${abilityId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.cardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [source.eventId],
      sourceSlot: source.sourceSlot ?? undefined,
      metadata:
        source.replacedMemberCardId || source.replacedMemberEffectiveCost !== undefined
          ? {
              replacedMemberCardId: source.replacedMemberCardId ?? null,
              replacedMemberEffectiveCost: source.replacedMemberEffectiveCost ?? null,
            }
          : undefined,
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.cardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        replacedMemberCardId: source.replacedMemberCardId ?? null,
        replacedMemberEffectiveCost: source.replacedMemberEffectiveCost ?? null,
      }
    );
  }

  return state;
}

function isBp5007NozomiLowerCostRelayOnEnter(
  sourceCard: CardInstance,
  source: OnEnterAbilitySource
): boolean {
  return (
    isMemberCardData(sourceCard.data) &&
    source.replacedMemberCardId !== undefined &&
    source.replacedMemberEffectiveCost !== undefined &&
    source.replacedMemberEffectiveCost < sourceCard.data.cost
  );
}

function enqueueOnEnterStageAutoCardEffects(
  game: GameState,
  sources: readonly OnEnterStageAutoSource[]
): GameState {
  let state = game;
  for (const source of sources) {
    state = enqueueSingleOnEnterStageAutoCardEffect(state, source);
  }
  return state;
}

function enqueueSingleOnEnterStageAutoCardEffect(
  game: GameState,
  source: OnEnterStageAutoSource
): GameState {
  const sourceCard = getCardById(game, source.sourceCardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter((ability) => ability.triggerCondition === TriggerCondition.ON_ENTER_STAGE);
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (!canUseAbilityThisTurn(state, source.controllerId, abilityId, source.sourceCardId)) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.sourceCardId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.sourceCardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [source.eventId],
      sourceSlot: source.sourceSlot,
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.sourceCardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        enteredCardId: source.enteredCardId,
      }
    );
  }

  return state;
}

function enqueueLiveStartCardEffects(
  game: GameState,
  liveStartEvents: readonly LiveStartEvent[] = []
): GameState {
  const liveStartEvent = liveStartEvents.at(-1);
  const performingPlayerId =
    liveStartEvent?.performerId ??
    game.liveResolution.performingPlayerId ??
    game.players[game.activePlayerIndex]?.id;
  const player = performingPlayerId ? getPlayerById(game, performingPlayerId) : null;
  if (!player) {
    return game;
  }

  const liveCardIds = liveStartEvent?.liveCardIds ?? player.liveZone.cardIds;
  const liveStartEventId =
    liveStartEvent?.eventId ?? `live-start:${game.turnCount}:${performingPlayerId}`;
  let state = game;
  const sourceEntries: AbilitySourceEntry[] = [
    ...MEMBER_SLOT_ORDER.flatMap((sourceSlot) => {
      const cardId = player.memberSlots.slots[sourceSlot];
      return cardId
        ? [
            {
              cardId,
              sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
              sourceSlot,
            },
          ]
        : [];
    }),
    ...liveCardIds.map((cardId) => ({
      cardId,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
    })),
  ];
  for (const sourceEntry of sourceEntries) {
    const sourceCardId = sourceEntry.cardId;
    const sourceCard = getCardById(state, sourceCardId);
    const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.LIVE_START,
      sourceEntry.sourceZone,
      sourceEntry.sourceSlot
    );
    if (!sourceCard || abilityDefinitions.length === 0) {
      continue;
    }

    for (const abilityDefinition of abilityDefinitions) {
      const abilityId = abilityDefinition.abilityId;
      const pendingAbilityId = `${abilityId}:${sourceCardId}:turn-${state.turnCount}:live-${performingPlayerId}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: sourceCard.ownerId,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: [liveStartEventId],
        sourceSlot: sourceEntry.sourceSlot ?? undefined,
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        pendingAbility.controllerId,
        {
          pendingAbilityId,
          abilityId: pendingAbility.abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          sourceSlot: sourceEntry.sourceSlot,
        }
      );
    }
  }

  return state;
}

function enqueueCheerCardEffects(
  game: GameState,
  cheerEvents: readonly CheerEvent[] = []
): GameState {
  const cheerEvent = cheerEvents.at(-1);
  if (cheerEvent?.additional === true) {
    return game;
  }

  const performingPlayerId =
    cheerEvent?.playerId ??
    game.liveResolution.performingPlayerId ??
    game.players[game.activePlayerIndex]?.id;
  const player = performingPlayerId ? getPlayerById(game, performingPlayerId) : null;
  if (!player) {
    return game;
  }

  const cheerEventId = cheerEvent?.eventId ?? `cheer:${game.turnCount}:${performingPlayerId}`;
  let state = game;
  for (const sourceCardId of player.liveZone.cardIds) {
    const sourceCard = getCardById(state, sourceCardId);
    const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.AUTO,
      CardAbilitySourceZone.LIVE_CARD
    ).filter((ability) => ability.triggerCondition === TriggerCondition.ON_CHEER);
    if (!sourceCard || abilityDefinitions.length === 0) {
      continue;
    }

    for (const abilityDefinition of abilityDefinitions) {
      const abilityId = abilityDefinition.abilityId;
      const pendingAbilityId = `${abilityId}:${sourceCardId}:${cheerEventId}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: sourceCard.ownerId,
        mandatory: true,
        timingId: TriggerCondition.ON_CHEER,
        eventIds: [cheerEventId],
        metadata: cheerEvent
          ? {
              revealedCardIds: cheerEvent.revealedCardIds,
              totalBlade: cheerEvent.totalBlade,
              automated: cheerEvent.automated === true,
              additional: cheerEvent.additional ?? false,
            }
          : undefined,
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        pendingAbility.controllerId,
        {
          pendingAbilityId,
          abilityId: pendingAbility.abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          revealedCardIds: cheerEvent?.revealedCardIds,
          totalBlade: cheerEvent?.totalBlade,
          automated: cheerEvent?.automated,
          additional: cheerEvent?.additional,
        }
      );
    }
  }

  return state;
}

function enqueueLiveSuccessCardEffects(
  game: GameState,
  liveSuccessEvents: readonly LiveSuccessEvent[] = []
): GameState {
  const liveSuccessEvent = liveSuccessEvents.at(-1);
  const playerId = liveSuccessEvent?.playerId ?? getLiveSuccessEffectPlayerId(game);
  const player = playerId ? getPlayerById(game, playerId) : null;
  if (!player) {
    return game;
  }

  let state = game;
  const successfulLiveCardIds =
    liveSuccessEvent?.successfulLiveCardIds ??
    [...state.liveResolution.liveResults.entries()]
      .filter(([cardId, isSuccess]) => {
        const card = getCardById(state, cardId);
        return isSuccess === true && card?.ownerId === player.id;
      })
      .map(([cardId]) => cardId);
  if (successfulLiveCardIds.length === 0) {
    return game;
  }

  const liveSuccessEventId = liveSuccessEvent?.eventId;
  const sourceEntries: AbilitySourceEntry[] = [
    ...MEMBER_SLOT_ORDER.flatMap((sourceSlot) => {
      const cardId = player.memberSlots.slots[sourceSlot];
      return cardId
        ? [
            {
              cardId,
              sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
              sourceSlot,
            },
          ]
        : [];
    }),
    ...successfulLiveCardIds.map((cardId) => ({
      cardId,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
    })),
  ];

  for (const sourceEntry of sourceEntries) {
    const sourceCardId = sourceEntry.cardId;
    const sourceCard = getCardById(state, sourceCardId);
    const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.LIVE_SUCCESS,
      sourceEntry.sourceZone,
      sourceEntry.sourceSlot
    );
    if (!sourceCard || abilityDefinitions.length === 0) {
      continue;
    }

    for (const abilityDefinition of abilityDefinitions) {
      const abilityId = abilityDefinition.abilityId;
      const pendingAbilityId = `${abilityId}:${sourceCardId}:turn-${state.turnCount}:live-success-${player.id}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: player.id,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: [
          liveSuccessEventId ?? `live-success:${state.turnCount}:${player.id}:${sourceCardId}`,
        ],
        sourceSlot: sourceEntry.sourceSlot ?? undefined,
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        pendingAbility.controllerId,
        {
          pendingAbilityId,
          abilityId: pendingAbility.abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          sourceSlot: sourceEntry.sourceSlot,
        }
      );
    }
  }

  return state;
}

function getLiveSuccessEffectPlayerId(game: GameState): string | null {
  if (game.currentSubPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS) {
    return game.players[game.firstPlayerIndex]?.id ?? null;
  }

  if (game.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS) {
    return game.players[game.firstPlayerIndex === 0 ? 1 : 0]?.id ?? null;
  }

  return game.liveResolution.performingPlayerId ?? game.players[game.activePlayerIndex]?.id ?? null;
}

function hasAbilityInstance(game: GameState, pendingAbilityId: string): boolean {
  const alreadyPending = game.pendingAbilities.some((ability) => ability.id === pendingAbilityId);
  const alreadyActive = game.activeEffect?.id === pendingAbilityId;
  const alreadyResolved = game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.payload.pendingAbilityId === pendingAbilityId
  );
  return alreadyPending || alreadyActive || alreadyResolved;
}

export function resolvePendingCardEffects(game: GameState): CardEffectRunnerResult {
  if (game.activeEffect) {
    return {
      gameState: game,
      resolvedAbilityIds: [],
    };
  }

  const pendingAbilities = getSupportedPendingAbilities(game);
  const ability = pendingAbilities[0];
  if (!ability) {
    return {
      gameState: game,
      resolvedAbilityIds: [],
    };
  }

  const sameTimingAbilities = pendingAbilities.filter((candidate) =>
    isSamePendingAbilityChoiceWindow(candidate, ability)
  );
  if (sameTimingAbilities.length > 1) {
    return {
      gameState: startAbilityOrderSelection(game, sameTimingAbilities),
      resolvedAbilityIds: [],
    };
  }

  return {
    gameState: startPendingAbilityEffect(game, ability),
    resolvedAbilityIds: [ability.id],
  };
}

export function confirmActiveEffectStep(
  game: GameState,
  playerId: string,
  effectId: string,
  selectedCardId?: string | null,
  selectedSlot?: SlotPosition | null,
  resolveInOrder?: boolean,
  selectedOptionId?: string | null,
  selectedCardIds?: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  if (effect.id !== effectId || effect.awaitingPlayerId !== playerId) {
    return game;
  }
  if (effect.abilityId === ABILITY_ORDER_SELECTION_ID) {
    return selectPendingAbilityOrder(
      game,
      selectedCardId,
      resolveInOrder === true,
      selectedOptionId
    );
  }
  if (effect.metadata?.confirmOnlyPendingAbility === true) {
    return finishConfirmOnlyPendingAbilityEffect(game, startPendingAbilityEffect);
  }

  const registryResult = resolveActiveEffectStepWithRegistry(
    game,
    {
      selectedCardId,
      selectedSlot,
      resolveInOrder,
      selectedOptionId,
      selectedCardIds,
    },
    { continuePendingCardEffects }
  );
  if (registryResult) {
    return registryResult;
  }

  if (effect.abilityId === KARIN_LIVE_START_ABILITY_ID && effect.stepId === KARIN_REVEAL_STEP_ID) {
    return finishKarinLiveStart(game);
  }

  if (
    effect.abilityId === KARIN_LIVE_START_ABILITY_ID &&
    effect.stepId === KARIN_POSITION_CHANGE_STEP_ID
  ) {
    return finishKarinPositionChange(game, selectedSlot ?? null);
  }

  if (
    effect.abilityId === BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID &&
    effect.stepId === BP5_007_SELECT_HAND_DISCARD_STEP_ID
  ) {
    return finishBp5007NozomiDiscardToThree(game, selectedCardId ?? null, selectedCardIds);
  }

  if (
    effect.abilityId === HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID &&
    effect.stepId === HS_BP6_031_RECYCLE_OPTION_STEP_ID
  ) {
    return selectedOptionId === 'activate'
      ? finishHsBp6031RecycleWaitingRoomMembers(game)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID &&
    effect.stepId === HS_BP6_031_SELECT_HIME_TARGET_STEP_ID
  ) {
    return finishHsBp6031SelectHimeBladeTarget(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID &&
    effect.stepId === HS_PB1_012_RECYCLE_CONFIRM_STEP_ID
  ) {
    return selectedOptionId === 'continue'
      ? finishHsPb1012RecycleWaitingRoomMembers(game)
      : game;
  }

  if (
    effect.abilityId === HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID &&
    effect.stepId === HS_PB1_012_SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return finishHsPb1012RecoverLiveAndGainBlade(game, selectedCardId ?? null);
  }

  return game;
}

export function activateCardAbility(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): GameState {
  if (!canUseActivatedAbilityThisTurn(game, playerId, abilityId, cardId)) {
    return game;
  }

  const registryResult = resolveActivatedAbilityWithRegistry(game, playerId, cardId, abilityId);
  if (registryResult) {
    return registryResult;
  }

  switch (abilityId) {
    case HANAYO_ACTIVATED_ABILITY_ID:
      return startHanayoActivatedEffect(game, playerId, cardId);
    default:
      return game;
  }
}

function getSupportedPendingAbilities(game: GameState): readonly PendingAbilityState[] {
  return game.pendingAbilities.filter((candidate) =>
    IMPLEMENTED_QUEUED_ABILITY_IDS.has(candidate.abilityId)
  );
}

function startAbilityOrderSelection(
  game: GameState,
  abilities: readonly PendingAbilityState[]
): GameState {
  const firstAbility = abilities[0];
  const sourceCardIds = abilities.map((ability) => ability.sourceCardId);
  const hasDuplicateSourceCards = new Set(sourceCardIds).size !== sourceCardIds.length;
  return {
    ...game,
    activeEffect: {
      id: `${ABILITY_ORDER_SELECTION_ID}:${firstAbility.timingId}:${firstAbility.controllerId}`,
      abilityId: ABILITY_ORDER_SELECTION_ID,
      sourceCardId: firstAbility.sourceCardId,
      controllerId: firstAbility.controllerId,
      effectText: '请选择下一个要发动的效果。也可以选择“顺序发动”，按当前队列顺序依次处理。',
      stepId: ABILITY_ORDER_SELECTION_STEP_ID,
      stepText: '选择下一个待处理效果',
      awaitingPlayerId: firstAbility.controllerId,
      selectableCardIds: hasDuplicateSourceCards ? undefined : sourceCardIds,
      selectableOptions: hasDuplicateSourceCards
        ? abilities.map((ability, index) => ({
            id: ability.id,
            label: getAbilityOrderOptionLabel(game, ability, index),
          }))
        : undefined,
      canResolveInOrder: true,
      metadata: {
        pendingAbilityIds: abilities.map((ability) => ability.id),
        usesAbilityOptions: hasDuplicateSourceCards,
      },
    },
  };
}

function selectPendingAbilityOrder(
  game: GameState,
  selectedCardId: string | null | undefined,
  resolveInOrder: boolean,
  selectedOptionId?: string | null
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ORDER_SELECTION_ID) {
    return game;
  }

  const pendingAbilityIds = Array.isArray(effect.metadata?.pendingAbilityIds)
    ? effect.metadata.pendingAbilityIds.filter((id): id is string => typeof id === 'string')
    : [];
  const candidates = game.pendingAbilities.filter((ability) =>
    pendingAbilityIds.includes(ability.id)
  );
  const selectedAbility = resolveInOrder
    ? candidates[0]
    : selectedOptionId
      ? candidates.find((ability) => ability.id === selectedOptionId)
      : candidates.find((ability) => ability.sourceCardId === selectedCardId);

  if (!selectedAbility) {
    return game;
  }

  return startPendingAbilityEffect(
    {
      ...game,
      activeEffect: null,
    },
    selectedAbility,
    { orderedResolution: resolveInOrder, manualConfirmation: !resolveInOrder }
  );
}

function getAbilityOrderOptionLabel(
  game: GameState,
  ability: PendingAbilityState,
  index: number
): string {
  const sourceCard = getCardById(game, ability.sourceCardId);
  const abilityDefinition = CARD_ABILITY_DEFINITIONS.find(
    (definition) => definition.abilityId === ability.abilityId
  );
  const cardName = sourceCard?.data.name ?? '未知卡牌';
  return `${index + 1}. ${cardName}：${abilityDefinition?.effectText ?? ability.abilityId}`;
}

function continuePendingCardEffects(game: GameState, orderedResolution: boolean): GameState {
  if (game.activeEffect) {
    return game;
  }

  const pendingAbilities = getSupportedPendingAbilities(game);
  if (pendingAbilities.length === 0) {
    return game;
  }

  if (orderedResolution) {
    return startPendingAbilityEffect(game, pendingAbilities[0], { orderedResolution: true });
  }

  const nextAbility = pendingAbilities[0];
  const sameTimingAbilities = pendingAbilities.filter((candidate) =>
    isSamePendingAbilityChoiceWindow(candidate, nextAbility)
  );

  return sameTimingAbilities.length > 1
    ? startAbilityOrderSelection(game, sameTimingAbilities)
    : startPendingAbilityEffect(game, nextAbility);
}

function skipPendingAbilityWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      sourceSlot: ability.sourceSlot,
    }),
    orderedResolution
  );
}

function isOrderedResolutionEffect(game: GameState): boolean {
  return game.activeEffect?.metadata?.orderedResolution === true;
}

function isSamePendingAbilityChoiceWindow(
  left: PendingAbilityState,
  right: PendingAbilityState
): boolean {
  if (left.controllerId !== right.controllerId) {
    return false;
  }

  if (left.timingId === right.timingId) {
    return true;
  }

  if (isRelayReplacementAbilityChoiceWindow(left, right)) {
    return true;
  }

  return left.eventIds.some((eventId) => right.eventIds.includes(eventId));
}

function isRelayReplacementAbilityChoiceWindow(
  left: PendingAbilityState,
  right: PendingAbilityState
): boolean {
  const enterAbility =
    left.timingId === TriggerCondition.ON_ENTER_STAGE
      ? left
      : right.timingId === TriggerCondition.ON_ENTER_STAGE
        ? right
        : null;
  const leaveAbility =
    left.timingId === TriggerCondition.ON_LEAVE_STAGE
      ? left
      : right.timingId === TriggerCondition.ON_LEAVE_STAGE
        ? right
        : null;

  return (
    enterAbility !== null &&
    leaveAbility !== null &&
    leaveAbility.metadata?.replacingCardId === enterAbility.sourceCardId
  );
}

function startPendingAbilityEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const registryResult = resolvePendingAbilityStarterWithRegistry(
    game,
    ability,
    options,
    { continuePendingCardEffects }
  );
  if (registryResult) {
    return registryResult;
  }

  switch (ability.abilityId) {
    case BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID:
      return startBp5007NozomiDiscardToThreeThenDraw(game, ability, options);
    case KARIN_LIVE_START_ABILITY_ID:
      return startKarinLiveStartInspection(game, ability, options);
    case HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID:
      return startHsBp6031LiveStartRecycleMembers(game, ability, options);
    case HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID:
      return startHsPb1012OnEnterRecycleMembers(game, ability, options);
    case PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID:
      return resolvePb1015OwnEffectWaitOpponentLowCostDraw(game, ability, options);
    default:
      return game;
  }
}

interface Bp5007NozomiEffectContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
}

function startBp5007NozomiDiscardToThreeThenDraw(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return startBp5007NozomiNextDiscardStep(
    state,
    ability,
    [player.id, opponent.id],
    0,
    options.orderedResolution === true
  );
}

function startBp5007NozomiNextDiscardStep(
  game: GameState,
  context: Bp5007NozomiEffectContext,
  playerIds: readonly string[],
  startIndex: number,
  orderedResolution: boolean
): GameState {
  for (let index = startIndex; index < playerIds.length; index += 1) {
    const playerId = playerIds[index];
    const player = getPlayerById(game, playerId);
    const discardCount = Math.max(0, (player?.hand.cardIds.length ?? 0) - 3);
    if (!player || discardCount === 0) {
      continue;
    }

    const stepText = `请选择${discardCount}张手牌放置入休息室，使手牌数变为3张。`;
    return addAction(
      {
        ...game,
        activeEffect: {
          id: context.id,
          abilityId: context.abilityId,
          sourceCardId: context.sourceCardId,
          controllerId: context.controllerId,
          effectText: getCardAbilityEffectText(
            BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID
          ),
          stepId: BP5_007_SELECT_HAND_DISCARD_STEP_ID,
          stepText,
          awaitingPlayerId: player.id,
          selectableCardIds: player.hand.cardIds,
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
          selectableCardMode: 'ORDERED_MULTI',
          minSelectableCards: discardCount,
          maxSelectableCards: discardCount,
          selectionLabel: '请选择要放置入休息室的手牌',
          confirmSelectionLabel: '放置入休息室',
          metadata: {
            orderedResolution,
            discardPlayerIds: playerIds,
            discardPlayerIndex: index,
            discardCount,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: context.id,
        abilityId: context.abilityId,
        sourceCardId: context.sourceCardId,
        step: 'START_DISCARD_TO_THREE',
        discardPlayerId: player.id,
        discardCount,
      }
    );
  }

  return finishBp5007NozomiDrawThree(game, context, playerIds, orderedResolution);
}

function finishBp5007NozomiDiscardToThree(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds?: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID ||
    effect.stepId !== BP5_007_SELECT_HAND_DISCARD_STEP_ID ||
    !effect.awaitingPlayerId
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.awaitingPlayerId);
  if (!player) {
    return game;
  }

  const discardCount =
    typeof effect.metadata?.discardCount === 'number'
      ? Math.floor(effect.metadata.discardCount)
      : Math.max(0, player.hand.cardIds.length - 3);
  const selectedCardIdsList =
    selectedCardIds && selectedCardIds.length > 0
      ? selectedCardIds
      : selectedCardId
        ? [selectedCardId]
        : [];
  const uniqueSelectedCardIds = [...new Set(selectedCardIdsList)];
  const selectableCardIds = effect.selectableCardIds ?? [];

  if (
    uniqueSelectedCardIds.length !== discardCount ||
    uniqueSelectedCardIds.length !== selectedCardIdsList.length ||
    uniqueSelectedCardIds.some(
      (cardId) => !selectableCardIds.includes(cardId) || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomForPlayer(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: discardCount,
      candidateCardIds: selectableCardIds,
    }
  );
  if (!discardResult) {
    return game;
  }

  const playerIds = Array.isArray(effect.metadata?.discardPlayerIds)
    ? effect.metadata.discardPlayerIds.filter((value): value is string => typeof value === 'string')
    : [effect.controllerId];
  const currentIndex =
    typeof effect.metadata?.discardPlayerIndex === 'number'
      ? Math.floor(effect.metadata.discardPlayerIndex)
      : 0;
  const orderedResolution = effect.metadata?.orderedResolution === true;

  const stateAfterDiscard = addAction(
    {
      ...discardResult.gameState,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_TO_THREE',
      discardPlayerId: player.id,
      discardedCardIds: discardResult.discardedCardIds,
    }
  );

  return startBp5007NozomiNextDiscardStep(
    stateAfterDiscard,
    effect,
    playerIds,
    currentIndex + 1,
    orderedResolution
  );
}

function finishBp5007NozomiDrawThree(
  game: GameState,
  context: Bp5007NozomiEffectContext,
  playerIds: readonly string[],
  orderedResolution: boolean
): GameState {
  let state: GameState = {
    ...game,
    activeEffect: null,
  };

  const drawResult = drawCardsForEachPlayer(state, playerIds, 3);
  if (!drawResult) {
    return game;
  }
  state = drawResult.gameState;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', context.controllerId, {
      pendingAbilityId: context.id,
      abilityId: context.abilityId,
      sourceCardId: context.sourceCardId,
      step: 'DRAW_THREE_AFTER_HAND_ADJUST',
      drawnCardIdsByPlayer: drawResult.drawnCardIdsByPlayer,
    }),
    orderedResolution
  );
}

function finishSelectCardsFromZoneToHandEffect(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined = undefined
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const orderedSelections =
    Array.isArray(selectedCardIds) && selectedCardIds.length > 0 ? selectedCardIds : [];
  const selectedCardIdsToMove =
    orderedSelections.length > 0
      ? orderedSelections
      : selectedCardId !== null
        ? [selectedCardId]
        : [];
  const uniqueSelectedCardIds = [...new Set(selectedCardIdsToMove)];
  if (uniqueSelectedCardIds.length !== selectedCardIdsToMove.length) {
    return game;
  }
  const zoneSelection = getZoneSelectionConfig(effect);
  if (
    uniqueSelectedCardIds.length < zoneSelection.minCount ||
    uniqueSelectedCardIds.length > zoneSelection.maxCount
  ) {
    return game;
  }
  const selectedAreValid = uniqueSelectedCardIds.every(
    (cardId) =>
      effect.selectableCardIds?.includes(cardId) === true &&
      player.waitingRoom.cardIds.includes(cardId)
  );
  if (!selectedAreValid) {
    return game;
  }
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      minCount: zoneSelection.minCount,
      maxCount: zoneSelection.maxCount,
    }
  );
  if (!recoveryResult) {
    return game;
  }
  let state = recoveryResult.gameState;
  state = { ...state, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      selectedCardIds: recoveryResult.movedCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startKarinLiveStartInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.mainDeck.cardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'FINISH',
        inspectedCardIds: [],
        destination: null,
      }),
      options.orderedResolution === true
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 1,
    reveal: true,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds } = inspection;

  const state = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getCardAbilityEffectText(KARIN_LIVE_START_ABILITY_ID),
      stepId: KARIN_REVEAL_STEP_ID,
      stepText: '卡组顶1张已公开。确认后费用9以下成员加入手牌；否则放入休息室。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution: options.orderedResolution === true,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
  });
}

function startHsBp6031LiveStartRecycleMembers(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingRoomMemberCardIds = getCardIdsMatchingSelector(
    game,
    getCardIdsInZone(game, player.id, ZoneType.WAITING_ROOM),
    typeIs(CardType.MEMBER)
  );
  const miraCraMemberCount = countCardsMatchingSelector(
    game,
    waitingRoomMemberCardIds,
    unitAliasIs('みらくらぱーく！')
  );

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID),
        stepId: HS_BP6_031_RECYCLE_OPTION_STEP_ID,
        stepText: `可以将休息室${waitingRoomMemberCardIds.length}张成员卡洗回卡组底，其中みらくらぱーく！成员${miraCraMemberCount}张。`,
        awaitingPlayerId: player.id,
        selectableOptions: [
          { id: 'activate', label: '发动' },
          { id: 'decline', label: DECLINE_OPTION_LABEL },
        ],
        metadata: {
          orderedResolution: options.orderedResolution === true,
          waitingRoomMemberCardIds,
          miraCraMemberCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_RECYCLE_WAITING_ROOM_MEMBERS_OPTION',
      waitingRoomMemberCardIds,
      miraCraMemberCount,
    }
  );
}

function finishHsBp6031RecycleWaitingRoomMembers(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP6_031_RECYCLE_OPTION_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingRoomMemberCardIds = getWaitingRoomMemberCardIds(game, player.id);
  const miraCraMemberCount = countCardsMatchingSelector(
    game,
    waitingRoomMemberCardIds,
    unitAliasIs('みらくらぱーく！')
  );
  const recycleResult = shuffleWaitingRoomCardsToDeckBottomForPlayer(
    game,
    player.id,
    waitingRoomMemberCardIds
  );
  if (!recycleResult) {
    return game;
  }
  const himeTargetCardIds =
    miraCraMemberCount >= 15
      ? getStageMemberCardIdsMatching(
          recycleResult.gameState,
          player.id,
          cardNameAliasIs('安養寺姫芽')
        )
      : [];
  const baseAction = {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    movedMemberCardIds: recycleResult.movedCardIds,
    miraCraMemberCount,
  };

  if (himeTargetCardIds.length === 0) {
    const state = { ...recycleResult.gameState, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        ...baseAction,
        step:
          miraCraMemberCount >= 15
            ? 'RECYCLE_MEMBERS_NO_HIME_TARGET'
            : 'RECYCLE_MEMBERS_CONDITION_NOT_MET',
      }),
      isOrderedResolutionEffect(game)
    );
  }

  return addAction(
    {
      ...recycleResult.gameState,
      activeEffect: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: getCardAbilityEffectText(HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID),
        stepId: HS_BP6_031_SELECT_HIME_TARGET_STEP_ID,
        stepText: '请选择1名自己舞台上的「安养寺姬芽」获得BLADE +3。',
        awaitingPlayerId: player.id,
        selectableCardIds: himeTargetCardIds,
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得BLADE +3的安养寺姬芽',
        confirmSelectionLabel: '获得BLADE',
        metadata: {
          orderedResolution: isOrderedResolutionEffect(game),
          movedMemberCardIds: recycleResult.movedCardIds,
          miraCraMemberCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      ...baseAction,
      step: 'RECYCLE_MEMBERS_SELECT_HIME_TARGET',
      selectableCardIds: himeTargetCardIds,
    }
  );
}

function finishHsBp6031SelectHimeBladeTarget(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP6_031_SELECT_HIME_TARGET_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const stateAfterModifier = addLiveModifier(game, {
    kind: 'BLADE',
    playerId: player.id,
    countDelta: 3,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
  });
  const state = { ...stateAfterModifier, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_HIME_GAIN_BLADE',
      targetMemberCardId: selectedCardId,
      bladeBonus: 3,
      movedMemberCardIds: effect.metadata?.movedMemberCardIds,
      miraCraMemberCount: effect.metadata?.miraCraMemberCount,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsPb1012OnEnterRecycleMembers(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player) {
    return game;
  }

  const ownWaitingRoomMemberCardIds = getWaitingRoomMemberCardIds(game, player.id);
  const opponentWaitingRoomMemberCardIds = opponent
    ? getWaitingRoomMemberCardIds(game, opponent.id)
    : [];
  const totalWaitingRoomMemberCount =
    ownWaitingRoomMemberCardIds.length + opponentWaitingRoomMemberCardIds.length;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID),
        stepId: HS_PB1_012_RECYCLE_CONFIRM_STEP_ID,
        stepText: `双方将休息室成员洗回卡组底：自己${ownWaitingRoomMemberCardIds.length}张，对方${opponentWaitingRoomMemberCardIds.length}张，合计${totalWaitingRoomMemberCount}张。`,
        awaitingPlayerId: player.id,
        selectableOptions: [{ id: 'continue', label: '继续处理' }],
        metadata: {
          orderedResolution: options.orderedResolution === true,
          ownWaitingRoomMemberCardIds,
          opponentWaitingRoomMemberCardIds,
          totalWaitingRoomMemberCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_RECYCLE_BOTH_WAITING_ROOM_MEMBERS',
      ownWaitingRoomMemberCardIds,
      opponentWaitingRoomMemberCardIds,
      totalWaitingRoomMemberCount,
    }
  );
}

function finishHsPb1012RecycleWaitingRoomMembers(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== HS_PB1_012_RECYCLE_CONFIRM_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player) {
    return game;
  }

  const ownWaitingRoomMemberCardIds = getWaitingRoomMemberCardIds(game, player.id);
  const ownRecycleResult = shuffleWaitingRoomCardsToDeckBottomForPlayer(
    game,
    player.id,
    ownWaitingRoomMemberCardIds
  );
  if (!ownRecycleResult) {
    return game;
  }
  const opponentWaitingRoomMemberCardIds = opponent
    ? getWaitingRoomMemberCardIds(ownRecycleResult.gameState, opponent.id)
    : [];
  const opponentRecycleResult = opponent
    ? shuffleWaitingRoomCardsToDeckBottomForPlayer(
        ownRecycleResult.gameState,
        opponent.id,
        opponentWaitingRoomMemberCardIds
      )
    : { gameState: ownRecycleResult.gameState, movedCardIds: [] };
  if (!opponentRecycleResult) {
    return game;
  }
  const movedOwnMemberCardIds = ownRecycleResult.movedCardIds;
  const movedOpponentMemberCardIds = opponentRecycleResult.movedCardIds;
  const totalMovedMemberCount = movedOwnMemberCardIds.length + movedOpponentMemberCardIds.length;
  const baseAction = {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    movedOwnMemberCardIds,
    movedOpponentMemberCardIds,
    totalMovedMemberCount,
  };

  if (totalMovedMemberCount < 20) {
    const state = { ...opponentRecycleResult.gameState, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        ...baseAction,
        step: 'RECYCLE_MEMBERS_CONDITION_NOT_MET',
      }),
      isOrderedResolutionEffect(game)
    );
  }

  const selectableLiveCardIds = selectWaitingRoomCardIds(
    opponentRecycleResult.gameState,
    player.id,
    typeIs(CardType.LIVE)
  );
  if (selectableLiveCardIds.length === 0) {
    const stateAfterModifier = addHsPb1012BladeModifier(
      opponentRecycleResult.gameState,
      effect,
      player.id
    );
    if (!stateAfterModifier) {
      return game;
    }
    const state = { ...stateAfterModifier, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        ...baseAction,
        step: 'RECYCLE_MEMBERS_NO_LIVE_TARGET_GAIN_BLADE',
        bladeBonus: 2,
      }),
      isOrderedResolutionEffect(game)
    );
  }

  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: 1,
    maxCount: 1,
    optional: false,
  });
  return addAction(
    {
      ...opponentRecycleResult.gameState,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: getCardAbilityEffectText(HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID),
        stepId: HS_PB1_012_SELECT_WAITING_ROOM_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张LIVE卡加入手牌。之后获得BLADE +2。',
        awaitingPlayerId: player.id,
        selectableCardIds: selectableLiveCardIds,
        canSkipSelection: false,
        metadata: {
          orderedResolution: isOrderedResolutionEffect(game),
          movedOwnMemberCardIds,
          movedOpponentMemberCardIds,
          totalMovedMemberCount,
        },
        zoneSelection,
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      ...baseAction,
      step: 'RECYCLE_MEMBERS_SELECT_WAITING_ROOM_LIVE',
      selectableCardIds: selectableLiveCardIds,
    }
  );
}

function finishHsPb1012RecoverLiveAndGainBlade(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== HS_PB1_012_SELECT_WAITING_ROOM_LIVE_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  const stateAfterModifier = addHsPb1012BladeModifier(recoveryResult.gameState, effect, player.id);
  if (!stateAfterModifier) {
    return game;
  }
  const state = { ...stateAfterModifier, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_LIVE_GAIN_BLADE',
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      movedOwnMemberCardIds: effect.metadata?.movedOwnMemberCardIds,
      movedOpponentMemberCardIds: effect.metadata?.movedOpponentMemberCardIds,
      totalMovedMemberCount: effect.metadata?.totalMovedMemberCount,
      bladeBonus: 2,
    }),
    isOrderedResolutionEffect(game)
  );
}

function addHsPb1012BladeModifier(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string
): GameState | null {
  return addBladeLiveModifierForSourceMember(game, {
    playerId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: 2,
  })?.gameState ?? null;
}

function getWaitingRoomMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getCardIdsInZoneMatching(game, playerId, ZoneType.WAITING_ROOM, typeIs(CardType.MEMBER));
}

function resolvePb1015OwnEffectWaitOpponentLowCostDraw(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  state = recordAbilityUse(state, player.id, ability.abilityId, ability.sourceCardId);
  const drawResult = drawCardsForPlayer(state, player.id, 1);
  if (!drawResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_CARD',
      sourceSlot: ability.sourceSlot,
      changedCardId: ability.metadata?.changedCardId,
      changedControllerId: ability.metadata?.changedControllerId,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    options.orderedResolution === true
  );
}

function finishKarinLiveStart(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const revealedCardId = inspectedCardIds[0] ?? null;
  const revealedCard = revealedCardId ? getCardById(game, revealedCardId) : null;
  const shouldAddToHand =
    revealedCard !== null && isMemberCardData(revealedCard.data) && revealedCard.data.cost <= 9;
  const destination = shouldAddToHand ? ZoneType.HAND : ZoneType.WAITING_ROOM;
  const orderedResolution = isOrderedResolutionEffect(game);

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand:
      shouldAddToHand && revealedCardId
        ? addCardToZone(currentPlayer.hand, revealedCardId)
        : currentPlayer.hand,
    waitingRoom:
      !shouldAddToHand && revealedCardId
        ? addCardToZone(currentPlayer.waitingRoom, revealedCardId)
        : currentPlayer.waitingRoom,
  }));

  state = {
    ...state,
    inspectionZone: {
      ...state.inspectionZone,
      cardIds: state.inspectionZone.cardIds.filter((cardId) => !inspectedCardIds.includes(cardId)),
      revealedCardIds: state.inspectionZone.revealedCardIds.filter(
        (cardId) => !inspectedCardIds.includes(cardId)
      ),
    },
    inspectionContext: null,
    activeEffect: null,
  };

  state = addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'REVEAL_FINISH',
    inspectedCardIds,
    revealedCardId,
    destination,
  });

  if (!shouldAddToHand) {
    return continuePendingCardEffects(state, orderedResolution);
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot) {
    return continuePendingCardEffects(state, orderedResolution);
  }

  return {
    ...state,
    activeEffect: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      effectText: getCardAbilityEffectText(KARIN_LIVE_START_ABILITY_ID),
      stepId: KARIN_POSITION_CHANGE_STEP_ID,
      stepText: '公开的卡片已加入手牌。请选择朝香果林要移动到的成员区。',
      awaitingPlayerId: player.id,
      selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
      metadata: {
        orderedResolution,
        sourceSlot,
      },
    },
  };
}

function finishKarinPositionChange(game: GameState, selectedSlot: SlotPosition | null): GameState {
  const effect = game.activeEffect;
  if (!effect || !selectedSlot) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot || sourceSlot === selectedSlot) {
    return game;
  }

  const moveResult = moveMemberBetweenSlots(game, player.id, effect.sourceCardId, selectedSlot);
  if (!moveResult) {
    return game;
  }

  const orderedResolution = isOrderedResolutionEffect(game);
  const state = {
    ...moveResult.gameState,
    activeEffect: null,
  };
  const stateWithMemberMoveTriggers = enqueueTriggeredCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'POSITION_CHANGE',
      fromSlot: moveResult.fromSlot,
      toSlot: moveResult.toSlot,
      swappedCardId: moveResult.swappedCardId,
    }),
    [TriggerCondition.ON_MEMBER_SLOT_MOVED],
    {
      memberSlotMovedEvents: getNewMemberSlotMovedEvents(game, moveResult.gameState),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberMoveTriggers,
    orderedResolution
  );
}

function startHanayoActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-sd1-008')
  ) {
    return game;
  }
  let state = recordAbilityUse(game, player.id, HANAYO_ACTIVATED_ABILITY_ID, cardId);
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!costPayment) {
    return game;
  }
  const moveResult = moveTopDeckCardsToWaitingRoom(costPayment.gameState, player.id, 10);
  if (!moveResult) {
    return game;
  }
  state = moveResult.gameState;
  state = addAction(state, 'PAY_COST', player.id, {
    abilityId: HANAYO_ACTIVATED_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
  });
  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: HANAYO_ACTIVATED_ABILITY_ID,
    sourceCardId: cardId,
    effectText: getCardAbilityEffectText(HANAYO_ACTIVATED_ABILITY_ID),
    step: 'MILL_TOP_TEN',
    milledCardIds: moveResult.movedCardIds,
  });
}

function finishSkipEffect(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const state = { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SKIP',
    }),
    isOrderedResolutionEffect(game)
  );
}

interface StageMemberLocation {
  readonly playerId: string;
  readonly cardId: string;
  readonly slot: SlotPosition;
}

function getStageMemberLocations(game: GameState): readonly StageMemberLocation[] {
  return game.players.flatMap((player) =>
    MEMBER_SLOT_ORDER.flatMap((slot) => {
      const cardId = player.memberSlots.slots[slot];
      return cardId ? [{ playerId: player.id, cardId, slot }] : [];
    })
  );
}

function findStageMemberLocation(game: GameState, cardId: string): StageMemberLocation | null {
  return getStageMemberLocations(game).find((location) => location.cardId === cardId) ?? null;
}

function findMemberSlot(
  player: { memberSlots: { slots: Readonly<Record<SlotPosition, string | null>> } },
  cardId: string
): SlotPosition | null {
  for (const slot of Object.values(SlotPosition)) {
    if (player.memberSlots.slots[slot] === cardId) {
      return slot;
    }
  }
  return null;
}
