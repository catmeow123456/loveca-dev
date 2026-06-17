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
import { isLiveCardData, isMemberCardData, type CardInstance } from '../domain/entities/card.js';
import type { ActiveEffectState, GameState, PendingAbilityState } from '../domain/entities/game.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  updatePlayer,
} from '../domain/entities/game.js';
import { addCardToZone, shuffleZone } from '../domain/entities/zone.js';
import {
  addLiveModifier,
  replaceLiveModifier,
} from '../domain/rules/live-modifiers.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  moveSelectedCardsFromZone,
  selectWaitingRoomCardIds,
} from './effects/zone-selection.js';
import {
  moveRevealedCheerCards,
  selectRevealedCheerCardIds,
  type CheerCardPredicate,
  type RevealedCheerCardDestination,
} from './effects/cheer-selection.js';
import { revealCheerCardsFromMainDeck } from './effects/cheer.js';
import {
  and,
  cardNameAliasAny,
  cardNameAliasIs,
  cardNameContains,
  cardNameIs,
  costGte,
  costLte,
  groupAliasIs,
  groupIs,
  hasNoAbilityOrContinuousAbility,
  hasBladeHeart as hasBladeHeartSelector,
  liveRequiresHeartColor,
  memberHasHeartColor,
  memberPrintedBladeLte,
  normalizeCardName,
  not,
  or,
  typeIs,
  unitAliasIs,
} from './effects/card-selectors.js';
import {
  allCardIdsMatchingSelector,
  countCardIdsMatchingSelectors,
  countCardsInZoneMatching,
  countCardsMatchingSelector,
  countOtherLiveZoneCardsMatching,
  countStageMembers,
  countSuccessfulLiveCards,
  getCardIdsInZoneMatching,
  getCardIdsMatchingSelector,
  getCardIdsInZone,
  getSourceEffectiveBladeCount,
  hasAtLeastCardsMatchingSelector,
  hasCardIdsMatchingSelector,
  hasOtherStageMember,
  hasStageMemberMatching,
  sourceHasBladeAtLeast,
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
} from './effects/conditions.js';
import {
  moveHandCardToWaitingRoomForEffect,
  payImmediateEffectCosts,
  paySelectedDiscardHandCost,
  type EffectCostDefinition,
} from './effects/effect-costs.js';
import {
  clearInspectionCards,
  inspectTopCards,
  moveInspectedCardsToWaitingRoom,
  moveInspectedSelectionToHandRestToWaitingRoom,
  moveTopDeckCardsToWaitingRoom,
} from './effects/look-top.js';
import {
  moveMemberBetweenSlots,
  playMembersFromWaitingRoomToEmptySlots,
  setMembersOrientation,
} from './effects/member-state.js';
import { drawCardsFromMainDeckToHand } from './effects/draw.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from './effects/stage-member-target-selection.js';
import {
  getStageMemberCardIdsByOrientation,
  getStageMemberCardIdsMatching,
} from './effects/stage-targets.js';
import {
  getEnergyCardIdsByOrientation,
  placeEnergyFromDeckToZone,
  setEnergyOrientation,
  setFirstEnergyCardsOrientation,
} from './effects/energy.js';
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
  NOZOMI_ON_ENTER_ABILITY_ID,
  UMI_ON_ENTER_ABILITY_ID,
  HONOKA_ON_ENTER_ABILITY_ID,
  KOTORI_ON_ENTER_ABILITY_ID,
  MAKI_ON_ENTER_ABILITY_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
  LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID,
  LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
  HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  KARIN_LIVE_START_ABILITY_ID,
  KOTORI_LIVE_START_HEART_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
  BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
  HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  ELI_ACTIVATED_ABILITY_ID,
  RIN_ACTIVATED_ABILITY_ID,
  PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
  BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  BP4_003_ACTIVATED_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
  HANAYO_ACTIVATED_ABILITY_ID,
  START_DASH_LIVE_SUCCESS_ABILITY_ID,
  KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
  BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID,
  SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID,
  BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
  BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID,
  PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
  SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
  SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
  SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
  HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
  HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID,
  HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
  HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
  HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
  HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
  HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
  CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID,
  EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
  YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
  HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
  HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
  PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
  HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
  HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
  HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
  HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
  HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
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
const DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL = '请选择要放置入休息室的卡牌';
const DISCARD_HAND_TO_ACTIVATE_STEP_TEXT = '请选择要放置入休息室的手牌。也可以选择不发动此效果。';
const DECLINE_OPTION_LABEL = '不发动';
const ABILITY_USE_STEP = 'ABILITY_USE';
const ACTIVATED_ABILITY_USE_STEP = 'ACTIVATED_ABILITY_USE';
const START_DASH_ARRANGE_STEP_ID = 'START_DASH_ARRANGE_TOP_DECK';
const PL_BP3_014_ON_ENTER_OPTION_STEP_ID = 'PL_BP3_014_ON_ENTER_OPTION';
const PL_BP3_014_ON_ENTER_ARRANGE_STEP_ID = 'PL_BP3_014_ON_ENTER_ARRANGE_TOP_TWO';
const HS_BP6_001_ARRANGE_STEP_ID = 'HS_BP6_001_ARRANGE_STAGE_PLUS_TWO_TOP_DECK';
const HS_BP6_001_SELECT_CHEER_TO_TOP_STEP_ID = 'HS_BP6_001_SELECT_REVEALED_CHEER_TO_TOP';
const HS_CL1_009_SELECT_CHEER_MEMBER_TO_HAND_STEP_ID =
  'HS_CL1_009_SELECT_REVEALED_CHEER_MEMBER_TO_HAND';
const HS_BP6_027_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID =
  'HS_BP6_027_SELECT_REVEALED_CHEER_TO_WAITING_ROOM';
const HS_BP6_031_RECYCLE_OPTION_STEP_ID = 'HS_BP6_031_RECYCLE_MEMBERS_OPTION';
const HS_BP6_031_SELECT_HIME_TARGET_STEP_ID = 'HS_BP6_031_SELECT_HIME_BLADE_TARGET';
const HS_PB1_012_RECYCLE_CONFIRM_STEP_ID = 'HS_PB1_012_RECYCLE_MEMBERS_CONFIRM';
const HS_PB1_012_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'HS_PB1_012_SELECT_WAITING_ROOM_LIVE';
const N_BP4_018_SELECT_DISCARD_STEP_ID = 'N_BP4_018_SELECT_DISCARD';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const CHISATO_LIVE_START_ACTIVATE_STEP_ID = 'CHISATO_LIVE_START_ACTIVATE_ALL';
const EMMA_SELECT_TARGET_TYPE_STEP_ID = 'EMMA_SELECT_ACTIVATE_TARGET_TYPE';
const EMMA_SELECT_MEMBER_STEP_ID = 'EMMA_SELECT_MEMBER_TO_ACTIVATE';
const YOSHIKO_PAY_COST_STEP_ID = 'YOSHIKO_PAY_COST';
const YOSHIKO_SELECT_WAITING_ROOM_MEMBERS_STEP_ID = 'YOSHIKO_SELECT_WAITING_ROOM_LOW_COST_MEMBERS';
const YOSHIKO_SELECT_STAGE_SLOT_STEP_ID = 'YOSHIKO_SELECT_STAGE_SLOT';
const HS_BP5_001_SELECT_HAND_LIVE_STEP_ID = 'HS_BP5_001_SELECT_HAND_LIVE_TO_REVEAL';
const HS_BP5_001_REVEAL_HAND_LIVE_STEP_ID = 'HS_BP5_001_REVEAL_HAND_LIVE';
const HS_BP5_001_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'HS_BP5_001_SELECT_WAITING_ROOM_SAME_NAME_LIVE';
const HS_BP1_003_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'HS_BP1_003_SELECT_WAITING_ROOM_LOW_COST_MEMBER';
const HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_TO_PLAY';
const CONFIRM_ONLY_EFFECT_STEP_ID = 'CONFIRM_ONLY_EFFECT';

interface DiscardHandToWaitingRoomEffectConfig {
  readonly ability: PendingAbilityState;
  readonly playerId: string;
  readonly effectText: string;
  readonly stepId: string;
  readonly selectableCardIds: readonly string[];
  readonly orderedResolution: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface DiscardHandThenWaitingRoomRecoveryActivatedConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCodes: readonly string[];
  readonly effectText: string;
  readonly discardStepId: string;
  readonly recoveryStepId: string;
  readonly discardCount: number;
  readonly canActivate?: (game: GameState, playerId: string) => boolean;
  readonly recoverySelectionRequiredWhenHasTargets?: boolean;
}

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

interface RevealedCheerCardSelectionConfig {
  readonly ability: PendingAbilityState;
  readonly playerId: string;
  readonly effectText: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly predicate?: CheerCardPredicate;
  readonly destination: RevealedCheerCardDestination;
  readonly optional: boolean;
  readonly selectMin?: number;
  readonly selectMax?: number;
  readonly additionalCheerEqualToMoved?: boolean;
  readonly skipSelectionLabel?: string;
  readonly orderedResolution: boolean;
}

interface DrawThenDiscardCardsEffectConfig {
  readonly ability: PendingAbilityState;
  readonly effectText: string;
  readonly drawCount: number;
  readonly discardCount: number;
  readonly stepId: string;
  readonly orderedResolution: boolean;
  readonly recordAbilityUseOnStart?: boolean;
}

interface MemberPositionChangeEffectConfig {
  readonly ability: PendingAbilityState;
  readonly effectText: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly optional: boolean;
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

function createDiscardHandToWaitingRoomActivationEffect(
  config: DiscardHandToWaitingRoomEffectConfig
): ActiveEffectState {
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: true,
  };
  return {
    id: config.ability.id,
    abilityId: config.ability.abilityId,
    sourceCardId: config.ability.sourceCardId,
    controllerId: config.ability.controllerId,
    effectText: config.effectText,
    stepId: config.stepId,
    stepText: DISCARD_HAND_TO_ACTIVATE_STEP_TEXT,
    awaitingPlayerId: config.playerId,
    selectableCardIds: config.selectableCardIds,
    selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    selectionLabel: DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL,
    canSkipSelection: true,
    skipSelectionLabel: DECLINE_OPTION_LABEL,
    metadata: {
      ...config.metadata,
      orderedResolution: config.orderedResolution,
      effectCosts: [discardCost],
      handToWaitingRoomCost: {
        minCount: discardCost.minCount,
        maxCount: discardCost.maxCount,
        optional: discardCost.optional,
      },
    },
  };
}

function startConfirmOnlyPendingAbilityEffect(
  game: GameState,
  ability: PendingAbilityState,
  effectText: string,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  return {
    ...game,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText,
      stepId: CONFIRM_ONLY_EFFECT_STEP_ID,
      stepText: '确认后继续处理此效果。',
      awaitingPlayerId: ability.controllerId,
      metadata: {
        confirmOnlyPendingAbility: true,
        orderedResolution: options.orderedResolution === true,
      },
    },
  };
}

function finishConfirmOnlyPendingAbilityEffect(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.metadata?.confirmOnlyPendingAbility !== true) {
    return game;
  }
  const pendingAbility = game.pendingAbilities.find(
    (ability) =>
      ability.id === effect.id &&
      ability.abilityId === effect.abilityId &&
      ability.sourceCardId === effect.sourceCardId
  );
  if (!pendingAbility) {
    return game;
  }
  return startPendingAbilityEffect({ ...game, activeEffect: null }, pendingAbility, {
    orderedResolution: effect.metadata.orderedResolution === true,
    skipManualConfirmation: true,
  });
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
const NOZOMI_REVEAL_STEP_ID = 'NOZOMI_REVEAL_TOP_FIVE';
const UMI_SELECT_STEP_ID = 'UMI_SELECT_MUSE_LIVE';
const UMI_REVEAL_STEP_ID = 'UMI_REVEAL_SELECTED_LIVE';
const SELECT_WAITING_ROOM_CARD_STEP_ID = 'SELECT_WAITING_ROOM_CARD';
const MAKI_SELECT_HAND_LIVE_STEP_ID = 'MAKI_SELECT_HAND_LIVE';
const MAKI_SELECT_SUCCESS_LIVE_STEP_ID = 'MAKI_SELECT_SUCCESS_LIVE';
const DISCARD_LOOK_SELECT_DISCARD_STEP_ID = 'DISCARD_LOOK_SELECT_DISCARD';
const DISCARD_LOOK_SELECT_TAKE_STEP_ID = 'DISCARD_LOOK_SELECT_TAKE';
const DISCARD_LOOK_REVEAL_SELECTED_STEP_ID = 'DISCARD_LOOK_REVEAL_SELECTED';
const SP_BP2_002_SELECT_HIGH_COST_CARD_STEP_ID = 'SP_BP2_002_SELECT_HIGH_COST_CARD';
const SP_BP2_002_REVEAL_SELECTED_STEP_ID = 'SP_BP2_002_REVEAL_SELECTED_HIGH_COST_CARD';
const BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_STEP_ID =
  'BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD';
const BP6_002_REVEAL_SELECTED_STEP_ID =
  'BP6_002_REVEAL_SELECTED_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD';
const BP6_005_SELECT_DISCARD_STEP_ID = 'BP6_005_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS_STEP_ID =
  'BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS';
const SELECT_NAMED_HAND_DISCARD_STEP_ID = 'SELECT_NAMED_HAND_DISCARD';
const KARIN_REVEAL_STEP_ID = 'KARIN_REVEAL_TOP_CARD';
const KARIN_POSITION_CHANGE_STEP_ID = 'KARIN_POSITION_CHANGE';
const KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID = 'KOTORI_LIVE_START_SELECT_DISCARD';
const KOTORI_LIVE_START_SELECT_HEART_STEP_ID = 'KOTORI_LIVE_START_SELECT_HEART';
const NICO_SCORE_BONUS_STEP_ID = 'NICO_SCORE_BONUS';
const BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID = 'BOKUIMA_REQUIREMENT_REDUCTION';
const HS_BP5_019_REQUIREMENT_REDUCTION_STEP_ID = 'HS_BP5_019_REQUIREMENT_REDUCTION';
const HS_BP2_022_SCORE_BONUS_STEP_ID = 'HS_BP2_022_SCORE_BONUS';
const BP4_021_SUCCESS_SCORE_MODIFIER_STEP_ID = 'BP4_021_SUCCESS_SCORE_MODIFIER';
const HS_SD1_006_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'HS_SD1_006_SELECT_HASUNOSORA_LIVE_FROM_WAITING_ROOM';
const HS_SD1_006_LIVE_START_PAY_ENERGY_STEP_ID = 'HS_SD1_006_LIVE_START_PAY_ENERGY';
const BP4_010_LIVE_START_PAY_ENERGY_STEP_ID = 'BP4_010_LIVE_START_PAY_ENERGY';
const HS_PR_001_LIVE_START_PAY_ENERGY_STEP_ID = 'HS_PR_001_LIVE_START_PAY_ENERGY';
const HS_PB1_004_SELECT_DISCARD_STEP_ID = 'HS_PB1_004_SELECT_DISCARD_FOR_MILL_RECOVER';
const HS_PB1_004_SELECT_CERISE_LIVE_STEP_ID = 'HS_PB1_004_SELECT_CERISE_LIVE_FROM_WAITING_ROOM';
const HS_PR_019_REVEAL_STEP_ID = 'HS_PR_019_REVEAL_TOP_THREE';
const HS_BP5_001_REVEAL_STEP_ID = 'HS_BP5_001_REVEAL_TOP_FOUR';
const ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'ELI_SELECT_WAITING_ROOM_MEMBER';
const RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'RIN_SELECT_WAITING_ROOM_LIVE';
const PR_017_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID = 'PR_017_SELECT_WAITING_ROOM_MUSE_LIVE';
const BP4_002_SELECT_DISCARD_STEP_ID = 'BP4_002_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID =
  'BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE';
const PR_018_SELECT_HIGH_SCORE_LIVE_STEP_ID = 'PR_018_SELECT_HIGH_SCORE_LIVE_FROM_WAITING_ROOM';
const KEKE_SELECT_DISCARD_STEP_ID = 'KEKE_SELECT_DISCARD_FOR_WAITING_ENERGY';
const SHIKI_LEFT_SELECT_DISCARD_STEP_ID = 'SHIKI_LEFT_SELECT_DISCARD_AFTER_DRAW';
const HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID = 'HS_BP1_006_ON_ENTER_SELECT_DISCARD';
const HS_BP1_004_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'HS_BP1_004_SELECT_HASUNOSORA_LIVE_FROM_WAITING_ROOM';
const HS_BP1_004_LIVE_START_PAY_ENERGY_STEP_ID = 'HS_BP1_004_LIVE_START_PAY_ENERGY';
const HS_BP2_012_SELECT_MEMBER_STEP_ID = 'HS_BP2_012_SELECT_MEMBER_FROM_TOP_FIVE';
const HS_BP2_012_REVEAL_SELECTED_STEP_ID = 'HS_BP2_012_REVEAL_SELECTED_MEMBER';
const HS_BP6_017_SELECT_DISCARD_STEP_ID = 'HS_BP6_017_SELECT_DISCARD_FOR_RECOVERY';
const HS_BP6_017_SELECT_WAITING_ROOM_CARDS_STEP_ID =
  'HS_BP6_017_SELECT_LIVE_AND_MEMBER_FROM_WAITING_ROOM';
const HS_PB1_020_SELECT_DISCARD_STEP_ID = 'HS_PB1_020_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const HS_PB1_020_SELECT_WAITING_ROOM_CARDS_STEP_ID =
  'HS_PB1_020_SELECT_CERISE_MEMBER_AND_HASUNOSORA_LIVE';
const HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID = 'HS_BP6_004_SELECT_OPPONENT_MEMBER_TO_WAIT';
const SP_BP4_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID =
  'SP_BP4_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_TO_WAIT';
const HS_BP6_004_SELECT_DISCARD_STEP_ID = 'HS_BP6_004_SELECT_DISCARD_FOR_BLADE';
const HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID = 'HS_PB1_009_LIVE_START_SELECT_DISCARD';
const BP4_003_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'BP4_003_SELECT_WAITING_ROOM_LIVE';
const SHIKI_RIGHT_ACTIVATE_ENERGY_STEP_ID = 'SHIKI_RIGHT_ACTIVATE_ENERGY';
const SHIKI_LIVE_START_POSITION_CHANGE_STEP_ID = 'SHIKI_LIVE_START_POSITION_CHANGE';
const PB1_019_SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'PB1_019_SELECT_WAITING_ROOM_MEMBER';
const ABILITY_ORDER_SELECTION_STEP_ID = 'SELECT_NEXT_PENDING_ABILITY';
const KOTORI_HEART_COLOR_OPTIONS = [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE] as const;
const STANDARD_HEART_COLOR_OPTIONS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;
const HEART_COLOR_OPTION_LABELS: Readonly<Record<HeartColor, string>> = {
  [HeartColor.PINK]: '粉心',
  [HeartColor.RED]: '红心',
  [HeartColor.YELLOW]: '黄心',
  [HeartColor.GREEN]: '绿心',
  [HeartColor.BLUE]: '蓝心',
  [HeartColor.PURPLE]: '紫心',
  [HeartColor.RAINBOW]: '虹心',
};

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

function getNewMemberStateChangedEvents(
  before: GameState,
  after: GameState
): readonly MemberStateChangedEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberStateChangedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
    );
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

function getNewEnterStageEvents(before: GameState, after: GameState): readonly EnterStageEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is EnterStageEvent =>
        event.eventType === TriggerCondition.ON_ENTER_STAGE
    );
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
    replacingCardId: event.replacingCardId,
  }));
}

function isHighCostHasunosoraRelayReplacement(
  game: GameState,
  source: OnLeaveStageAbilitySource
): boolean {
  if (!source.replacingCardId) {
    return false;
  }
  const replacingCard = getCardById(game, source.replacingCardId);
  return (
    replacingCard !== null &&
    isMemberCardData(replacingCard.data) &&
    isHasunosoraCard(replacingCard) &&
    costGte(10)(replacingCard)
  );
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
      },
    ];
  });
}

const isHasunosoraCard = groupAliasIs('蓮ノ空');
const isHasunosoraMemberCard = and(typeIs(CardType.MEMBER), isHasunosoraCard);
const isHasunosoraLiveCard = and(typeIs(CardType.LIVE), isHasunosoraCard);
const hasBladeHeart = hasBladeHeartSelector();

function isCeriseBouquetMemberCard(card: CardInstance): boolean {
  return isMemberCardData(card.data) && unitAliasIs('Cerise Bouquet')(card);
}

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
      }
    );
  }

  return state;
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
    return finishConfirmOnlyPendingAbilityEffect(game);
  }

  if (effect.abilityId === NOZOMI_ON_ENTER_ABILITY_ID && effect.stepId === NOZOMI_REVEAL_STEP_ID) {
    return finishNozomiOnEnter(game);
  }

  if (
    effect.abilityId === HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID &&
    effect.stepId === HS_PR_019_REVEAL_STEP_ID
  ) {
    return finishHsPr019GinkoMillGainGreenHeart(game);
  }

  if (
    effect.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID &&
    effect.stepId === HS_BP5_001_REVEAL_STEP_ID
  ) {
    return finishHsBp5KahoOnEnterMillGainBlade(game);
  }

  if (
    (effect.abilityId === HONOKA_ON_ENTER_ABILITY_ID ||
      effect.abilityId === KOTORI_ON_ENTER_ABILITY_ID ||
      effect.abilityId === HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID ||
      effect.abilityId === PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID) &&
    (effect.stepId === SELECT_WAITING_ROOM_CARD_STEP_ID ||
      effect.stepId === PR_018_SELECT_HIGH_SCORE_LIVE_STEP_ID)
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    (effect.abilityId === LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID ||
      effect.abilityId === HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID) &&
    effect.stepId === SELECT_WAITING_ROOM_CARD_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null, selectedCardIds);
  }

  if (effect.abilityId === UMI_ON_ENTER_ABILITY_ID && effect.stepId === UMI_SELECT_STEP_ID) {
    return selectedCardId
      ? revealUmiSelectedLive(game, selectedCardId)
      : finishUmiOnEnter(game, null);
  }

  if (effect.abilityId === UMI_ON_ENTER_ABILITY_ID && effect.stepId === UMI_REVEAL_STEP_ID) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishUmiOnEnter(game, selectedCardIdFromMetadata);
  }

  if (
    (effect.abilityId === LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID ||
      effect.abilityId === LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID) &&
    effect.stepId === SELECT_NAMED_HAND_DISCARD_STEP_ID
  ) {
    return selectedCardIds
      ? finishNamedHandDiscardLiveStartEffect(game, selectedCardIds)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === MAKI_ON_ENTER_ABILITY_ID &&
    effect.stepId === MAKI_SELECT_HAND_LIVE_STEP_ID
  ) {
    return startMakiSelectSuccessLive(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === MAKI_ON_ENTER_ABILITY_ID &&
    effect.stepId === MAKI_SELECT_SUCCESS_LIVE_STEP_ID
  ) {
    return finishMakiOnEnter(game, selectedCardId ?? null);
  }

  if (
    (effect.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID ||
      effect.abilityId === BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID ||
      effect.abilityId === HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID) &&
    effect.stepId === DISCARD_LOOK_SELECT_DISCARD_STEP_ID
  ) {
    if (effect.abilityId === HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID) {
      return selectedCardId
        ? startHsBp5IzumiOnEnterInspection(game, selectedCardId)
        : finishSkipEffect(game);
    }
    return selectedCardId
      ? startDiscardLookTopInspection(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    (effect.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID ||
      effect.abilityId === BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID ||
      effect.abilityId === HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID) &&
    effect.stepId === DISCARD_LOOK_SELECT_TAKE_STEP_ID
  ) {
    if (effect.metadata?.revealSelectedBeforeHand === true && selectedCardId) {
      return revealDiscardLookTopSelectedCard(game, selectedCardId);
    }
    return finishDiscardLookTopEffect(game, selectedCardId ?? null);
  }

  if (
    (effect.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID ||
      effect.abilityId === BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID ||
      effect.abilityId === HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID) &&
    effect.stepId === DISCARD_LOOK_REVEAL_SELECTED_STEP_ID
  ) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishDiscardLookTopEffect(game, selectedCardIdFromMetadata);
  }

  if (
    effect.abilityId === SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID &&
    effect.stepId === SP_BP2_002_SELECT_HIGH_COST_CARD_STEP_ID
  ) {
    return selectedCardId
      ? revealLookTopSelectedCard(game, selectedCardId)
      : finishLookTopSelectToHandEffect(game, null, costGte(11));
  }

  if (
    effect.abilityId === SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID &&
    effect.stepId === SP_BP2_002_REVEAL_SELECTED_STEP_ID
  ) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishLookTopSelectToHandEffect(game, selectedCardIdFromMetadata, costGte(11));
  }

  if (
    effect.abilityId === BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID &&
    effect.stepId === BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_STEP_ID
  ) {
    return selectedCardId
      ? revealLookTopSelectedCard(game, selectedCardId)
      : finishLookTopSelectToHandEffect(game, null, isNoAbilityOrContinuousMuseCard);
  }

  if (
    effect.abilityId === BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID &&
    effect.stepId === BP6_002_REVEAL_SELECTED_STEP_ID
  ) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishLookTopSelectToHandEffect(
      game,
      selectedCardIdFromMetadata,
      isNoAbilityOrContinuousMuseCard
    );
  }

  if (
    effect.abilityId === HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID &&
    effect.stepId === HS_BP2_012_SELECT_MEMBER_STEP_ID
  ) {
    return selectedCardId
      ? revealHsBp2KosuzuSelectedMember(game, selectedCardId)
      : finishHsBp2KosuzuLeaveStageEffect(game, null);
  }

  if (
    effect.abilityId === HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID &&
    effect.stepId === HS_BP2_012_REVEAL_SELECTED_STEP_ID
  ) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishHsBp2KosuzuLeaveStageEffect(game, selectedCardIdFromMetadata);
  }

  if (
    effect.abilityId === HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID &&
    effect.stepId === HS_BP6_017_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? startHsBp6KahoWaitingRoomSelectionAfterDiscard(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID &&
    effect.stepId === HS_BP6_017_SELECT_WAITING_ROOM_CARDS_STEP_ID
  ) {
    return finishHsBp6KahoRecoverCards(game, selectedCardIds ?? []);
  }

  if (
    effect.abilityId ===
      HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID &&
    effect.stepId === HS_PB1_020_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardIds
      ? startHsPb1GinkoWaitingRoomSelectionAfterDiscardTwo(game, selectedCardIds)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId ===
      HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID &&
    effect.stepId === HS_PB1_020_SELECT_WAITING_ROOM_CARDS_STEP_ID
  ) {
    return finishHsPb1GinkoRecoverCeriseMemberAndHasunosoraLive(game, selectedCardIds ?? []);
  }

  if (
    effect.abilityId === BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID &&
    effect.stepId === BP6_005_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardIds
      ? startBp6005RinWaitingRoomSelectionAfterDiscardTwo(game, selectedCardIds)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID &&
    effect.stepId === BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS_STEP_ID
  ) {
    return finishBp6005RinRecoverYellowHeartCards(game, selectedCardIds ?? []);
  }

  if (
    effect.abilityId === BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID &&
    effect.stepId === BP4_002_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardIds
      ? startDiscardHandThenWaitingRoomRecoveryAfterDiscard(game, selectedCardIds)
      : game;
  }

  if (
    effect.abilityId === BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID &&
    effect.stepId === BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
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
    effect.abilityId === NICO_LIVE_START_SCORE_ABILITY_ID &&
    effect.stepId === NICO_SCORE_BONUS_STEP_ID
  ) {
    return finishNicoLiveStartScoreBonus(game);
  }

  if (
    (effect.abilityId === KOTORI_LIVE_START_HEART_ABILITY_ID ||
      effect.abilityId === HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID) &&
    effect.stepId === KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? startKotoriLiveStartHeartChoice(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    (effect.abilityId === KOTORI_LIVE_START_HEART_ABILITY_ID ||
      effect.abilityId === HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID) &&
    effect.stepId === KOTORI_LIVE_START_SELECT_HEART_STEP_ID
  ) {
    return finishKotoriLiveStartHeartBonus(game, selectedOptionId ?? null);
  }

  if (
    effect.abilityId === BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID &&
    effect.stepId === BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID
  ) {
    return finishBokuimaLiveStartRequirementReduction(game);
  }

  if (
    effect.abilityId === HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID &&
    effect.stepId === HS_BP5_019_REQUIREMENT_REDUCTION_STEP_ID
  ) {
    return finishHsBp5HanamusubiLiveStartRequirementReduction(game);
  }

  if (
    effect.abilityId === HS_BP2_022_LIVE_START_SCORE_ABILITY_ID &&
    effect.stepId === HS_BP2_022_SCORE_BONUS_STEP_ID
  ) {
    return finishHsBp2AokuharukaLiveStartScoreBonus(game);
  }

  if (
    effect.abilityId === BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID &&
    effect.stepId === BP4_021_SUCCESS_SCORE_MODIFIER_STEP_ID
  ) {
    return finishBp4021HeartbeatLiveStartSuccessScoreModifier(game);
  }

  if (
    effect.abilityId === PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID &&
    effect.stepId === PL_BP3_014_ON_ENTER_OPTION_STEP_ID
  ) {
    if (selectedOptionId === 'decline') {
      return finishPlBp3OnEnterLookTopTwoDecline(game);
    }
    return selectedOptionId === 'activate'
      ? finishPlBp3OnEnterLookTopTwoActivate(game)
      : game;
  }

  if (
    (effect.abilityId === START_DASH_LIVE_SUCCESS_ABILITY_ID &&
      effect.stepId === START_DASH_ARRANGE_STEP_ID) ||
    (effect.abilityId === HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID &&
      effect.stepId === HS_BP6_001_ARRANGE_STEP_ID) ||
    (effect.abilityId === PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID &&
      effect.stepId === PL_BP3_014_ON_ENTER_ARRANGE_STEP_ID)
  ) {
    return finishArrangeInspectedDeckTopEffect(game, selectedCardIds ?? []);
  }

  if (
    effect.abilityId === HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID &&
    effect.stepId === HS_BP6_001_SELECT_CHEER_TO_TOP_STEP_ID
  ) {
    return finishRevealedCheerCardSelection(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID &&
    effect.stepId === HS_CL1_009_SELECT_CHEER_MEMBER_TO_HAND_STEP_ID
  ) {
    return finishRevealedCheerCardSelection(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID &&
    effect.stepId === HS_BP6_027_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID
  ) {
    return finishRevealedCheerCardSelection(game, selectedCardIds ?? []);
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

  if (
    effect.abilityId === KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID &&
    effect.stepId === KEKE_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? finishKekeOnEnterPlaceWaitingEnergy(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID &&
    effect.stepId === SHIKI_LEFT_SELECT_DISCARD_STEP_ID
  ) {
    return finishDrawThenDiscardCardsEffect(game, selectedCardId ?? null, selectedCardIds);
  }

  if (
    effect.abilityId === HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID &&
    effect.stepId === HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID
  ) {
    return finishDrawThenDiscardCardsEffect(game, selectedCardId ?? null, selectedCardIds);
  }

  if (
    effect.abilityId === HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID &&
    effect.stepId === HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID
  ) {
    return finishDrawThenDiscardCardsEffect(game, selectedCardId ?? null, selectedCardIds);
  }

  if (
    effect.abilityId === HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID &&
    effect.stepId === HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID
  ) {
    return finishDrawThenDiscardCardsEffect(game, selectedCardId ?? null, selectedCardIds);
  }

  if (
    effect.abilityId === N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID &&
    effect.stepId === N_BP4_018_SELECT_DISCARD_STEP_ID
  ) {
    return finishDrawThenDiscardCardsEffect(game, selectedCardId ?? null, selectedCardIds);
  }

  if (
    (effect.abilityId === HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID ||
      effect.abilityId === HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID) &&
    effect.stepId === HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID
  ) {
    return finishHsBp6GinkoWaitOpponentLowCostMember(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID &&
    effect.stepId === SP_BP4_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID
  ) {
    return finishHsBp6GinkoWaitOpponentLowCostMember(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID &&
    effect.stepId === HS_BP6_004_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? finishHsBp6GinkoDiscardGainBlade(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID &&
    effect.stepId === HS_BP1_004_LIVE_START_PAY_ENERGY_STEP_ID
  ) {
    return selectedOptionId === 'pay'
      ? finishHsBp1TsuzuriLiveStartPayEnergy(game)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID &&
    effect.stepId === HS_SD1_006_SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    (effect.abilityId === HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID &&
      effect.stepId === HS_SD1_006_LIVE_START_PAY_ENERGY_STEP_ID) ||
    (effect.abilityId === BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID &&
      effect.stepId === BP4_010_LIVE_START_PAY_ENERGY_STEP_ID) ||
    (effect.abilityId === HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID &&
      effect.stepId === HS_PR_001_LIVE_START_PAY_ENERGY_STEP_ID)
  ) {
    return selectedOptionId === 'pay'
      ? finishLiveStartPayEnergyGainFixedBlade(game)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId ===
      HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID &&
    effect.stepId === HS_PB1_004_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? finishHsPb1GinkoPayEnergyDiscardMillRecoverCeriseLive(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId ===
      HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID &&
    effect.stepId === HS_PB1_004_SELECT_CERISE_LIVE_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID &&
    effect.stepId === SHIKI_RIGHT_ACTIVATE_ENERGY_STEP_ID
  ) {
    return finishShikiOnEnterRightActivateEnergy(game);
  }

  if (
    effect.abilityId === SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID &&
    effect.stepId === SHIKI_LIVE_START_POSITION_CHANGE_STEP_ID
  ) {
    return finishMemberPositionChangeEffect(game, selectedSlot ?? null);
  }

  if (
    effect.abilityId === CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID &&
    effect.stepId === CHISATO_LIVE_START_ACTIVATE_STEP_ID
  ) {
    return finishChisatoLiveStartActivateAll(game);
  }

  if (
    effect.abilityId === EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID &&
    effect.stepId === EMMA_SELECT_TARGET_TYPE_STEP_ID
  ) {
    return startEmmaTargetSelection(game, selectedOptionId ?? null);
  }

  if (
    effect.abilityId === EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID &&
    effect.stepId === EMMA_SELECT_MEMBER_STEP_ID
  ) {
    return finishEmmaActivateMember(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
    effect.stepId === YOSHIKO_PAY_COST_STEP_ID
  ) {
    return selectedOptionId === 'pay'
      ? startYoshikoWaitingRoomSelectionAfterCost(game)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
    effect.stepId === YOSHIKO_SELECT_WAITING_ROOM_MEMBERS_STEP_ID
  ) {
    return startYoshikoSelectStageSlot(game, selectedCardIds ?? []);
  }

  if (
    effect.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
    effect.stepId === YOSHIKO_SELECT_STAGE_SLOT_STEP_ID
  ) {
    return finishYoshikoSelectStageSlot(game, selectedSlot ?? null);
  }

  if (
    effect.abilityId === HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID &&
    effect.stepId === HS_BP1_003_SELECT_WAITING_ROOM_MEMBER_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID &&
    effect.stepId === HS_BP5_001_SELECT_HAND_LIVE_STEP_ID
  ) {
    return revealHsBp5KahoActivatedHandLive(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID &&
    effect.stepId === HS_BP5_001_REVEAL_HAND_LIVE_STEP_ID
  ) {
    return startHsBp5KahoActivatedSelectSameNameLive(game);
  }

  if (
    effect.abilityId === HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID &&
    effect.stepId === HS_BP5_001_SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID &&
    effect.stepId === HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID
  ) {
    return finishHsBp1SayakaPlayMemberToSourceSlot(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === ELI_ACTIVATED_ABILITY_ID &&
    effect.stepId === ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === RIN_ACTIVATED_ABILITY_ID &&
    effect.stepId === RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID &&
    effect.stepId === PR_017_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID
  ) {
    return finishPr017NicoRecoverMuseLiveActivateEnergy(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === PB1_019_ACTIVATED_ABILITY_ID &&
    effect.stepId === PB1_019_SELECT_WAITING_ROOM_MEMBER_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === BP4_003_ACTIVATED_ABILITY_ID &&
    effect.stepId === BP4_003_SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID &&
    effect.stepId === HS_BP1_004_SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
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

  switch (abilityId) {
    case ELI_ACTIVATED_ABILITY_ID:
      return startEliActivatedEffect(game, playerId, cardId);
    case RIN_ACTIVATED_ABILITY_ID:
      return startRinActivatedEffect(game, playerId, cardId);
    case PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID:
      return startPr017NicoActivatedEffect(game, playerId, cardId);
    case BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID:
      return startBp4002EliActivatedEffect(game, playerId, cardId);
    case BP4_003_ACTIVATED_ABILITY_ID:
      return startBp4ActivatedEffect(game, playerId, cardId);
    case PB1_019_ACTIVATED_ABILITY_ID:
      return startPb1ActivatedEffect(game, playerId, cardId);
    case HANAYO_ACTIVATED_ABILITY_ID:
      return startHanayoActivatedEffect(game, playerId, cardId);
    case HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID:
      return startHsBp1TsuzuriActivatedRecoverLive(game, playerId, cardId);
    case HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID:
      return startHsBp5KahoActivatedRevealHandLiveRecoverSameNameLive(game, playerId, cardId);
    case HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID:
      return startHsBp1KosuzuActivatedRecoverLowCostMember(game, playerId, cardId);
    case HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID:
      return startHsBp1SayakaActivatedPlayMemberToSourceSlot(game, playerId, cardId);
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
  switch (ability.abilityId) {
    case NOZOMI_ON_ENTER_ABILITY_ID:
      return startNozomiOnEnterInspection(game, ability, options);
    case UMI_ON_ENTER_ABILITY_ID:
      return startUmiOnEnterInspection(game, ability, options);
    case HONOKA_ON_ENTER_ABILITY_ID:
      return startHonokaOnEnterSelection(game, ability, options);
    case KOTORI_ON_ENTER_ABILITY_ID:
      return startKotoriOnEnterSelection(game, ability, options);
    case LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID:
      return startLLBp1OnEnterSelection(game, ability, options);
    case LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID:
      return startNamedHandDiscardLiveStartEffect(game, ability, options, {
        effectText: getCardAbilityEffectText(LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID),
        names: ['上原歩夢', '澁谷かのん', '日野下花帆'],
        minCount: 3,
        maxCount: 3,
        rewardKind: 'SCORE',
        rewardAmount: 3,
      });
    case LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID:
      return startNamedHandDiscardLiveStartEffect(game, ability, options, {
        effectText: getCardAbilityEffectText(LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID),
        names: ['渡辺曜', '鬼塚夏美', '大沢瑠璃乃'],
        minCount: 1,
        rewardKind: 'BLADE_PER_DISCARDED',
      });
    case MAKI_ON_ENTER_ABILITY_ID:
      return startMakiOnEnterSelection(game, ability, options);
    case HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID:
      return startHsBp2OnEnterSelection(game, ability, options);
    case BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID:
      return resolveBp5RinOnEnterSuccessScorePlaceActiveEnergy(game, ability, options);
    case SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID:
      return startSpBp2KekeOnEnterLookHighCostCard(game, ability, options);
    case BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID:
      return startBp6002EliOnEnterLookNoAbilityOrContinuousMuseCard(game, ability, options);
    case BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID:
      return startBp6005RinDiscardTwoRecoverYellowHeartCards(game, ability, options);
    case PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID:
      return startPr018NozomiOnEnterRecoverHighScoreLive(game, ability, options);
    case HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID:
      return startHsBp2KosuzuLeaveStageInspection(game, ability, options);
    case HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID:
      return startHsBp6KahoLeaveStageDiscard(game, ability, options);
    case HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID:
      return resolveHsSd1KahoRelayReplacedActivateEnergy(game, ability, options);
    case HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID:
      return startHsPb1GinkoDiscardTwoRecoverCeriseMemberAndHasunosoraLive(game, ability, options);
    case HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID:
      return resolveHsPb1KahoOnHasunosoraEnterGainBlade(game, ability, options);
    case HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID:
      return startHsPb1KahoLiveStartDrawDiscard(game, ability, options);
    case HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID:
    case HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID:
      return startHsBp6GinkoWaitOpponentLowCostMember(game, ability, options);
    case SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID:
      return startSpBp4011TomariWaitOpponentLowBladeMember(game, ability, options);
    case HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID:
      return startHsBp6GinkoLiveStartDiscardGainBlade(game, ability, options);
    case HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID:
      return startHsBp1TsuzuriLiveStartPayEnergy(game, ability, options);
    case GENERIC_DISCARD_LOOK_TOP_ABILITY_ID:
      return startGenericDiscardLookTopEffect(game, ability, options);
    case BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID:
      return startGenericDiscardLookTopEffect(game, ability, options);
    case KARIN_LIVE_START_ABILITY_ID:
      return startKarinLiveStartInspection(game, ability, options);
    case KOTORI_LIVE_START_HEART_ABILITY_ID:
      return startKotoriLiveStartEffect(game, ability, options);
    case HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID:
      return startKotoriLiveStartEffect(game, ability, {
        ...options,
        effectText: getCardAbilityEffectText(HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID),
        requiresOtherStageMember: true,
        heartColorOptions: STANDARD_HEART_COLOR_OPTIONS,
      });
    case NICO_LIVE_START_SCORE_ABILITY_ID:
      return startNicoLiveStartScoreBonus(game, ability, options);
    case BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID:
      return startBokuimaLiveStartRequirementReduction(game, ability, options);
    case HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID:
      return startHsBp5HanamusubiLiveStartRequirementReduction(game, ability, options);
    case HS_BP2_022_LIVE_START_SCORE_ABILITY_ID:
      return startHsBp2AokuharukaLiveStartScoreBonus(game, ability, options);
    case BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID:
      return startBp4021HeartbeatLiveStartSuccessScoreModifier(game, ability, options);
    case HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID:
      return startHsSd1HimeOnEnterActivateEnergyRecoverLive(game, ability, options);
    case HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID:
      return startHsSd1HimeLiveStartPayEnergyGainBlade(game, ability, options);
    case BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID:
      return startLiveStartPayEnergyGainFixedBlade(game, ability, {
        ...options,
        effectText: getCardAbilityEffectText(BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID),
        stepId: BP4_010_LIVE_START_PAY_ENERGY_STEP_ID,
        energyCostCount: 1,
        bladeBonus: 2,
      });
    case HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID:
      return startLiveStartPayEnergyGainFixedBlade(game, ability, {
        ...options,
        effectText: getCardAbilityEffectText(HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID),
        stepId: HS_PR_001_LIVE_START_PAY_ENERGY_STEP_ID,
        energyCostCount: 2,
        bladeBonus: 1,
      });
    case HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID:
      return startHsBp5IzumiOnEnterWaitDiscardLookTop(game, ability, options);
    case HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID:
      return startHsPb1GinkoPayEnergyDiscardMillRecoverCeriseLive(game, ability, options);
    case HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID:
      return startHsPr019GinkoMillGainGreenHeartInspection(game, ability, options);
    case START_DASH_LIVE_SUCCESS_ABILITY_ID:
      return startStartDashLiveSuccessEffect(game, ability, options);
    case KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID:
      return startKekeOnEnterPlaceWaitingEnergy(game, ability, options);
    case SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID:
      return startShikiOnEnterLeftDrawDiscard(game, ability, options);
    case SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID:
      return startShikiOnEnterRightActivateEnergy(game, ability, options);
    case SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID:
      return startShikiLiveStartPositionChange(game, ability, options);
    case CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID:
      return startChisatoLiveStartActivateAll(game, ability, options);
    case EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID:
      return startEmmaOnEnterActivateMemberOrEnergy(game, ability, options);
    case YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID:
      return startYoshikoOnEnterPlayLowCostMembers(game, ability, options);
    case HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID:
      return startHsBp5KahoOnEnterMillGainBladeInspection(game, ability, options);
    case HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID:
      return startHsBp6KahoOnEnterLookStagePlusTwo(game, ability, options);
    case PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID:
      return startPlBp3OnEnterLookTopTwoArrangeToTop(game, ability, options);
    case HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID:
      return startHsBp6KahoLiveSuccessCheerToTop(game, ability, options);
    case HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID:
      return startHsCl1WatercolorWorldLiveSuccessCheerMemberToHand(game, ability, options);
    case HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID:
      return startHsBp6027TsukiyomiOnCheerAdditionalCheer(game, ability, options);
    case HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID:
      return startHsBp6031LiveStartRecycleMembers(game, ability, options);
    case HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID:
      return startHsPb1012OnEnterRecycleMembers(game, ability, options);
    case N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID:
      return startDrawThenDiscardCardsEffect(game, {
        ability,
        effectText: getCardAbilityEffectText(N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID),
        drawCount: 1,
        discardCount: 1,
        stepId: N_BP4_018_SELECT_DISCARD_STEP_ID,
        orderedResolution: options.orderedResolution === true,
        recordAbilityUseOnStart: true,
      });
    case PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID:
      return resolvePb1015OwnEffectWaitOpponentLowCostDraw(game, ability, options);
    case HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID:
      return startDrawThenDiscardCardsEffect(game, {
        ability,
        effectText: getCardAbilityEffectText(HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID),
        drawCount: 2,
        discardCount: 1,
        stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
        orderedResolution: options.orderedResolution === true,
      });
    case HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID:
      return startDrawThenDiscardCardsEffect(game, {
        ability,
        effectText: getCardAbilityEffectText(HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID),
        drawCount: 1,
        discardCount: 1,
        stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
        orderedResolution: options.orderedResolution === true,
      });
    default:
      return game;
  }
}

function resolveHsPb1KahoOnHasunosoraEnterGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (options.manualConfirmation === true && options.skipManualConfirmation !== true) {
    return startConfirmOnlyPendingAbilityEffect(
      game,
      ability,
      getCardAbilityEffectText(HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID),
      options
    );
  }

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  state = recordAbilityUse(state, player.id, ability.abilityId, ability.sourceCardId);
  state = addLiveModifier(state, {
    kind: 'BLADE',
    playerId: player.id,
    countDelta: 2,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
  });

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'APPLY_BLADE_BONUS',
      bladeBonus: 2,
      sourceSlot: ability.sourceSlot,
    }),
    options.orderedResolution === true
  );
}

function startHsBp5KahoOnEnterMillGainBladeInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (options.manualConfirmation === true && options.skipManualConfirmation !== true) {
    return startConfirmOnlyPendingAbilityEffect(
      game,
      ability,
      getCardAbilityEffectText(HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID),
      options
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 4,
    reveal: true,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds } = inspection;

  const state: GameState = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getCardAbilityEffectText(HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID),
      stepId: HS_BP5_001_REVEAL_STEP_ID,
      stepText: '卡组顶4张已公开。确认后将这些牌放入休息室，并在其中有LIVE卡时获得[BLADE][BLADE]。',
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

function finishHsBp5KahoOnEnterMillGainBlade(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP5_001_REVEAL_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const hasLiveCard = hasCardIdsMatchingSelector(game, inspectedCardIds, typeIs(CardType.LIVE));
  const liveCardIds = hasLiveCard
    ? getCardIdsMatchingSelector(game, inspectedCardIds, typeIs(CardType.LIVE))
    : [];
  const bladeBonus = hasLiveCard ? 2 : 0;
  const moveResult = moveInspectedCardsToWaitingRoom(game, player.id, inspectedCardIds);
  if (!moveResult) {
    return game;
  }
  const stateAfterModifier =
    bladeBonus > 0
      ? addLiveModifier(moveResult.gameState, {
          kind: 'BLADE',
          playerId: player.id,
          countDelta: bladeBonus,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        })
      : moveResult.gameState;
  const state: GameState = {
    ...stateAfterModifier,
    inspectionContext:
      stateAfterModifier.inspectionZone.cardIds.length > 0
        ? stateAfterModifier.inspectionContext
        : null,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MILL_TOP_FOUR_GAIN_BLADE_IF_LIVE',
      milledCardIds: moveResult.movedCardIds,
      liveCardIds,
      bladeBonus,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsPb1KahoLiveStartDrawDiscard(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const effectiveBladeCount = getSourceEffectiveBladeCount(game, player.id, ability.sourceCardId);
  const hasEnoughBlade = sourceHasBladeAtLeast(game, player.id, ability.sourceCardId, 8);
  if (!hasEnoughBlade) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_CONDITION_NOT_MET',
        sourceSlot: ability.sourceSlot,
        effectiveBladeCount,
      }),
      options.orderedResolution === true
    );
  }

  const state = addAction(game, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'CONDITION_MET',
    sourceSlot: ability.sourceSlot,
    effectiveBladeCount,
  });

  return startDrawThenDiscardCardsEffect(state, {
    ability,
    effectText: `${getCardAbilityEffectText(HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID)}（当前${effectiveBladeCount}个）`,
    drawCount: 2,
    discardCount: 1,
    stepId: HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID,
    orderedResolution: options.orderedResolution === true,
  });
}

function startHsBp6GinkoWaitOpponentLowCostMember(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const targetSelection = createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getCardAbilityEffectText(HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID),
    stepId: HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于9的成员变为待机状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: opponent.id,
    selector: and(typeIs(CardType.MEMBER), costLte(9)),
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方舞台上费用小于等于9的成员',
    orderedResolution: options.orderedResolution === true,
    metadata: {
      sourceSlot: ability.sourceSlot,
    },
  });

  if (targetSelection.activeEffect === null) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_NO_TARGET',
        sourceSlot: ability.sourceSlot,
        targetPlayerId: opponent.id,
      }),
      options.orderedResolution === true
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: targetSelection.activeEffect,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_OPPONENT_MEMBER',
      sourceSlot: ability.sourceSlot,
      targetPlayerId: opponent.id,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function startSpBp4011TomariWaitOpponentLowBladeMember(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const targetSelection = createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getCardAbilityEffectText(SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID),
    stepId: SP_BP4_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名原本持有的 BLADE 数量小于等于3个的成员变为待机状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: opponent.id,
    selector: memberPrintedBladeLte(3),
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方舞台上原本 BLADE 小于等于3的成员',
    orderedResolution: options.orderedResolution === true,
    metadata: {
      sourceSlot: ability.sourceSlot,
    },
  });

  if (targetSelection.activeEffect === null) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_NO_TARGET',
        sourceSlot: ability.sourceSlot,
        targetPlayerId: opponent.id,
      }),
      options.orderedResolution === true
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: targetSelection.activeEffect,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_OPPONENT_LOW_BLADE_MEMBER',
      sourceSlot: ability.sourceSlot,
      targetPlayerId: opponent.id,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishHsBp6GinkoWaitOpponentLowCostMember(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    (effect.abilityId !== HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID &&
      effect.abilityId !== HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID &&
      effect.abilityId !== SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID)
  ) {
    return game;
  }
  if (!selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  if (!player || !targetMetadata) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!orientationChange) {
    return game;
  }

  const state = { ...orientationChange.gameState, activeEffect: null };
  const stateWithResolveAction = addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'WAIT_OPPONENT_MEMBER',
    sourceSlot: effect.metadata?.sourceSlot,
    targetPlayerId: targetMetadata.targetPlayerId,
    targetCardId: selectedCardId,
    previousOrientation: orientationChange.previousOrientation,
    nextOrientation: orientationChange.nextOrientation,
  });
  const stateWithMemberStateTriggers = enqueueTriggeredCardEffects(
    stateWithResolveAction,
    [TriggerCondition.ON_MEMBER_STATE_CHANGED],
    {
      memberStateChangedEvents: getNewMemberStateChangedEvents(game, orientationChange.gameState),
    }
  );
  return continuePendingCardEffects(
    stateWithMemberStateTriggers,
    isOrderedResolutionEffect(game)
  );
}

function startHsBp6GinkoLiveStartDiscardGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        effectText: getCardAbilityEffectText(HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID),
        playerId: player.id,
        stepId: HS_BP6_004_SELECT_DISCARD_STEP_ID,
        selectableCardIds: player.hand.cardIds,
        orderedResolution: options.orderedResolution === true,
        metadata: {
          sourceSlot: ability.sourceSlot,
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishHsBp6GinkoDiscardGainBlade(game: GameState, discardCardId: string): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const discardCard = getCardById(game, discardCardId);
  if (!player || !discardCard || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!stateAfterDiscard) {
    return game;
  }

  const discardedWasGinko = and(typeIs(CardType.MEMBER), cardNameIs('百生吟子'))(discardCard);
  const bladeBonus = discardedWasGinko ? 2 : 1;
  const stateAfterModifier = addLiveModifier(stateAfterDiscard, {
    kind: 'BLADE',
    playerId: player.id,
    countDelta: bladeBonus,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  });
  const state = { ...stateAfterModifier, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD_GAIN_BLADE',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: discardCardId,
      discardedWasGinko,
      bladeBonus,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHonokaOnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds =
    countSuccessfulLiveCards(game, player.id) >= 2
      ? selectWaitingRoomCardIds(game, player.id, typeIs(CardType.LIVE))
      : [];
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: getCardAbilityEffectText(HONOKA_ON_ENTER_ABILITY_ID),
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
  });
}

function startKotoriOnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = selectWaitingRoomCardIds(
    game,
    player.id,
    and(typeIs(CardType.MEMBER), costLte(4), groupIs("μ's"))
  );
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: getCardAbilityEffectText(KOTORI_ON_ENTER_ABILITY_ID),
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
  });
}

function startLLBp1OnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = selectWaitingRoomCardIds(game, player.id, typeIs(CardType.MEMBER));
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: getCardAbilityEffectText(LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID),
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
  });
}

function startHsBp2OnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = selectWaitingRoomCardIds(
    game,
    player.id,
    and(typeIs(CardType.MEMBER), costLte(2))
  );
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: getCardAbilityEffectText(HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID),
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
    zoneSelection: createWaitingRoomToHandSelectionConfig({
      minCount: 0,
      maxCount: 2,
      optional: true,
    }),
  });
}

function resolveBp5RinOnEnterSuccessScorePlaceActiveEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const successLiveScore = sumSuccessfulLiveScore(game, player.id);
  const conditionMet = successLiveScoreAtLeast(game, player.id, 6);
  const energyPlacement = conditionMet
    ? placeEnergyFromDeckToZone(game, player.id, 1, OrientationState.ACTIVE)
    : null;
  const state = {
    ...(energyPlacement?.gameState ?? game),
    pendingAbilities: (energyPlacement?.gameState ?? game).pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'PLACE_ACTIVE_ENERGY_IF_SUCCESS_LIVE_SCORE',
      successLiveScore,
      conditionMet,
      placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
    }),
    options.orderedResolution === true
  );
}

function startSpBp2KekeOnEnterLookHighCostCard(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  return startLookTopSelectToHandEffect(
    game,
    ability,
    {
      effectText: getCardAbilityEffectText(SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID),
      count: 3,
      predicate: costGte(11),
      selectStepId: SP_BP2_002_SELECT_HIGH_COST_CARD_STEP_ID,
      revealStepId: SP_BP2_002_REVEAL_SELECTED_STEP_ID,
      selectStepText: '请选择至多1张费用大于等于11的卡公开并加入手牌。也可以不加入。',
      noTargetStepText: '没有可加入手牌的费用大于等于11的卡。确认后其余卡片放置入休息室。',
      selectionLabel: '选择要公开并加入手牌的高费用卡',
      revealStepText: '选择的卡片已公开。确认后加入手牌，其余卡片放置入休息室。',
      revealActionStep: 'REVEAL_SELECTED_HIGH_COST_CARD',
    },
    options
  );
}

function startBp6002EliOnEnterLookNoAbilityOrContinuousMuseCard(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  return startLookTopSelectToHandEffect(
    game,
    ability,
    {
      effectText: getCardAbilityEffectText(
        BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID
      ),
      count: 2,
      predicate: isNoAbilityOrContinuousMuseCard,
      selectStepId: BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_STEP_ID,
      revealStepId: BP6_002_REVEAL_SELECTED_STEP_ID,
      selectStepText:
        "请选择至多1张不持有能力或持有【常时】能力的『μ's』卡公开并加入手牌。也可以不加入。",
      noTargetStepText:
        "没有可加入手牌的不持有能力或持有【常时】能力的『μ's』卡。确认后其余卡片放置入休息室。",
      selectionLabel: "选择要公开并加入手牌的『μ's』卡",
      revealStepText: '选择的卡片已公开。确认后加入手牌，其余卡片放置入休息室。',
      revealActionStep: 'REVEAL_SELECTED_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD',
    },
    options
  );
}

function startPr018NozomiOnEnterRecoverHighScoreLive(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = selectWaitingRoomCardIds(game, player.id, (card) => {
    const score = (card.data as { readonly score?: unknown }).score;
    return typeIs(CardType.LIVE)(card) && typeof score === 'number' && score >= 6;
  });
  const hasSelectableTarget = selectableCardIds.length > 0;
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: getCardAbilityEffectText(PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID),
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
    zoneSelection: createWaitingRoomToHandSelectionConfig({
      minCount: hasSelectableTarget ? 1 : 0,
      optional: !hasSelectableTarget,
    }),
    stepId: PR_018_SELECT_HIGH_SCORE_LIVE_STEP_ID,
    stepText: '请选择自己的休息室中1张分数大于等于6的LIVE卡加入手牌。',
  });
}

function isNoAbilityOrContinuousMuseCard(card: CardInstance): boolean {
  return and(groupIs("μ's"), hasNoAbilityOrContinuousAbility())(card);
}

interface LookTopSelectToHandConfig {
  readonly effectText: string;
  readonly count: number;
  readonly predicate: (card: CardInstance) => boolean;
  readonly selectStepId: string;
  readonly revealStepId: string;
  readonly selectStepText: string;
  readonly noTargetStepText: string;
  readonly selectionLabel: string;
  readonly revealStepText: string;
  readonly revealActionStep: string;
}

function startLookTopSelectToHandEffect(
  game: GameState,
  ability: PendingAbilityState,
  config: LookTopSelectToHandConfig,
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
      }),
      options.orderedResolution === true
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: config.count,
    selectablePredicate: config.predicate,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds, selectableCardIds } = inspection;

  return addAction(
    {
      ...gameState,
      pendingAbilities: gameState.pendingAbilities.filter(
        (candidate) => candidate.id !== ability.id
      ),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: config.effectText,
        stepId: config.selectStepId,
        stepText: selectableCardIds.length > 0 ? config.selectStepText : config.noTargetStepText,
        awaitingPlayerId: player.id,
        inspectionCardIds: inspectedCardIds,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: config.selectionLabel,
        confirmSelectionLabel: '公开并加入手牌',
        canSkipSelection: true,
        skipSelectionLabel: selectableCardIds.length > 0 ? '不加入' : '确认',
        metadata: {
          sourceZone: ZoneType.MAIN_DECK,
          orderedResolution: options.orderedResolution === true,
          revealStepId: config.revealStepId,
          revealStepText: config.revealStepText,
          revealActionStep: config.revealActionStep,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_INSPECTION',
      inspectedCardIds,
      selectableCardIds,
    }
  );
}

function startHsBp2KosuzuLeaveStageInspection(
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
      }),
      options.orderedResolution === true
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 5,
    selectablePredicate: (card) => isMemberCardData(card.data),
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds, selectableCardIds } = inspection;

  return addAction(
    {
      ...gameState,
      pendingAbilities: gameState.pendingAbilities.filter(
        (candidate) => candidate.id !== ability.id
      ),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID),
        stepId: HS_BP2_012_SELECT_MEMBER_STEP_ID,
        stepText:
          selectableCardIds.length > 0
            ? '请选择至多1张成员卡公开并加入手牌。也可以不加入。'
            : '没有可加入手牌的成员卡。确认后其余卡片放置入休息室。',
        awaitingPlayerId: player.id,
        inspectionCardIds: inspectedCardIds,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要公开并加入手牌的成员',
        confirmSelectionLabel: '公开并加入手牌',
        canSkipSelection: true,
        skipSelectionLabel: selectableCardIds.length > 0 ? '不加入' : '确认',
        metadata: {
          sourceZone: ZoneType.MAIN_DECK,
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_INSPECTION',
      inspectedCardIds,
      selectableCardIds,
    }
  );
}

function revealHsBp2KosuzuSelectedMember(game: GameState, selectedCardId: string): GameState {
  return revealSelectedInspectionCard(game, selectedCardId, {
    stepId: HS_BP2_012_REVEAL_SELECTED_STEP_ID,
    stepText: '选择的成员卡已公开。确认后加入手牌，其余卡片放置入休息室。',
    actionStep: 'REVEAL_SELECTED_MEMBER',
  });
}

function revealLookTopSelectedCard(game: GameState, selectedCardId: string): GameState {
  const effect = game.activeEffect;
  const revealStepId =
    typeof effect?.metadata?.revealStepId === 'string'
      ? effect.metadata.revealStepId
      : DISCARD_LOOK_REVEAL_SELECTED_STEP_ID;
  const revealStepText =
    typeof effect?.metadata?.revealStepText === 'string'
      ? effect.metadata.revealStepText
      : '选择的卡片已公开。确认后加入手牌，其余卡片放置入休息室。';
  const actionStep =
    typeof effect?.metadata?.revealActionStep === 'string'
      ? effect.metadata.revealActionStep
      : 'REVEAL_SELECTED';

  return revealSelectedInspectionCard(game, selectedCardId, {
    stepId: revealStepId,
    stepText: revealStepText,
    actionStep,
  });
}

function finishLookTopSelectToHandEffect(
  game: GameState,
  selectedCardId: string | null,
  predicate: (card: CardInstance) => boolean
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectedCard =
    selectedCardId !== null ? (game.cardRegistry.get(selectedCardId)?.data ?? null) : null;
  if (
    selectedCardId !== null &&
    (!inspectedCardIds.includes(selectedCardId) ||
      !selectedCard ||
      !predicate({ instanceId: selectedCardId, ownerId: player.id, data: selectedCard }))
  ) {
    return game;
  }

  const moveResult = moveInspectedSelectionToHandRestToWaitingRoom(
    game,
    player.id,
    inspectedCardIds,
    selectedCardId
  );
  if (!moveResult) {
    return game;
  }

  const state = { ...moveResult.gameState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: moveResult.selectedCardId,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function finishHsBp2KosuzuLeaveStageEffect(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectedCard =
    selectedCardId !== null ? (game.cardRegistry.get(selectedCardId)?.data ?? null) : null;
  if (
    selectedCardId !== null &&
    (!inspectedCardIds.includes(selectedCardId) || !selectedCard || !isMemberCardData(selectedCard))
  ) {
    return game;
  }

  const moveResult = moveInspectedSelectionToHandRestToWaitingRoom(
    game,
    player.id,
    inspectedCardIds,
    selectedCardId
  );
  if (!moveResult) {
    return game;
  }

  const state = { ...moveResult.gameState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: moveResult.selectedCardId,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsBp1TsuzuriLiveStartPayEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const liveZoneCardCount = player.liveZone.cardIds.length;
  const canPay = activeEnergyCardIds.length >= 1;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID),
        stepId: HS_BP1_004_LIVE_START_PAY_ENERGY_STEP_ID,
        stepText: canPay
          ? `可以支付1张活跃能量，获得${liveZoneCardCount}个BLADE。`
          : '当前没有可支付的活跃能量，可以不发动。',
        awaitingPlayerId: player.id,
        selectableOptions: canPay
          ? [
              { id: 'pay', label: '支付1能量' },
              { id: 'decline', label: '不发动' },
            ]
          : [{ id: 'decline', label: '不发动' }],
        metadata: {
          orderedResolution: options.orderedResolution === true,
          activeEnergyCardIds,
          liveZoneCardCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
      liveZoneCardCount,
    }
  );
}

function finishHsBp1TsuzuriLiveStartPayEnergy(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }

  const liveZoneCardCount =
    getPlayerById(costPayment.gameState, player.id)?.liveZone.cardIds.length ?? 0;
  const stateAfterCost = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const stateAfterModifier =
    liveZoneCardCount > 0
      ? addLiveModifier(stateAfterCost, {
          kind: 'BLADE',
          playerId: player.id,
          countDelta: liveZoneCardCount,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        })
      : stateAfterCost;
  const state = { ...stateAfterModifier, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_GAIN_BLADE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      bladeBonus: liveZoneCardCount,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsBp6KahoLeaveStageDiscard(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        effectText: getCardAbilityEffectText(HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID),
        playerId: player.id,
        stepId: HS_BP6_017_SELECT_DISCARD_STEP_ID,
        selectableCardIds: player.hand.cardIds,
        orderedResolution: options.orderedResolution === true,
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function startHsBp6KahoWaitingRoomSelectionAfterDiscard(
  game: GameState,
  discardCardId: string
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID ||
    !effect.selectableCardIds?.includes(discardCardId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!stateAfterDiscard) {
    return game;
  }
  const selectableCardIds = selectWaitingRoomCardIds(
    stateAfterDiscard,
    player.id,
    (card) => isLiveCardData(card.data) || isMemberCardData(card.data)
  );

  return addAction(
    {
      ...stateAfterDiscard,
      activeEffect: {
        ...effect,
        stepId: HS_BP6_017_SELECT_WAITING_ROOM_CARDS_STEP_ID,
        stepText: '请选择休息室中的 LIVE 卡和成员卡至多各1张加入手牌。也可以不选择。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(2, selectableCardIds.length),
        selectionLabel: '选择要加入手牌的 LIVE / 成员',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: true,
        skipSelectionLabel: '不加入',
        metadata: {
          ...effect.metadata,
          discardCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      discardCardId,
      selectableCardIds,
    }
  );
}

function finishHsBp6KahoRecoverCards(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > 2 ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        player.waitingRoom.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const selectedGroupCounts = countCardIdsMatchingSelectors(
    game,
    uniqueSelectedCardIds,
    [typeIs(CardType.LIVE), typeIs(CardType.MEMBER)]
  );
  const selectedLiveCount = selectedGroupCounts[0] ?? 0;
  const selectedMemberCount = selectedGroupCounts[1] ?? 0;
  if (
    selectedLiveCount > 1 ||
    selectedMemberCount > 1 ||
    selectedLiveCount + selectedMemberCount !== uniqueSelectedCardIds.length
  ) {
    return game;
  }

  const movedState = moveSelectedCardsFromZone(
    game,
    player.id,
    uniqueSelectedCardIds,
    createWaitingRoomToHandSelectionConfig({
      minCount: 0,
      maxCount: 2,
      optional: true,
    })
  );
  if (!movedState) {
    return game;
  }

  const state = { ...movedState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_LIVE_AND_MEMBER',
      selectedCardIds: uniqueSelectedCardIds,
      liveCardIds: uniqueSelectedCardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && isLiveCardData(card.data);
      }),
      memberCardIds: uniqueSelectedCardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && isMemberCardData(card.data);
      }),
    }),
    isOrderedResolutionEffect(game)
  );
}

function resolveHsSd1KahoRelayReplacedActivateEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const replacingCardId =
    typeof ability.metadata?.replacingCardId === 'string' ? ability.metadata.replacingCardId : null;
  if (!player || !replacingCardId) {
    return game;
  }
  if (options.manualConfirmation === true && options.skipManualConfirmation !== true) {
    return startConfirmOnlyPendingAbilityEffect(
      game,
      ability,
      getCardAbilityEffectText(HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID),
      options
    );
  }

  const replacingCard = getCardById(game, replacingCardId);
  if (
    !replacingCard ||
    !isMemberCardData(replacingCard.data) ||
    !isHasunosoraCard(replacingCard) ||
    !costGte(10)(replacingCard)
  ) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'CONDITION_NOT_MET',
        replacingCardId,
      }),
      options.orderedResolution === true
    );
  }

  const orientationChange = setFirstEnergyCardsOrientation(
    game,
    player.id,
    2,
    OrientationState.ACTIVE,
    { fromOrientation: OrientationState.WAITING }
  );
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    pendingAbilities: orientationChange.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ACTIVATE_TWO_ENERGY_AFTER_RELAY',
      replacingCardId,
      activatedEnergyCardIds: orientationChange.updatedEnergyCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    options.orderedResolution === true
  );
}

function startHsPb1GinkoDiscardTwoRecoverCeriseMemberAndHasunosoraLive(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingRoomLiveCount = countCardsInZoneMatching(
    game,
    player.id,
    ZoneType.WAITING_ROOM,
    typeIs(CardType.LIVE)
  );
  if (waitingRoomLiveCount < 3 || player.hand.cardIds.length < 2) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: waitingRoomLiveCount < 3 ? 'CONDITION_NOT_MET' : 'NOT_ENOUGH_HAND_TO_DISCARD',
        waitingRoomLiveCount,
        handCount: player.hand.cardIds.length,
      }),
      options.orderedResolution === true
    );
  }

  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 2,
    maxCount: 2,
    optional: true,
  };

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID),
        stepId: HS_PB1_020_SELECT_DISCARD_STEP_ID,
        stepText: '请选择2张手牌放置入休息室。也可以不发动。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 2,
        maxSelectableCards: 2,
        selectionLabel: '选择要放置入休息室的2张手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: true,
        skipSelectionLabel: DECLINE_OPTION_LABEL,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          waitingRoomLiveCount,
          effectCosts: [discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_TWO',
      waitingRoomLiveCount,
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function startHsPb1GinkoWaitingRoomSelectionAfterDiscardTwo(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID ||
    effect.stepId !== HS_PB1_020_SELECT_DISCARD_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== 2 ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const stateAfterDiscard = paySelectedDiscardHandCost(game, player.id, uniqueSelectedCardIds);
  if (!stateAfterDiscard) {
    return game;
  }

  const selectableCardIds = selectWaitingRoomCardIds(
    stateAfterDiscard.gameState,
    player.id,
    (card) => isCeriseBouquetMemberCard(card) || isHasunosoraLiveCard(card)
  );
  const hasCeriseMember = selectableCardIds.some((cardId) => {
    const card = getCardById(stateAfterDiscard.gameState, cardId);
    return card !== null && isCeriseBouquetMemberCard(card);
  });
  const hasHasunosoraLive = selectableCardIds.some((cardId) => {
    const card = getCardById(stateAfterDiscard.gameState, cardId);
    return card !== null && isHasunosoraLiveCard(card);
  });
  const requiredCount = (hasCeriseMember ? 1 : 0) + (hasHasunosoraLive ? 1 : 0);

  if (requiredCount === 0) {
    return continuePendingCardEffects(
      addAction(
        { ...stateAfterDiscard.gameState, activeEffect: null },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'DISCARD_TWO_NO_RECOVERY_TARGET',
          discardedHandCardIds: uniqueSelectedCardIds,
        }
      ),
      isOrderedResolutionEffect(game)
    );
  }

  return addAction(
    {
      ...stateAfterDiscard.gameState,
      activeEffect: {
        ...effect,
        stepId: HS_PB1_020_SELECT_WAITING_ROOM_CARDS_STEP_ID,
        stepText: '请选择休息室中的1张『Cerise Bouquet』成员卡和1张『莲之空』LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: requiredCount,
        maxSelectableCards: requiredCount,
        selectionLabel: '选择要加入手牌的 Cerise Bouquet 成员 / 莲之空 LIVE',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          discardedHandCardIds: uniqueSelectedCardIds,
          requiredRecoveryCount: requiredCount,
          hasCeriseMember,
          hasHasunosoraLive,
        },
      },
    },
    'PAY_COST',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      discardedHandCardIds: uniqueSelectedCardIds,
      selectableCardIds,
      requiredRecoveryCount: requiredCount,
    }
  );
}

function finishHsPb1GinkoRecoverCeriseMemberAndHasunosoraLive(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID ||
    effect.stepId !== HS_PB1_020_SELECT_WAITING_ROOM_CARDS_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const requiredCount =
    typeof effect.metadata?.requiredRecoveryCount === 'number'
      ? effect.metadata.requiredRecoveryCount
      : (effect.minSelectableCards ?? 0);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== requiredCount ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        player.waitingRoom.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const ceriseMemberCardIds: string[] = [];
  const hasunosoraLiveCardIds: string[] = [];
  const selectedGroupCounts = countCardIdsMatchingSelectors(game, uniqueSelectedCardIds, [
    isCeriseBouquetMemberCard,
    isHasunosoraLiveCard,
  ]);
  const selectedCeriseMemberCount = selectedGroupCounts[0] ?? 0;
  const selectedHasunosoraLiveCount = selectedGroupCounts[1] ?? 0;
  for (const cardId of uniqueSelectedCardIds) {
    const card = getCardById(game, cardId);
    if (!card) {
      return game;
    }
    if (isCeriseBouquetMemberCard(card)) {
      ceriseMemberCardIds.push(cardId);
    }
    if (isHasunosoraLiveCard(card)) {
      hasunosoraLiveCardIds.push(cardId);
    }
    if (!isCeriseBouquetMemberCard(card) && !isHasunosoraLiveCard(card)) {
      return game;
    }
  }
  if (
    selectedCeriseMemberCount > 1 ||
    selectedHasunosoraLiveCount > 1 ||
    (effect.metadata?.hasCeriseMember === true && selectedCeriseMemberCount !== 1) ||
    (effect.metadata?.hasHasunosoraLive === true && selectedHasunosoraLiveCount !== 1)
  ) {
    return game;
  }

  const movedState = moveSelectedCardsFromZone(
    game,
    player.id,
    uniqueSelectedCardIds,
    createWaitingRoomToHandSelectionConfig({
      minCount: requiredCount,
      maxCount: requiredCount,
      optional: false,
    })
  );
  if (!movedState) {
    return game;
  }

  const state = { ...movedState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE',
      selectedCardIds: uniqueSelectedCardIds,
      ceriseMemberCardIds,
      hasunosoraLiveCardIds,
      discardedHandCardIds: effect.metadata?.discardedHandCardIds ?? [],
    }),
    isOrderedResolutionEffect(game)
  );
}

function startBp6005RinDiscardTwoRecoverYellowHeartCards(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.hand.cardIds.length < 2) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_NOT_ENOUGH_HAND_TO_DISCARD',
      }),
      options.orderedResolution === true
    );
  }

  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 2,
    maxCount: 2,
    optional: true,
  };

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(
          BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID
        ),
        stepId: BP6_005_SELECT_DISCARD_STEP_ID,
        stepText: '可以将2张手牌放置入休息室。如此做的场合，从休息室按黄Heart条件至多各回收1张。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 2,
        maxSelectableCards: 2,
        selectionLabel: '选择要放置入休息室的2张手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: true,
        skipSelectionLabel: DECLINE_OPTION_LABEL,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          effectCosts: [discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_TWO',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function startBp6005RinWaitingRoomSelectionAfterDiscardTwo(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID ||
    effect.stepId !== BP6_005_SELECT_DISCARD_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== 2 ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const stateAfterDiscard = paySelectedDiscardHandCost(game, player.id, uniqueSelectedCardIds);
  if (!stateAfterDiscard) {
    return game;
  }

  const selectableCardIds = selectWaitingRoomCardIds(
    stateAfterDiscard.gameState,
    player.id,
    isYellowHeartMemberOrYellowRequirementLive
  );

  return addAction(
    {
      ...stateAfterDiscard.gameState,
      activeEffect: {
        ...effect,
        stepId: BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS_STEP_ID,
        stepText: '请选择休息室中至多1张持有黄Heart的成员，与至多1张必要Heart中含黄Heart的LIVE加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(2, selectableCardIds.length),
        selectionLabel: '选择要加入手牌的黄Heart成员 / 黄必要Heart LIVE',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: true,
        skipSelectionLabel: '不加入',
        metadata: {
          ...effect.metadata,
          discardedHandCardIds: uniqueSelectedCardIds,
        },
      },
    },
    'PAY_COST',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      discardedHandCardIds: uniqueSelectedCardIds,
      selectableCardIds,
    }
  );
}

function finishBp6005RinRecoverYellowHeartCards(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID ||
    effect.stepId !== BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > 2 ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        player.waitingRoom.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const yellowHeartMemberCardIds: string[] = [];
  const yellowRequirementLiveCardIds: string[] = [];
  const selectedGroupCounts = countCardIdsMatchingSelectors(game, uniqueSelectedCardIds, [
    yellowHeartMemberCard,
    yellowRequirementLiveCard,
  ]);
  const selectedYellowHeartMemberCount = selectedGroupCounts[0] ?? 0;
  const selectedYellowRequirementLiveCount = selectedGroupCounts[1] ?? 0;
  for (const cardId of uniqueSelectedCardIds) {
    const card = getCardById(game, cardId);
    if (!card || !isYellowHeartMemberOrYellowRequirementLive(card)) {
      return game;
    }
    if (yellowHeartMemberCard(card)) {
      yellowHeartMemberCardIds.push(cardId);
    }
    if (yellowRequirementLiveCard(card)) {
      yellowRequirementLiveCardIds.push(cardId);
    }
  }
  if (selectedYellowHeartMemberCount > 1 || selectedYellowRequirementLiveCount > 1) {
    return game;
  }

  const movedState = moveSelectedCardsFromZone(
    game,
    player.id,
    uniqueSelectedCardIds,
    createWaitingRoomToHandSelectionConfig({
      minCount: 0,
      maxCount: 2,
      optional: true,
    })
  );
  if (!movedState) {
    return game;
  }

  const state = { ...movedState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_YELLOW_HEART_MEMBER_AND_LIVE',
      selectedCardIds: uniqueSelectedCardIds,
      yellowHeartMemberCardIds,
      yellowRequirementLiveCardIds,
      discardedHandCardIds: effect.metadata?.discardedHandCardIds ?? [],
    }),
    isOrderedResolutionEffect(game)
  );
}

function isYellowHeartMemberOrYellowRequirementLive(card: CardInstance): boolean {
  return yellowHeartMemberCard(card) || yellowRequirementLiveCard(card);
}

function startWaitingRoomCardSelection(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  config: {
    readonly effectText: string;
    readonly selectableCardIds: readonly string[];
    readonly orderedResolution: boolean;
    readonly zoneSelection?: ReturnType<typeof createWaitingRoomToHandSelectionConfig>;
    readonly stepId?: string;
    readonly stepText?: string;
  }
): GameState {
  const zoneSelection = config.zoneSelection ?? createWaitingRoomToHandSelectionConfig();
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createWaitingRoomToHandEffectState({
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: config.effectText,
        stepId: config.stepId ?? SELECT_WAITING_ROOM_CARD_STEP_ID,
        stepText: config.stepText,
        awaitingPlayerId: playerId,
        selectableCardIds: config.selectableCardIds,
        metadata: {
          orderedResolution: config.orderedResolution,
        },
        zoneSelection,
      }),
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_WAITING_ROOM_CARD',
      selectableCardIds: config.selectableCardIds,
    }
  );
}

function startYoshikoOnEnterPlayLowCostMembers(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const emptySlots = getEmptyMemberSlots(player);
  const canPay = activeEnergyCardIds.length >= 4 && emptySlots.length > 0;
  const selectableOptions = canPay
    ? [
        { id: 'pay', label: '支付4能量' },
        { id: 'decline', label: DECLINE_OPTION_LABEL },
      ]
    : [{ id: 'decline', label: DECLINE_OPTION_LABEL }];

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID),
        stepId: YOSHIKO_PAY_COST_STEP_ID,
        stepText: canPay
          ? '可以支付4张活跃能量发动此效果。'
          : '当前无法支付4张活跃能量或没有空成员区，可以不发动。',
        awaitingPlayerId: player.id,
        selectableOptions,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          activeEnergyCardIds,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_OPTION',
      canPay,
      activeEnergyCardIds,
      emptySlots,
    }
  );
}

function startYoshikoWaitingRoomSelectionAfterCost(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 4 },
  ]);
  if (!costPayment) {
    return game;
  }

  const selectableCardIds = getCardIdsInZoneMatching(
    costPayment.gameState,
    player.id,
    ZoneType.WAITING_ROOM,
    costLte(4)
  );
  const emptySlots = getEmptyMemberSlots(player);
  const state = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: YOSHIKO_SELECT_WAITING_ROOM_MEMBERS_STEP_ID,
        stepText: '请选择至多2张费用合计小于等于4的成员卡。也可以不选择。',
        selectableCardIds,
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(2, selectableCardIds.length, emptySlots.length),
        canSkipSelection: true,
        selectableOptions: undefined,
        selectionLabel: '选择要从休息室登场的成员',
        confirmSelectionLabel: '确认选择',
        metadata: {
          ...effect.metadata,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
          selectableCardIds,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_COST_SELECT_WAITING_ROOM_MEMBERS',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
      emptySlots,
    }
  );
}

function startYoshikoSelectStageSlot(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const selectedAreValid =
    uniqueSelectedCardIds.length === selectedCardIds.length &&
    uniqueSelectedCardIds.length <= 2 &&
    uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        player.waitingRoom.cardIds.includes(cardId)
    ) &&
    calculateMemberCostSum(game, uniqueSelectedCardIds) <= 4;

  if (!selectedAreValid) {
    return game;
  }

  if (uniqueSelectedCardIds.length === 0) {
    const state = { ...game, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'FINISH_NO_SELECTION',
      }),
      isOrderedResolutionEffect(game)
    );
  }

  const nextCardId = uniqueSelectedCardIds[0];
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: YOSHIKO_SELECT_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的空成员区。',
        selectableCardIds: [nextCardId],
        selectableCardMode: 'SINGLE',
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectableSlots: getEmptyMemberSlots(player),
        selectionLabel: '选择登场槽位',
        confirmSelectionLabel: '登场',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedWaitingRoomCardIds: uniqueSelectedCardIds,
          nextWaitingRoomCardIndex: 0,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_STAGE_SLOT',
      selectedCardIds: uniqueSelectedCardIds,
      nextCardId,
    }
  );
}

function finishYoshikoSelectStageSlot(
  game: GameState,
  selectedSlot: SlotPosition | null
): GameState {
  const effect = game.activeEffect;
  if (!effect || selectedSlot === null) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !effect.selectableSlots?.includes(selectedSlot)) {
    return game;
  }

  const selectedWaitingRoomCardIds = Array.isArray(effect.metadata?.selectedWaitingRoomCardIds)
    ? effect.metadata.selectedWaitingRoomCardIds.filter(
        (cardId): cardId is string => typeof cardId === 'string'
      )
    : [];
  const currentIndex =
    typeof effect.metadata?.nextWaitingRoomCardIndex === 'number'
      ? effect.metadata.nextWaitingRoomCardIndex
      : 0;
  const cardId = selectedWaitingRoomCardIds[currentIndex];
  if (!cardId) {
    return game;
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(game, player.id, [
    { cardId, toSlot: selectedSlot },
  ]);
  if (!playResult) {
    return game;
  }

  const nextIndex = currentIndex + 1;
  const nextCardId = selectedWaitingRoomCardIds[nextIndex];
  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_MEMBER_FROM_WAITING_ROOM',
    playedCardId: cardId,
    toSlot: selectedSlot,
  });
  const stateWithOnEnter = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: getNewEnterStageEvents(game, state),
  });

  if (!nextCardId) {
    return continuePendingCardEffects(
      { ...stateWithOnEnter, activeEffect: null },
      isOrderedResolutionEffect(game)
    );
  }

  const nextPlayer = getPlayerById(stateWithOnEnter, player.id);
  if (!nextPlayer) {
    return game;
  }

  return {
    ...stateWithOnEnter,
    activeEffect: {
      ...effect,
      selectableCardIds: [nextCardId],
      selectableSlots: getEmptyMemberSlots(nextPlayer),
      metadata: {
        ...effect.metadata,
        selectedWaitingRoomCardIds,
        nextWaitingRoomCardIndex: nextIndex,
      },
    },
  };
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
  const movedState = moveSelectedCardsFromZone(
    game,
    player.id,
    uniqueSelectedCardIds,
    zoneSelection
  );
  if (!movedState) {
    return game;
  }
  let state = movedState;
  state = { ...state, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: uniqueSelectedCardIds[0] ?? null,
      selectedCardIds: uniqueSelectedCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function finishPr017NicoRecoverMuseLiveActivateEnergy(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const selectedCardIds = selectedCardId !== null ? [selectedCardId] : [];
  const zoneSelection = getZoneSelectionConfig(effect);
  if (
    selectedCardIds.length < zoneSelection.minCount ||
    selectedCardIds.length > zoneSelection.maxCount
  ) {
    return game;
  }
  const selectedAreValid = selectedCardIds.every(
    (cardId) =>
      effect.selectableCardIds?.includes(cardId) === true &&
      player.waitingRoom.cardIds.includes(cardId)
  );
  if (!selectedAreValid) {
    return game;
  }

  const movedState = moveSelectedCardsFromZone(game, player.id, selectedCardIds, zoneSelection);
  if (!movedState) {
    return game;
  }

  const successLiveScore = sumSuccessfulLiveScore(movedState, player.id);
  const conditionMet = successLiveScoreAtLeast(movedState, player.id, 9);
  const orientationChange = conditionMet
    ? setFirstEnergyCardsOrientation(movedState, player.id, 2, OrientationState.ACTIVE, {
        fromOrientation: OrientationState.WAITING,
      })
    : null;
  const stateAfterEnergy = orientationChange?.gameState ?? movedState;
  const state = { ...stateAfterEnergy, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_IF_SUCCESS_SCORE',
      selectedCardId: selectedCardIds[0] ?? null,
      selectedCardIds,
      successLiveScore,
      conditionMet,
      activatedEnergyCardIds: orientationChange?.updatedEnergyCardIds ?? [],
      previousOrientations: orientationChange?.previousOrientations ?? [],
      nextOrientation: orientationChange?.nextOrientation ?? OrientationState.ACTIVE,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startMakiOnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = getCardIdsInZoneMatching(
    game,
    player.id,
    ZoneType.HAND,
    typeIs(CardType.LIVE)
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
        effectText: getCardAbilityEffectText(MAKI_ON_ENTER_ABILITY_ID),
        stepId: MAKI_SELECT_HAND_LIVE_STEP_ID,
        stepText: getCardAbilityEffectText(MAKI_ON_ENTER_ABILITY_ID),
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        canSkipSelection: true,
        metadata: { orderedResolution: options.orderedResolution === true },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HAND_LIVE',
      selectableCardIds,
    }
  );
}

function startMakiSelectSuccessLive(game: GameState, handLiveCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || handLiveCardId === null || !effect.selectableCardIds?.includes(handLiveCardId)) {
    return finishSkipEffect(game);
  }
  const selectableSuccessLiveCardIds = getCardIdsInZoneMatching(
    game,
    player.id,
    ZoneType.SUCCESS_ZONE,
    typeIs(CardType.LIVE)
  );
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: MAKI_SELECT_SUCCESS_LIVE_STEP_ID,
        stepText: '请选择要加入手牌的成功 Live。所公开的手牌 Live 会放置入成功 Live 卡区。',
        selectableCardIds: selectableSuccessLiveCardIds,
        selectableCardVisibility: 'PUBLIC',
        canSkipSelection: true,
        metadata: {
          ...effect.metadata,
          handLiveCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_HAND_LIVE',
      handLiveCardId,
    }
  );
}

function finishMakiOnEnter(game: GameState, successLiveCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const handLiveCardId =
    typeof effect.metadata?.handLiveCardId === 'string' ? effect.metadata.handLiveCardId : null;
  if (
    !player ||
    handLiveCardId === null ||
    successLiveCardId === null ||
    !effect.selectableCardIds?.includes(successLiveCardId)
  ) {
    return finishSkipEffect(game);
  }
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: {
      ...currentPlayer.hand,
      cardIds: [
        ...currentPlayer.hand.cardIds.filter((cardId) => cardId !== handLiveCardId),
        successLiveCardId,
      ],
    },
    successZone: {
      ...currentPlayer.successZone,
      cardIds: [
        ...currentPlayer.successZone.cardIds.filter((cardId) => cardId !== successLiveCardId),
        handLiveCardId,
      ],
    },
  }));
  state = { ...state, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      handLiveCardId,
      successLiveCardId,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startNicoLiveStartScoreBonus(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const effectText = formatNicoEffectText(game, player.id);

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText,
        stepId: NICO_SCORE_BONUS_STEP_ID,
        stepText: effectText,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
    }
  );
}

function finishNicoLiveStartScoreBonus(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingRoomCardIds = getCardIdsInZone(game, player.id, ZoneType.WAITING_ROOM);
  const museWaitingRoomCount = countCardsMatchingSelector(game, waitingRoomCardIds, groupIs("μ's"));
  const isConditionMet = hasAtLeastCardsMatchingSelector(game, waitingRoomCardIds, groupIs("μ's"), 25);
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (isConditionMet) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      countDelta: 1,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_SCORE_BONUS',
      effectText: getCardAbilityEffectText(NICO_LIVE_START_SCORE_ABILITY_ID),
      conditionMet: isConditionMet,
      museWaitingRoomCount,
      scoreBonus: isConditionMet ? 1 : 0,
    }),
    isOrderedResolutionEffect(game)
  );
}

function formatNicoEffectText(game: GameState, playerId: string): string {
  return `${getCardAbilityEffectText(NICO_LIVE_START_SCORE_ABILITY_ID)}（当前${countCardsMatchingSelector(
    game,
    getCardIdsInZone(game, playerId, ZoneType.WAITING_ROOM),
    groupIs("μ's")
  )}张）`;
}

function startBokuimaLiveStartRequirementReduction(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const successLiveCount = countSuccessfulLiveCards(game, player.id);
  const reduction = successLiveCount * 2;
  const effectText = `${getCardAbilityEffectText(BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID)}（当前成功LIVE ${successLiveCount}张，减少${reduction}个無Heart）`;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText,
        stepId: BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID,
        stepText: effectText,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      successLiveCount,
      requirementReduction: reduction,
    }
  );
}

function finishBokuimaLiveStartRequirementReduction(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const successLiveCount = countSuccessfulLiveCards(game, player.id);
  const reduction = successLiveCount * 2;
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (reduction > 0) {
    const modifier = {
      kind: 'REQUIREMENT' as const,
      liveCardId: effect.sourceCardId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -reduction }],
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    };
    state = replaceLiveModifier(
      state,
      {
        kind: 'REQUIREMENT',
        liveCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
      },
      modifier
    );
  } else {
    state = replaceLiveModifier(
      state,
      {
        kind: 'REQUIREMENT',
        liveCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
      },
      null
    );
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_REQUIREMENT_REDUCTION',
      successLiveCount,
      requirementReduction: reduction,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsBp5HanamusubiLiveStartRequirementReduction(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const otherHasunosoraLiveZoneCount = countOtherLiveZoneCardsMatching(
    game,
    player.id,
    ability.sourceCardId,
    isHasunosoraCard
  );
  const reduction = otherHasunosoraLiveZoneCount * 2;
  const effectText = `${getCardAbilityEffectText(HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID)}（当前此卡以外莲之空卡 ${otherHasunosoraLiveZoneCount}张，减少${reduction}个绿Heart）`;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText,
        stepId: HS_BP5_019_REQUIREMENT_REDUCTION_STEP_ID,
        stepText: effectText,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      otherHasunosoraLiveZoneCount,
      requirementReduction: reduction,
    }
  );
}

function finishHsBp5HanamusubiLiveStartRequirementReduction(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const otherHasunosoraLiveZoneCount = countOtherLiveZoneCardsMatching(
    game,
    player.id,
    effect.sourceCardId,
    isHasunosoraCard
  );
  const reduction = otherHasunosoraLiveZoneCount * 2;
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (reduction > 0) {
    state = replaceLiveModifier(
      state,
      {
        kind: 'REQUIREMENT',
        liveCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
      },
      {
        kind: 'REQUIREMENT',
        liveCardId: effect.sourceCardId,
        modifiers: [{ color: HeartColor.GREEN, countDelta: -reduction }],
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
      }
    );
  } else {
    state = replaceLiveModifier(
      state,
      {
        kind: 'REQUIREMENT',
        liveCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
      },
      null
    );
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_REQUIREMENT_REDUCTION',
      otherHasunosoraLiveZoneCount,
      requirementReduction: reduction,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsBp2AokuharukaLiveStartScoreBonus(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const ceriseBouquetLiveCount = countCardsMatchingSelector(
    game,
    getCardIdsInZone(game, player.id, ZoneType.WAITING_ROOM),
    and(typeIs(CardType.LIVE), unitAliasIs('Cerise Bouquet'))
  );
  const isConditionMet = ceriseBouquetLiveCount >= 3;
  const effectText = `${getCardAbilityEffectText(HS_BP2_022_LIVE_START_SCORE_ABILITY_ID)}（当前${ceriseBouquetLiveCount}张，${
    isConditionMet ? '满足条件' : '未满足条件'
  }）`;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText,
        stepId: HS_BP2_022_SCORE_BONUS_STEP_ID,
        stepText: effectText,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      ceriseBouquetLiveCount,
      scoreBonus: isConditionMet ? 1 : 0,
    }
  );
}

function finishHsBp2AokuharukaLiveStartScoreBonus(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const ceriseBouquetLiveCount = countCardsMatchingSelector(
    game,
    getCardIdsInZone(game, player.id, ZoneType.WAITING_ROOM),
    and(typeIs(CardType.LIVE), unitAliasIs('Cerise Bouquet'))
  );
  const isConditionMet = ceriseBouquetLiveCount >= 3;
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (isConditionMet) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      countDelta: 1,
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_SCORE_BONUS',
      effectText: getCardAbilityEffectText(HS_BP2_022_LIVE_START_SCORE_ABILITY_ID),
      conditionMet: isConditionMet,
      ceriseBouquetLiveCount,
      scoreBonus: isConditionMet ? 1 : 0,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startBp4021HeartbeatLiveStartSuccessScoreModifier(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const successLiveScore = sumSuccessfulLiveScore(game, player.id);
  const reducesRequirement = successLiveScoreAtLeast(game, player.id, 6);
  const gainsScore = successLiveScoreAtLeast(game, player.id, 9);
  const effectText = `${getCardAbilityEffectText(
    BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID
  )}（当前成功LIVE分数合计 ${successLiveScore}，${
    reducesRequirement ? '减少必要無Heart' : '未减少必要Heart'
  }，${gainsScore ? '分数+1' : '未获得分数+1'}）`;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText,
        stepId: BP4_021_SUCCESS_SCORE_MODIFIER_STEP_ID,
        stepText: effectText,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      successLiveScore,
      requirementReduction: reducesRequirement ? 1 : 0,
      scoreBonus: gainsScore ? 1 : 0,
    }
  );
}

function finishBp4021HeartbeatLiveStartSuccessScoreModifier(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const successLiveScore = sumSuccessfulLiveScore(game, player.id);
  const reducesRequirement = successLiveScoreAtLeast(game, player.id, 6);
  const gainsScore = successLiveScoreAtLeast(game, player.id, 9);
  let state: GameState = {
    ...game,
    activeEffect: null,
  };

  state = replaceLiveModifier(
    state,
    {
      kind: 'REQUIREMENT',
      liveCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    },
    reducesRequirement
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  state = replaceLiveModifier(
    state,
    {
      kind: 'SCORE',
      liveCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    },
    gainsScore
      ? {
          kind: 'SCORE',
          playerId: player.id,
          countDelta: 1,
          liveCardId: effect.sourceCardId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_SUCCESS_SCORE_MODIFIERS',
      successLiveScore,
      requirementReduction: reducesRequirement ? 1 : 0,
      scoreBonus: gainsScore ? 1 : 0,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsSd1HimeOnEnterActivateEnergyRecoverLive(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const relatedMemberSelector = or(
    cardNameAliasIs('大沢瑠璃乃'),
    cardNameAliasIs('百生吟子'),
    cardNameAliasIs('徒町小鈴')
  );
  const hasRelatedMember = hasStageMemberMatching(game, player.id, relatedMemberSelector, {
    excludeCardId: ability.sourceCardId,
  });

  if (!hasRelatedMember) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'CONDITION_NOT_MET',
      }),
      options.orderedResolution === true
    );
  }

  const relatedMemberCardIds = getStageMemberCardIdsMatching(
    game,
    player.id,
    relatedMemberSelector
  ).filter((cardId) => cardId !== ability.sourceCardId);

  const orientationChange = setFirstEnergyCardsOrientation(
    game,
    player.id,
    1,
    OrientationState.ACTIVE,
    { fromOrientation: OrientationState.WAITING }
  );
  if (!orientationChange) {
    return game;
  }

  let state = addAction(orientationChange.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'ACTIVATE_ENERGY',
    relatedMemberCardIds,
    activatedEnergyCardIds: orientationChange.updatedEnergyCardIds,
    previousOrientations: orientationChange.previousOrientations,
    nextOrientation: orientationChange.nextOrientation,
  });
  state = {
    ...state,
    pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  const selectableCardIds = selectWaitingRoomCardIds(
    state,
    player.id,
    isHasunosoraLiveCard
  );

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_WAITING_ROOM_LIVE_TARGET',
        relatedMemberCardIds,
      }),
      options.orderedResolution === true
    );
  }

  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: 1,
    maxCount: 1,
    optional: false,
  });

  return addAction(
    {
      ...state,
      activeEffect: createWaitingRoomToHandEffectState({
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID),
        stepId: HS_SD1_006_SELECT_WAITING_ROOM_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张『莲之空』的LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        canSkipSelection: false,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          relatedMemberCardIds,
          activatedEnergyCardIds: orientationChange.updatedEnergyCardIds,
        },
        zoneSelection,
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_WAITING_ROOM_LIVE',
      relatedMemberCardIds,
      selectableCardIds,
    }
  );
}

function startHsSd1HimeLiveStartPayEnergyGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  return startLiveStartPayEnergyGainFixedBlade(game, ability, {
    ...options,
    effectText: getCardAbilityEffectText(HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID),
    stepId: HS_SD1_006_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 1,
    bladeBonus: 2,
  });
}

function startLiveStartPayEnergyGainFixedBlade(
  game: GameState,
  ability: PendingAbilityState,
  config: {
    readonly effectText: string;
    readonly stepId: string;
    readonly energyCostCount: number;
    readonly bladeBonus: number;
    readonly orderedResolution?: boolean;
  }
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const canPay = activeEnergyCardIds.length >= config.energyCostCount;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: config.effectText,
        stepId: config.stepId,
        stepText: canPay
          ? `可以支付${config.energyCostCount}张活跃能量，获得${config.bladeBonus}个BLADE。`
          : '当前没有可支付的活跃能量，可以不发动。',
        awaitingPlayerId: player.id,
        selectableOptions: canPay
          ? [
              { id: 'pay', label: `支付${config.energyCostCount}能量` },
              { id: 'decline', label: DECLINE_OPTION_LABEL },
            ]
          : [{ id: 'decline', label: DECLINE_OPTION_LABEL }],
        metadata: {
          orderedResolution: config.orderedResolution === true,
          activeEnergyCardIds,
          energyCostCount: config.energyCostCount,
          bladeBonus: config.bladeBonus,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
      bladeBonus: config.bladeBonus,
    }
  );
}

function finishLiveStartPayEnergyGainFixedBlade(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    {
      kind: 'TAP_ACTIVE_ENERGY',
      count:
        typeof effect.metadata?.energyCostCount === 'number' ? effect.metadata.energyCostCount : 1,
    },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const stateAfterModifier = addLiveModifier(stateAfterCost, {
    kind: 'BLADE',
    playerId: player.id,
    countDelta: typeof effect.metadata?.bladeBonus === 'number' ? effect.metadata.bladeBonus : 2,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  });
  const state = { ...stateAfterModifier, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_GAIN_BLADE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      bladeBonus: typeof effect.metadata?.bladeBonus === 'number' ? effect.metadata.bladeBonus : 2,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsBp5IzumiOnEnterWaitDiscardLookTop(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, ability.sourceCardId);
  const sourceState = player.memberSlots.cardStates.get(ability.sourceCardId);
  const canWaitSource =
    sourceSlot !== null && sourceState?.orientation !== OrientationState.WAITING;
  const selectableCardIds = canWaitSource ? [...player.hand.cardIds] : [];
  const sourceWaitCost: EffectCostDefinition = {
    kind: 'SET_SOURCE_MEMBER_ORIENTATION',
    orientation: OrientationState.WAITING,
  };
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: true,
  };

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID),
        stepId: DISCARD_LOOK_SELECT_DISCARD_STEP_ID,
        stepText: DISCARD_HAND_TO_ACTIVATE_STEP_TEXT,
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL,
        canSkipSelection: true,
        skipSelectionLabel: DECLINE_OPTION_LABEL,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          topCount: 5,
          memberOnly: true,
          selectionRequired: false,
          revealSelectedBeforeHand: true,
          sourceSlot,
          effectCosts: [sourceWaitCost, discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
      sourceSlot,
    }
  );
}

function startHsBp5IzumiOnEnterInspection(game: GameState, discardCardId: string): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID ||
    !effect.selectableCardIds?.includes(discardCardId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const sourceWaitPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
  ]);
  if (!sourceWaitPayment) {
    return game;
  }
  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(
    sourceWaitPayment.gameState,
    player.id,
    discardCardId
  );
  if (!stateAfterDiscard) {
    return game;
  }

  const stateAfterCost = addAction(stateAfterDiscard, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: sourceWaitPayment.sourceSlot,
    orientedMemberCardIds: sourceWaitPayment.orientedMemberCardIds,
    discardedHandCardIds: [discardCardId],
  });
  const selector = and(typeIs(CardType.MEMBER), costGte(9), isHasunosoraCard);
  const inspection = inspectTopCards(stateAfterCost, player.id, {
    count: 5,
    selectablePredicate: selector,
  });
  if (!inspection) {
    return game;
  }

  const { gameState: state, inspectedCardIds, selectableCardIds } = inspection;
  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: DISCARD_LOOK_SELECT_TAKE_STEP_ID,
        stepText: '请选择其中1张费用大于等于9的『莲之空』成员卡公开并加入手牌，其余放置入休息室。',
        inspectionCardIds: inspectedCardIds,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '请选择要公开并加入手牌的成员卡',
        canSkipSelection: true,
        skipSelectionLabel: '不加入',
        metadata: {
          ...effect.metadata,
          discardCardId,
          memberOnly: true,
          selectionRequired: false,
          revealSelectedBeforeHand: true,
          sourceSlot: sourceWaitPayment.sourceSlot,
          orientedMemberCardIds: sourceWaitPayment.orientedMemberCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_INSPECTION',
      discardCardId,
      inspectedCardIds,
      selectableCardIds,
    }
  );
}

function startHsPb1GinkoPayEnergyDiscardMillRecoverCeriseLive(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const canPay = activeEnergyCardIds.length >= 1 && player.hand.cardIds.length > 0;
  const energyCost: EffectCostDefinition = { kind: 'TAP_ACTIVE_ENERGY', count: 1 };
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: true,
  };

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID),
        stepId: HS_PB1_004_SELECT_DISCARD_STEP_ID,
        stepText: canPay
          ? '可以支付1张活跃能量并将1张手牌放置入休息室。也可以选择不发动此效果。'
          : '当前无法同时支付1张活跃能量并弃1张手牌，可以不发动。',
        awaitingPlayerId: player.id,
        selectableCardIds: canPay ? player.hand.cardIds : [],
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL,
        canSkipSelection: true,
        skipSelectionLabel: DECLINE_OPTION_LABEL,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          topCount: 3,
          effectCosts: [energyCost, discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
          activeEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_SELECT_DISCARD',
      selectableCardIds: canPay ? player.hand.cardIds : [],
      activeEnergyCardIds,
    }
  );
}

function finishHsPb1GinkoPayEnergyDiscardMillRecoverCeriseLive(
  game: GameState,
  discardCardId: string
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID ||
    effect.stepId !== HS_PB1_004_SELECT_DISCARD_STEP_ID ||
    !effect.selectableCardIds?.includes(discardCardId)
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const energyPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!energyPayment) {
    return game;
  }

  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(
    energyPayment.gameState,
    player.id,
    discardCardId
  );
  if (!stateAfterDiscard) {
    return game;
  }

  const stateAfterCost = addAction(stateAfterDiscard, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: energyPayment.paidEnergyCardIds,
    amount: energyPayment.paidEnergyCardIds.length,
    discardedHandCardIds: [discardCardId],
  });

  const millResult = moveTopDeckCardsToWaitingRoom(stateAfterCost, player.id, 3);
  if (!millResult) {
    return game;
  }

  let state = addAction(millResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'MILL_TOP_THREE',
    milledCardIds: millResult.movedCardIds,
  });
  const selectableCardIds = selectWaitingRoomCardIds(
    state,
    player.id,
    and(typeIs(CardType.LIVE), unitAliasIs('Cerise Bouquet'))
  );

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_CERISE_LIVE_TARGET',
        milledCardIds: millResult.movedCardIds,
      }),
      isOrderedResolutionEffect(game)
    );
  }

  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: 1,
    maxCount: 1,
    optional: false,
  });

  state = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      effectText: getCardAbilityEffectText(HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID),
      stepId: HS_PB1_004_SELECT_CERISE_LIVE_STEP_ID,
      stepText: '请选择自己的休息室中1张『Cerise Bouquet』的LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        orderedResolution: isOrderedResolutionEffect(game),
        paidEnergyCardIds: energyPayment.paidEnergyCardIds,
        discardCardId,
        milledCardIds: millResult.movedCardIds,
      },
      zoneSelection,
    }),
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'SELECT_CERISE_LIVE',
    selectableCardIds,
  });
}

function startHsPr019GinkoMillGainGreenHeartInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 3,
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
      effectText: getCardAbilityEffectText(HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID),
      stepId: HS_PR_019_REVEAL_STEP_ID,
      stepText:
        '卡组顶3张已公开。确认后将这些牌放入休息室，并在均为持有绿色Heart的成员时获得绿色Heart。',
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

function finishHsPr019GinkoMillGainGreenHeart(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID ||
    effect.stepId !== HS_PR_019_REVEAL_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const conditionMet =
    inspectedCardIds.length === 3 &&
    allCardIdsMatchingSelector(game, inspectedCardIds, greenHeartMemberCard);

  const moveResult = moveInspectedCardsToWaitingRoom(game, player.id, inspectedCardIds);
  if (!moveResult) {
    return game;
  }

  let state: GameState = {
    ...moveResult.gameState,
    inspectionContext:
      moveResult.gameState.inspectionZone.cardIds.length > 0
        ? moveResult.gameState.inspectionContext
        : null,
    activeEffect: null,
  };

  if (conditionMet) {
    state = addLiveModifier(state, {
      kind: 'HEART',
      playerId: player.id,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_MILL_TOP_THREE_CHECK_GREEN_HEART_MEMBERS',
      milledCardIds: moveResult.movedCardIds,
      conditionMet,
      heartBonus: conditionMet ? [{ color: HeartColor.GREEN, count: 1 }] : [],
    }),
    isOrderedResolutionEffect(game)
  );
}

const greenHeartMemberCard = memberHasHeartColor(HeartColor.GREEN);
const yellowHeartMemberCard = memberHasHeartColor(HeartColor.YELLOW);
const yellowRequirementLiveCard = liveRequiresHeartColor(HeartColor.YELLOW);
const museLiveCard = and(typeIs(CardType.LIVE), groupAliasIs("μ's"));
const liellaMemberCard = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'));

function startNozomiOnEnterInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 5,
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
      effectText: getCardAbilityEffectText(NOZOMI_ON_ENTER_ABILITY_ID),
      stepId: NOZOMI_REVEAL_STEP_ID,
      stepText: '卡组顶5张已公开。确认后将这些牌放入休息室，并在其中有LIVE卡时抽1张。',
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

function startUmiOnEnterInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 5,
    selectablePredicate: museLiveCard,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds, selectableCardIds } = inspection;

  const state: GameState = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getCardAbilityEffectText(UMI_ON_ENTER_ABILITY_ID),
      stepId: UMI_SELECT_STEP_ID,
      stepText: getCardAbilityEffectText(UMI_ON_ENTER_ABILITY_ID),
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: true,
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
    selectableCardIds,
  });
}

function startGenericDiscardLookTopEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  if (!player || !sourceCard) {
    return game;
  }
  const selectableCardIds = player.hand.cardIds.filter((cardId) => cardId !== ability.sourceCardId);
  const cardCode = sourceCard.data.cardCode;
  const topCount = getDiscardLookTopCount(cardCode);
  const selectableCardType = getDiscardLookTopSelectableCardType(cardCode);
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        playerId: player.id,
        effectText: getDiscardLookTopEffectText(cardCode),
        stepId: DISCARD_LOOK_SELECT_DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution: options.orderedResolution === true,
        metadata: {
          topCount,
          memberOnly: selectableCardType === 'MEMBER',
          liveOnly: selectableCardType === 'LIVE',
          selectionRequired: isDiscardLookTopSelectionRequired(cardCode),
          revealSelectedBeforeHand:
            cardCodeMatchesBase(cardCode, 'PL!-sd1-015') ||
            cardCodeMatchesBase(cardCode, 'PL!-bp3-010'),
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    }
  );
}

function startDiscardLookTopInspection(game: GameState, discardCardId: string): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(discardCardId)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }
  const topCount = typeof effect.metadata?.topCount === 'number' ? effect.metadata.topCount : 3;
  const memberOnly = effect.metadata?.memberOnly === true;
  const liveOnly = effect.metadata?.liveOnly === true;
  const selectionRequired = effect.metadata?.selectionRequired === true;
  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!stateAfterDiscard) {
    return game;
  }
  const inspection = inspectTopCards(stateAfterDiscard, player.id, {
    count: topCount,
    selectablePredicate: liveOnly
      ? (card) => isLiveCardData(card.data)
      : memberOnly
        ? (card) => isMemberCardData(card.data)
        : undefined,
  });
  if (!inspection) {
    return game;
  }
  const { gameState: state, inspectedCardIds, selectableCardIds } = inspection;
  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: DISCARD_LOOK_SELECT_TAKE_STEP_ID,
        stepText: liveOnly
          ? '请选择其中1张LIVE卡加入手牌，其余放置入休息室。'
          : memberOnly
            ? '请选择其中1张成员卡加入手牌，其余放置入休息室。'
            : '请选择其中1张卡加入手牌，其余放置入休息室。',
        inspectionCardIds: inspectedCardIds,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: selectionRequired
          ? '请选择要加入手牌的卡牌'
          : liveOnly
            ? '请选择要加入手牌的LIVE卡'
            : '请选择要加入手牌的成员卡',
        canSkipSelection: !selectionRequired,
        skipSelectionLabel: !selectionRequired ? '不加入' : undefined,
        metadata: {
          ...effect.metadata,
          discardCardId,
          selectionRequired,
          revealSelectedBeforeHand:
            effect.metadata?.revealSelectedBeforeHand === true &&
            (memberOnly === true || liveOnly === true),
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_INSPECTION',
      discardCardId,
      inspectedCardIds,
      selectableCardIds,
    }
  );
}

function finishDiscardLookTopEffect(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectedWasRevealed =
    effect.stepId === DISCARD_LOOK_REVEAL_SELECTED_STEP_ID &&
    typeof effect.metadata?.selectedCardId === 'string' &&
    effect.metadata.selectedCardId === selectedCardId;
  const selectedIsValid =
    selectedCardId !== null &&
    inspectedCardIds.includes(selectedCardId) &&
    (effect.selectableCardIds?.includes(selectedCardId) === true || selectedWasRevealed);
  const selectionRequired = effect.metadata?.selectionRequired === true;
  if (selectionRequired && !selectedIsValid && (effect.selectableCardIds?.length ?? 0) > 0) {
    return game;
  }
  const cardToHandId = selectedIsValid ? selectedCardId : null;
  const moveResult = moveInspectedSelectionToHandRestToWaitingRoom(
    game,
    player.id,
    inspectedCardIds,
    cardToHandId
  );
  if (!moveResult) {
    return game;
  }
  const state = { ...moveResult.gameState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: moveResult.selectedCardId,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function revealDiscardLookTopSelectedCard(game: GameState, selectedCardId: string): GameState {
  return revealSelectedInspectionCard(game, selectedCardId, {
    stepId: DISCARD_LOOK_REVEAL_SELECTED_STEP_ID,
    stepText:
      game.activeEffect?.effectText ?? '选择的卡片已公开。确认后加入手牌，其余的卡片放置入休息室。',
    actionStep: 'REVEAL_SELECTED',
  });
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

function startStartDashLiveSuccessEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  return startArrangeInspectedDeckTopEffect(game, {
    ability,
    playerId: ability.controllerId,
    effectText: getCardAbilityEffectText(START_DASH_LIVE_SUCCESS_ABILITY_ID),
    inspectCount: 3,
    stepId: START_DASH_ARRANGE_STEP_ID,
    stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 3,
    selectedDestination: 'MAIN_DECK_TOP',
    unselectedDestination: 'WAITING_ROOM',
    orderedResolution: options.orderedResolution === true,
  });
}

function startHsBp6KahoOnEnterLookStagePlusTwo(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stageMemberCount = countStageMembers(game, player.id);
  return startArrangeInspectedDeckTopEffect(game, {
    ability,
    playerId: player.id,
    effectText: getCardAbilityEffectText(HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID),
    inspectCount: stageMemberCount + 2,
    stepId: HS_BP6_001_ARRANGE_STEP_ID,
    stepText: '请选择1张放回卡组顶。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '选择1张放回卡组顶',
    selectMin: 1,
    selectMax: 1,
    selectedDestination: 'MAIN_DECK_TOP',
    unselectedDestination: 'WAITING_ROOM',
    orderedResolution: options.orderedResolution === true,
  });
}

function startPlBp3OnEnterLookTopTwoArrangeToTop(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return {
    ...game,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getCardAbilityEffectText(PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID),
      stepId: PL_BP3_014_ON_ENTER_OPTION_STEP_ID,
      stepText: '可以将此成员变为待机状态：检视卡组顶2张并调整卡组顶。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: 'activate', label: '发动' },
        { id: 'decline', label: DECLINE_OPTION_LABEL },
      ],
      metadata: {
        orderedResolution: options.orderedResolution === true,
      },
    },
  };
}

function finishPlBp3OnEnterLookTopTwoDecline(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID ||
    effect.stepId !== PL_BP3_014_ON_ENTER_OPTION_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== effect.id),
    activeEffect: null,
  };
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

function finishPlBp3OnEnterLookTopTwoActivate(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID ||
    effect.stepId !== PL_BP3_014_ON_ENTER_OPTION_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const pendingAbility = game.pendingAbilities.find(
    (ability) =>
      ability.id === effect.id &&
      ability.abilityId === effect.abilityId &&
      ability.sourceCardId === effect.sourceCardId
  );
  if (!player || !pendingAbility) {
    return game;
  }

  const sourceWaitPayment = payImmediateEffectCosts(game, player.id, pendingAbility.sourceCardId, [
    { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
  ]);
  if (!sourceWaitPayment) {
    return game;
  }

  const stateAfterCost = addAction(sourceWaitPayment.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: pendingAbility.id,
    abilityId: pendingAbility.abilityId,
    sourceCardId: pendingAbility.sourceCardId,
    sourceSlot: sourceWaitPayment.sourceSlot,
    orientedMemberCardIds: sourceWaitPayment.orientedMemberCardIds,
  });

  return startArrangeInspectedDeckTopEffect({ ...stateAfterCost, activeEffect: null }, {
    ability: pendingAbility,
    playerId: player.id,
    effectText: getCardAbilityEffectText(PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID),
    inspectCount: 2,
    stepId: PL_BP3_014_ON_ENTER_ARRANGE_STEP_ID,
    stepText: '请检视卡组顶2张。选择任意张数的卡牌按顺序放置于卡组顶，其余的卡牌放入休息室。',
    selectionLabel: '选择要放回卡组顶的卡牌',
    selectMin: 0,
    selectMax: 2,
    selectedDestination: 'MAIN_DECK_TOP',
    unselectedDestination: 'WAITING_ROOM',
    orderedResolution: effect.metadata?.orderedResolution === true,
  });
}

function startHsBp6KahoLiveSuccessCheerToTop(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  return startRevealedCheerCardSelection(game, {
    ability,
    playerId: ability.controllerId,
    effectText: getCardAbilityEffectText(HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID),
    stepId: HS_BP6_001_SELECT_CHEER_TO_TOP_STEP_ID,
    stepText: '请选择1张因声援被公开的自己的卡片放置到卡组顶。也可以选择不放置。',
    selectionLabel: '选择要放回卡组顶的声援公开卡',
    destination: 'MAIN_DECK_TOP',
    optional: true,
    skipSelectionLabel: '不放置',
    orderedResolution: options.orderedResolution === true,
  });
}

function startHsCl1WatercolorWorldLiveSuccessCheerMemberToHand(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  return startRevealedCheerCardSelection(game, {
    ability,
    playerId: ability.controllerId,
    effectText: getCardAbilityEffectText(HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID),
    stepId: HS_CL1_009_SELECT_CHEER_MEMBER_TO_HAND_STEP_ID,
    stepText: '请选择1张因声援被公开的费用4-9成员卡加入手牌。',
    selectionLabel: '选择要加入手牌的声援公开成员',
    predicate: (card) => isMemberCardData(card.data) && costGte(4)(card) && costLte(9)(card),
    destination: 'HAND',
    optional: false,
    orderedResolution: options.orderedResolution === true,
  });
}

function startHsBp6027TsukiyomiOnCheerAdditionalCheer(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  return startRevealedCheerCardSelection(game, {
    ability,
    playerId: ability.controllerId,
    effectText: getCardAbilityEffectText(HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID),
    stepId: HS_BP6_027_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID,
    stepText:
      '请选择至多3张因声援被公开的自己的不持有 BLADE HEART 的「莲之空」卡片放置入休息室。之后追加等量声援。',
    selectionLabel: '选择要放置入休息室的声援公开卡',
    predicate: and(isHasunosoraCard, not(hasBladeHeart)),
    destination: 'WAITING_ROOM',
    optional: true,
    selectMin: 0,
    selectMax: 3,
    additionalCheerEqualToMoved: true,
    skipSelectionLabel: '不放置',
    orderedResolution: options.orderedResolution === true,
  });
}

export function syncHsBp6027ManualCheerAdjustment(
  game: GameState,
  playerId: string,
  options: { readonly allowCreate?: boolean } = {}
): GameState {
  const activeEffect = game.activeEffect;
  if (
    activeEffect &&
    activeEffect.abilityId === HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID &&
    activeEffect.stepId === HS_BP6_027_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID
  ) {
    return refreshHsBp6027ManualCheerSelection(game, activeEffect);
  }

  if (activeEffect || options.allowCreate !== true) {
    return game;
  }

  const player = getPlayerById(game, playerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = selectHsBp6027CheerCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return game;
  }

  const pendingAbilities = player.liveZone.cardIds.flatMap((sourceCardId) => {
    const sourceCard = getCardById(game, sourceCardId);
    const abilityDefinition = getQueuedAbilityDefinitionsForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.AUTO,
      CardAbilitySourceZone.LIVE_CARD
    ).find((ability) => ability.abilityId === HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID);
    if (!sourceCard || !abilityDefinition) {
      return [];
    }

    const pendingAbilityId = `${abilityDefinition.abilityId}:${sourceCardId}:manual-cheer-adjust:${game.turnCount}:${selectableCardIds.join(',')}`;
    if (hasAbilityInstance(game, pendingAbilityId)) {
      return [];
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId: abilityDefinition.abilityId,
      sourceCardId,
      controllerId: sourceCard.ownerId,
      mandatory: true,
      timingId: 'MANUAL_CHEER_ADJUSTMENT',
      eventIds: [],
      metadata: {
        manualCheerAdjustment: true,
      },
    };
    return [pendingAbility];
  });

  if (pendingAbilities.length === 0) {
    return game;
  }

  const state = addAction(
    {
      ...game,
      pendingAbilities: [...game.pendingAbilities, ...pendingAbilities],
    },
    'TRIGGER_ABILITY',
    player.id,
    {
      abilityId: HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
      timingId: 'MANUAL_CHEER_ADJUSTMENT',
      manualCheerAdjustment: true,
      selectableCardIds,
    }
  );

  return resolvePendingCardEffects(state).gameState;
}

function refreshHsBp6027ManualCheerSelection(
  game: GameState,
  activeEffect: ActiveEffectState
): GameState {
  const selectableCardIds = selectHsBp6027CheerCardIds(game, activeEffect.controllerId);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(
        {
          ...game,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        activeEffect.controllerId,
        {
          pendingAbilityId: activeEffect.id,
          abilityId: activeEffect.abilityId,
          sourceCardId: activeEffect.sourceCardId,
          step: 'MANUAL_CHEER_TARGETS_CLEARED',
        }
      ),
      isOrderedResolutionEffect(game)
    );
  }

  const maxSelectableCards = Math.min(3, selectableCardIds.length);
  const previousSelectableCardIds = activeEffect.selectableCardIds ?? [];
  const selectionUnchanged =
    previousSelectableCardIds.length === selectableCardIds.length &&
    previousSelectableCardIds.every((cardId, index) => cardId === selectableCardIds[index]) &&
    activeEffect.maxSelectableCards === maxSelectableCards;

  if (selectionUnchanged) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...activeEffect,
        selectableCardIds,
        maxSelectableCards,
      },
    },
    'RESOLVE_ABILITY',
    activeEffect.controllerId,
    {
      pendingAbilityId: activeEffect.id,
      abilityId: activeEffect.abilityId,
      sourceCardId: activeEffect.sourceCardId,
      step: 'MANUAL_CHEER_TARGETS_REFRESHED',
      selectableCardIds,
    }
  );
}

function selectHsBp6027CheerCardIds(game: GameState, playerId: string): readonly string[] {
  return selectRevealedCheerCardIds(game, playerId, and(isHasunosoraCard, not(hasBladeHeart)));
}

function startRevealedCheerCardSelection(
  game: GameState,
  config: RevealedCheerCardSelectionConfig
): GameState {
  const player = getPlayerById(game, config.playerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = selectRevealedCheerCardIds(game, player.id, config.predicate);
  if (selectableCardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        step: 'NO_REVEALED_CHEER_TARGET',
      }),
      config.orderedResolution
    );
  }

  const selectMin = config.selectMin ?? (config.optional ? 0 : 1);
  const selectMax = Math.min(config.selectMax ?? 1, selectableCardIds.length);
  const useMultiSelect =
    selectMax > 1 || config.selectMin !== undefined || config.selectMax !== undefined;
  const confirmSelectionLabel =
    config.destination === 'HAND'
      ? '加入手牌'
      : config.destination === 'WAITING_ROOM'
        ? '放置入休息室'
        : '放回卡组顶';

  const state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== config.ability.id
    ),
    activeEffect: {
      id: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      controllerId: config.ability.controllerId,
      effectText: config.effectText,
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: useMultiSelect ? 'ORDERED_MULTI' : 'SINGLE',
      minSelectableCards: useMultiSelect ? selectMin : undefined,
      maxSelectableCards: useMultiSelect ? selectMax : undefined,
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel,
      canSkipSelection: config.optional,
      skipSelectionLabel: config.skipSelectionLabel,
      metadata: {
        cheerRevealedCardSelection: true,
        destination: config.destination,
        additionalCheerEqualToMoved: config.additionalCheerEqualToMoved === true,
        orderedResolution: config.orderedResolution,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: config.ability.id,
    abilityId: config.ability.abilityId,
    sourceCardId: config.ability.sourceCardId,
    step: 'START_SELECT_REVEALED_CHEER_CARD',
    selectableCardIds,
    destination: config.destination,
  });
}

function finishRevealedCheerCardSelection(
  game: GameState,
  selectedCardIdOrIds: string | readonly string[] | null
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.metadata?.cheerRevealedCardSelection !== true) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const destination =
    effect.metadata?.destination === 'HAND' ||
    effect.metadata?.destination === 'MAIN_DECK_TOP' ||
    effect.metadata?.destination === 'WAITING_ROOM'
      ? effect.metadata.destination
      : null;
  if (!destination) {
    return game;
  }

  const selectedCardIds =
    selectedCardIdOrIds === null
      ? []
      : Array.isArray(selectedCardIdOrIds)
        ? selectedCardIdOrIds
        : [selectedCardIdOrIds];
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const minCount =
    effect.selectableCardMode === 'ORDERED_MULTI' ? (effect.minSelectableCards ?? 0) : 0;
  const maxCount =
    effect.selectableCardMode === 'ORDERED_MULTI'
      ? (effect.maxSelectableCards ?? effect.selectableCardIds?.length ?? 0)
      : 1;

  if (uniqueSelectedCardIds.length === 0) {
    if (effect.canSkipSelection !== true) {
      return game;
    }
    const state = {
      ...game,
      activeEffect: null,
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_REVEALED_CHEER_CARD_SELECTION',
        destination,
      }),
      isOrderedResolutionEffect(game)
    );
  }

  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length < minCount ||
    uniqueSelectedCardIds.length > maxCount ||
    !uniqueSelectedCardIds.every((cardId) => effect.selectableCardIds?.includes(cardId) === true)
  ) {
    return game;
  }

  const moveResult = moveRevealedCheerCards(game, player.id, uniqueSelectedCardIds, destination);
  if (!moveResult) {
    return game;
  }

  let state: GameState = {
    ...moveResult.gameState,
    activeEffect: null,
  };
  let additionalCheerCardIds: readonly string[] = [];
  if (
    effect.metadata?.additionalCheerEqualToMoved === true &&
    moveResult.movedCardIds.length > 0
  ) {
    const cheerResult = revealCheerCardsFromMainDeck(
      state,
      player.id,
      moveResult.movedCardIds.length,
      {
        automated: true,
        additional: true,
      }
    );
    state = cheerResult.gameState;
    additionalCheerCardIds = cheerResult.cheerCardIds;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_REVEALED_CHEER_CARD',
      movedCardIds: moveResult.movedCardIds,
      additionalCheerCardIds,
      destination,
    }),
    isOrderedResolutionEffect(game)
  );
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

  const recycleResult = moveWaitingRoomMembersToDeckBottomShuffled(game, player.id);
  const himeTargetCardIds =
    recycleResult.miraCraMemberCount >= 15
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
    movedMemberCardIds: recycleResult.movedMemberCardIds,
    miraCraMemberCount: recycleResult.miraCraMemberCount,
  };

  if (himeTargetCardIds.length === 0) {
    const state = { ...recycleResult.gameState, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        ...baseAction,
        step:
          recycleResult.miraCraMemberCount >= 15
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
          movedMemberCardIds: recycleResult.movedMemberCardIds,
          miraCraMemberCount: recycleResult.miraCraMemberCount,
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

  const ownRecycleResult = moveWaitingRoomMembersToDeckBottomShuffled(game, player.id);
  const opponentRecycleResult = opponent
    ? moveWaitingRoomMembersToDeckBottomShuffled(ownRecycleResult.gameState, opponent.id)
    : { gameState: ownRecycleResult.gameState, movedMemberCardIds: [], miraCraMemberCount: 0 };
  const movedOwnMemberCardIds = ownRecycleResult.movedMemberCardIds;
  const movedOpponentMemberCardIds = opponentRecycleResult.movedMemberCardIds;
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

  const zoneSelection = getZoneSelectionConfig(effect);
  const movedState = moveSelectedCardsFromZone(game, player.id, [selectedCardId], zoneSelection);
  if (!movedState) {
    return game;
  }

  const stateAfterModifier = addHsPb1012BladeModifier(movedState, effect, player.id);
  const state = { ...stateAfterModifier, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_LIVE_GAIN_BLADE',
      selectedCardId,
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
): GameState {
  return addLiveModifier(game, {
    kind: 'BLADE',
    playerId,
    countDelta: 2,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  });
}

function moveWaitingRoomMembersToDeckBottomShuffled(
  game: GameState,
  playerId: string
): {
  readonly gameState: GameState;
  readonly movedMemberCardIds: readonly string[];
  readonly miraCraMemberCount: number;
} {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { gameState: game, movedMemberCardIds: [], miraCraMemberCount: 0 };
  }

  const waitingRoomMemberCardIds = getCardIdsMatchingSelector(
    game,
    getCardIdsInZone(game, playerId, ZoneType.WAITING_ROOM),
    typeIs(CardType.MEMBER)
  );
  const shuffledMemberCardIds = shuffleZone({
    ...player.waitingRoom,
    cardIds: waitingRoomMemberCardIds,
  }).cardIds;
  const waitingRoomMemberCardIdSet = new Set(waitingRoomMemberCardIds);
  const miraCraMemberCount = countCardsMatchingSelector(
    game,
    waitingRoomMemberCardIds,
    unitAliasIs('みらくらぱーく！')
  );

  return {
    gameState: updatePlayer(game, playerId, (currentPlayer) => ({
      ...currentPlayer,
      waitingRoom: {
        ...currentPlayer.waitingRoom,
        cardIds: currentPlayer.waitingRoom.cardIds.filter(
          (cardId) => !waitingRoomMemberCardIdSet.has(cardId)
        ),
      },
      mainDeck: {
        ...currentPlayer.mainDeck,
        cardIds: [...currentPlayer.mainDeck.cardIds, ...shuffledMemberCardIds],
      },
    })),
    movedMemberCardIds: shuffledMemberCardIds,
    miraCraMemberCount,
  };
}

function getWaitingRoomMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getCardIdsInZoneMatching(game, playerId, ZoneType.WAITING_ROOM, typeIs(CardType.MEMBER));
}

function startArrangeInspectedDeckTopEffect(
  game: GameState,
  config: ArrangeInspectedDeckTopConfig
): GameState {
  const player = getPlayerById(game, config.playerId);
  if (!player) {
    return game;
  }

  if (player.mainDeck.cardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        step: 'FINISH',
        inspectedCardIds: [],
      }),
      config.orderedResolution
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: config.inspectCount,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds } = inspection;

  const state: GameState = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== config.ability.id
    ),
    activeEffect: {
      id: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      controllerId: config.ability.controllerId,
      effectText: config.effectText,
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      selectableCardIds: inspectedCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: config.selectMin,
      maxSelectableCards: Math.min(config.selectMax, inspectedCardIds.length),
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: '按此顺序放回卡组顶',
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        selectedDestination: config.selectedDestination,
        unselectedDestination: config.unselectedDestination,
        orderedResolution: config.orderedResolution,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: config.ability.id,
    abilityId: config.ability.abilityId,
    sourceCardId: config.ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
  });
}

function finishArrangeInspectedDeckTopEffect(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectableCardIds = effect.selectableCardIds ?? [];
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const selectedAreValid =
    uniqueSelectedCardIds.length === selectedCardIds.length &&
    uniqueSelectedCardIds.every(
      (cardId) => inspectedCardIds.includes(cardId) && selectableCardIds.includes(cardId)
    );
  const minCount = effect.minSelectableCards ?? 0;
  const maxCount = effect.maxSelectableCards ?? inspectedCardIds.length;
  if (
    !selectedAreValid ||
    uniqueSelectedCardIds.length < minCount ||
    uniqueSelectedCardIds.length > maxCount
  ) {
    return game;
  }

  const unselectedCardIds = inspectedCardIds.filter(
    (cardId) => !uniqueSelectedCardIds.includes(cardId)
  );
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck:
      effect.metadata?.selectedDestination === 'MAIN_DECK_TOP'
        ? {
            ...currentPlayer.mainDeck,
            cardIds: [...uniqueSelectedCardIds, ...currentPlayer.mainDeck.cardIds],
          }
        : currentPlayer.mainDeck,
    waitingRoom:
      effect.metadata?.unselectedDestination === 'WAITING_ROOM'
        ? {
            ...currentPlayer.waitingRoom,
            cardIds: [...currentPlayer.waitingRoom.cardIds, ...unselectedCardIds],
          }
        : currentPlayer.waitingRoom,
  }));

  state = clearInspectionCards({ ...state, activeEffect: null }, inspectedCardIds);
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardIds: uniqueSelectedCardIds,
      waitingRoomCardIds: unselectedCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startKekeOnEnterPlaceWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => cardId !== ability.sourceCardId);
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        playerId: player.id,
        effectText: getCardAbilityEffectText(KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID),
        stepId: KEKE_SELECT_DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution: options.orderedResolution === true,
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    }
  );
}

function finishKekeOnEnterPlaceWaitingEnergy(game: GameState, discardCardId: string): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(discardCardId)) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!stateAfterDiscard) {
    return game;
  }

  const energyPlacement = placeEnergyFromDeckToZone(
    stateAfterDiscard,
    player.id,
    1,
    OrientationState.WAITING
  );
  if (!energyPlacement) {
    return game;
  }

  const state = {
    ...energyPlacement.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_WAITING_ENERGY',
      discardCardId,
      placedEnergyCardIds: energyPlacement.placedEnergyCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startShikiOnEnterLeftDrawDiscard(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  return startDrawThenDiscardCardsEffect(game, {
    ability,
    effectText: getCardAbilityEffectText(SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID),
    drawCount: 2,
    discardCount: 1,
    stepId: SHIKI_LEFT_SELECT_DISCARD_STEP_ID,
    orderedResolution: options.orderedResolution === true,
  });
}

function startDrawThenDiscardCardsEffect(
  game: GameState,
  config: DrawThenDiscardCardsEffectConfig
): GameState {
  const player = getPlayerById(game, config.ability.controllerId);
  if (!player) {
    return game;
  }

  const stateBeforeDraw =
    config.recordAbilityUseOnStart === true
      ? recordAbilityUse(game, player.id, config.ability.abilityId, config.ability.sourceCardId)
      : game;
  const drawResult = drawCardsFromMainDeckToHand(stateBeforeDraw, player.id, config.drawCount);
  if (!drawResult) {
    return game;
  }

  const playerAfterDraw = getPlayerById(drawResult.gameState, player.id);
  if (!playerAfterDraw) {
    return game;
  }

  const selectableCardIds = [...playerAfterDraw.hand.cardIds];
  const discardCountText = config.discardCount === 1 ? '1张' : `${config.discardCount}张`;
  return addAction(
    {
      ...drawResult.gameState,
      pendingAbilities: drawResult.gameState.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
      activeEffect: {
        id: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        controllerId: config.ability.controllerId,
        effectText: config.effectText,
        stepId: config.stepId,
        stepText:
          selectableCardIds.length > 0
            ? `请选择${discardCountText}手牌放置入休息室。`
            : '没有可放置入休息室的手牌。确认后继续。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '请选择要放置入休息室的手牌',
        canSkipSelection: selectableCardIds.length === 0,
        skipSelectionLabel: '确认',
        metadata: {
          orderedResolution: config.orderedResolution,
          sourceSlot: config.ability.sourceSlot,
          drawCount: config.drawCount,
          discardCount: config.discardCount,
          drawnCardIds: drawResult.drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      step: 'DRAW_CARDS_START_DISCARD',
      sourceSlot: config.ability.sourceSlot,
      drawCount: config.drawCount,
      discardCount: config.discardCount,
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
    }
  );
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
  const drawResult = drawCardsFromMainDeckToHand(state, player.id, 1);
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

function finishDrawThenDiscardCardsEffect(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds?: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = effect.selectableCardIds ?? [];
  const requiredDiscardCount =
    typeof effect.metadata?.discardCount === 'number' && effect.metadata.discardCount > 0
      ? Math.floor(effect.metadata.discardCount)
      : 1;
  const selectedCardIdsList =
    selectedCardIds && selectedCardIds.length > 0
      ? selectedCardIds
      : selectedCardId
        ? [selectedCardId]
        : [];

  if (selectedCardIdsList.length === 0) {
    if (selectableCardIds.length > 0) {
      return game;
    }
    const state = { ...game, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'FINISH',
        sourceSlot: effect.metadata?.sourceSlot,
        drawnCardIds: effect.metadata?.drawnCardIds,
        discardedCardId: null,
        discardedCardIds: [],
      }),
      isOrderedResolutionEffect(game)
    );
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIdsList)];
  if (
    uniqueSelectedCardIds.length !== requiredDiscardCount ||
    uniqueSelectedCardIds.length !== selectedCardIdsList.length ||
    uniqueSelectedCardIds.some(
      (cardId) => !selectableCardIds.includes(cardId) || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  let stateAfterDiscard = game;
  for (const selectedHandCardId of uniqueSelectedCardIds) {
    const state = moveHandCardToWaitingRoomForEffect(
      stateAfterDiscard,
      player.id,
      selectedHandCardId
    );
    if (!state) {
      return game;
    }
    stateAfterDiscard = state;
  }

  const state = {
    ...stateAfterDiscard,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      sourceSlot: effect.metadata?.sourceSlot,
      drawnCardIds: effect.metadata?.drawnCardIds,
      discardedCardId: uniqueSelectedCardIds[0],
      discardedCardIds: uniqueSelectedCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startShikiOnEnterRightActivateEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingEnergyCardIds = player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.WAITING
  );
  const maxActivateCount = Math.min(2, waitingEnergyCardIds.length);
  const stepText = `确认后将至多2张待机能量变为活跃状态。（当前可变为活跃：${maxActivateCount}张）`;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID),
        stepId: SHIKI_RIGHT_ACTIVATE_ENERGY_STEP_ID,
        stepText,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          sourceSlot: ability.sourceSlot,
          fromOrientation: OrientationState.WAITING,
          nextOrientation: OrientationState.ACTIVE,
          maxActivateCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      sourceSlot: ability.sourceSlot,
      waitingEnergyCardIds,
      maxActivateCount,
    }
  );
}

function finishShikiOnEnterRightActivateEnergy(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orientationChange = setFirstEnergyCardsOrientation(
    game,
    player.id,
    2,
    OrientationState.ACTIVE,
    { fromOrientation: OrientationState.WAITING }
  );
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_ENERGY',
      sourceSlot: effect.metadata?.sourceSlot,
      activatedEnergyCardIds: orientationChange.updatedEnergyCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startChisatoLiveStartActivateAll(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const liellaMemberCardIds = getStageMemberCardIdsMatching(game, player.id, liellaMemberCard);
  const energyCardIds = [...player.energyZone.cardIds];

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID),
        stepId: CHISATO_LIVE_START_ACTIVATE_STEP_ID,
        stepText: `确认后将${liellaMemberCardIds.length}名Liella!成员和${energyCardIds.length}张能量变为活跃状态。`,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          sourceSlot: ability.sourceSlot,
          liellaMemberCardIds,
          energyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      sourceSlot: ability.sourceSlot,
      liellaMemberCardIds,
      energyCardIds,
    }
  );
}

function finishChisatoLiveStartActivateAll(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const liellaMemberCardIds = getStageMemberCardIdsMatching(game, player.id, liellaMemberCard);
  const energyCardIds = [...player.energyZone.cardIds];

  const memberOrientationChange = setMembersOrientation(
    game,
    player.id,
    liellaMemberCardIds,
    OrientationState.ACTIVE
  );
  if (!memberOrientationChange) {
    return game;
  }

  const energyOrientationChange = setEnergyOrientation(
    memberOrientationChange.gameState,
    player.id,
    energyCardIds,
    OrientationState.ACTIVE
  );
  if (!energyOrientationChange) {
    return game;
  }

  const state = {
    ...energyOrientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_MEMBERS_AND_ENERGY',
      sourceSlot: effect.metadata?.sourceSlot,
      activatedMemberCardIds: memberOrientationChange.updatedMemberCardIds,
      previousMemberOrientations: memberOrientationChange.previousOrientations,
      activatedEnergyCardIds: energyOrientationChange.updatedEnergyCardIds,
      previousEnergyOrientations: energyOrientationChange.previousOrientations,
      nextOrientation: OrientationState.ACTIVE,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startEmmaOnEnterActivateMemberOrEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingMemberCardIds = getStageMemberCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const selectableOptions = [
    ...(waitingMemberCardIds.length > 0 ? [{ id: 'member', label: '选择1名成员' }] : []),
    ...(waitingEnergyCardIds.length > 0 ? [{ id: 'energy', label: '将能量变活跃' }] : []),
  ];

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID),
        stepId: EMMA_SELECT_TARGET_TYPE_STEP_ID,
        stepText:
          selectableOptions.length > 0
            ? '请选择要变为活跃状态的目标类型。'
            : '当前没有待机状态的舞台成员或能量。确认后继续。',
        awaitingPlayerId: player.id,
        selectableOptions,
        canSkipSelection: selectableOptions.length === 0,
        skipSelectionLabel: selectableOptions.length === 0 ? '确认' : undefined,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          waitingMemberCardIds,
          waitingEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_TARGET_TYPE',
      waitingMemberCardIds,
      waitingEnergyCardIds,
    }
  );
}

function startEmmaTargetSelection(game: GameState, selectedOptionId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingMemberCardIds = getStageMemberCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );

  if (selectedOptionId === 'member' && waitingMemberCardIds.length > 0) {
    return addAction(
      {
        ...game,
        activeEffect: {
          ...effect,
          stepId: EMMA_SELECT_MEMBER_STEP_ID,
          stepText: '请选择1名要变为活跃状态的舞台成员。',
          selectableCardIds: waitingMemberCardIds,
          selectableCardMode: 'SINGLE',
          minSelectableCards: undefined,
          maxSelectableCards: undefined,
          selectableOptions: undefined,
          canSkipSelection: false,
          skipSelectionLabel: undefined,
          selectionLabel: '选择要变为活跃的成员',
          confirmSelectionLabel: '变为活跃',
          metadata: {
            ...effect.metadata,
            waitingMemberCardIds,
            waitingEnergyCardIds,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECT_MEMBER_TARGET',
        waitingMemberCardIds,
      }
    );
  }

  if (selectedOptionId === 'energy' && waitingEnergyCardIds.length > 0) {
    return finishEmmaActivateEnergy(game, waitingEnergyCardIds.slice(0, 2));
  }

  if (waitingMemberCardIds.length > 0 || waitingEnergyCardIds.length > 0) {
    return game;
  }

  const state = { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_NO_TARGETS',
    }),
    isOrderedResolutionEffect(game)
  );
}

function finishEmmaActivateMember(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect || selectedCardId === null) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getStageMemberCardIdsByOrientation(game, player.id, OrientationState.WAITING).includes(
      selectedCardId
    )
  ) {
    return game;
  }

  const orientationChange = setMembersOrientation(
    game,
    player.id,
    [selectedCardId],
    OrientationState.ACTIVE
  );
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_MEMBER',
      activatedMemberCardIds: orientationChange.updatedMemberCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    isOrderedResolutionEffect(game)
  );
}

function finishEmmaActivateEnergy(game: GameState, energyCardIds: readonly string[]): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const uniqueEnergyCardIds = [...new Set(energyCardIds)];
  if (!player || uniqueEnergyCardIds.length === 0 || uniqueEnergyCardIds.length > 2) {
    return game;
  }

  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  if (
    uniqueEnergyCardIds.length !== energyCardIds.length ||
    !uniqueEnergyCardIds.every((cardId) => waitingEnergyCardIds.includes(cardId))
  ) {
    return game;
  }

  const orientationChange = setEnergyOrientation(
    game,
    player.id,
    uniqueEnergyCardIds,
    OrientationState.ACTIVE
  );
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_ENERGY',
      activatedEnergyCardIds: orientationChange.updatedEnergyCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startShikiLiveStartPositionChange(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  return startMemberPositionChangeEffect(game, {
    ability,
    effectText: getCardAbilityEffectText(SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID),
    stepId: SHIKI_LIVE_START_POSITION_CHANGE_STEP_ID,
    stepText: '请选择若菜四季要移动到的成员区。也可以选择不进行站位变换。',
    optional: true,
    orderedResolution: options.orderedResolution === true,
  });
}

function startMemberPositionChangeEffect(
  game: GameState,
  config: MemberPositionChangeEffectConfig
): GameState {
  const player = getPlayerById(game, config.ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot =
    config.ability.sourceSlot ?? findMemberSlot(player, config.ability.sourceCardId);
  if (!sourceSlot) {
    return continuePendingCardEffects(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter(
          (candidate) => candidate.id !== config.ability.id
        ),
      },
      config.orderedResolution
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
      activeEffect: {
        id: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        controllerId: config.ability.controllerId,
        effectText: config.effectText,
        stepId: config.stepId,
        stepText: config.stepText,
        awaitingPlayerId: player.id,
        selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
        canSkipSelection: config.optional,
        skipSelectionLabel: config.optional ? '不发动' : undefined,
        metadata: {
          orderedResolution: config.orderedResolution,
          sourceSlot,
          optional: config.optional,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      step: 'START_POSITION_CHANGE',
      sourceSlot,
      optional: config.optional,
    }
  );
}

function finishMemberPositionChangeEffect(
  game: GameState,
  selectedSlot: SlotPosition | null
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedResolution = isOrderedResolutionEffect(game);
  if (!selectedSlot) {
    if (effect.canSkipSelection !== true) {
      return game;
    }

    const state = {
      ...game,
      activeEffect: null,
    };

    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'POSITION_CHANGE_SKIPPED',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      orderedResolution
    );
  }

  if (!effect.selectableSlots?.includes(selectedSlot)) {
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

function finishNozomiOnEnter(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const hasMilledLiveCard = hasCardIdsMatchingSelector(
    game,
    inspectedCardIds,
    typeIs(CardType.LIVE)
  );
  let drawnCardId: string | null = null;

  const moveResult = moveInspectedCardsToWaitingRoom(game, player.id, inspectedCardIds);
  if (!moveResult) {
    return game;
  }
  let state = moveResult.gameState;

  if (hasMilledLiveCard) {
    const drawResult = drawCardsFromMainDeckToHand(state, player.id, 1);
    if (!drawResult) {
      return game;
    }
    state = drawResult.gameState;
    drawnCardId = drawResult.drawnCardIds[0] ?? null;
  }

  state = {
    ...state,
    inspectionContext: state.inspectionZone.cardIds.length > 0 ? state.inspectionContext : null,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      milledCardIds: moveResult.movedCardIds,
      hasMilledLiveCard,
      drawnCardId,
    }),
    isOrderedResolutionEffect(game)
  );
}

function revealUmiSelectedLive(game: GameState, selectedCardId: string): GameState {
  return revealSelectedInspectionCard(game, selectedCardId, {
    stepId: UMI_REVEAL_STEP_ID,
    stepText: getCardAbilityEffectText(UMI_ON_ENTER_ABILITY_ID),
    actionStep: 'REVEAL_SELECTED',
  });
}

function finishUmiOnEnter(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectedCard = selectedCardId !== null ? getCardById(game, selectedCardId) : null;
  const selectedIsValid =
    selectedCardId !== null &&
    inspectedCardIds.includes(selectedCardId) &&
    selectedCard !== null &&
    museLiveCard(selectedCard);
  const cardToHandId = selectedIsValid ? selectedCardId : null;
  const moveResult = moveInspectedSelectionToHandRestToWaitingRoom(
    game,
    player.id,
    inspectedCardIds,
    cardToHandId
  );
  if (!moveResult) {
    return game;
  }

  const state = { ...moveResult.gameState, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      inspectedCardIds,
      selectedCardId: moveResult.selectedCardId,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    isOrderedResolutionEffect(game)
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

interface NamedHandDiscardLiveStartConfig {
  readonly effectText: string;
  readonly names: readonly string[];
  readonly minCount: number;
  readonly maxCount?: number;
  readonly rewardKind: 'SCORE' | 'BLADE_PER_DISCARDED';
  readonly rewardAmount?: number;
}

function startNamedHandDiscardLiveStartEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {},
  config: NamedHandDiscardLiveStartConfig
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getNamedHandDiscardCandidateIds(game, player.id, config.names);
  const maxSelectableCards = Math.min(
    config.maxCount ?? selectableCardIds.length,
    selectableCardIds.length
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
        effectText: config.effectText,
        stepId: SELECT_NAMED_HAND_DISCARD_STEP_ID,
        stepText: '选择要作为费用放置入休息室的指定姓名手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: config.minCount,
        maxSelectableCards,
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution: options.orderedResolution === true,
          sourceSlot: ability.sourceSlot,
          namedHandDiscardNames: [...config.names],
          namedHandDiscardRewardKind: config.rewardKind,
          namedHandDiscardRewardAmount: config.rewardAmount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NAMED_HAND_DISCARD',
      sourceSlot: ability.sourceSlot,
      selectableCardIds,
      minSelectableCards: config.minCount,
      maxSelectableCards,
    }
  );
}

function finishNamedHandDiscardLiveStartEffect(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const minCount = effect?.minSelectableCards ?? 0;
  const maxCount = effect?.maxSelectableCards ?? 0;
  if (
    !effect ||
    !player ||
    effect.stepId !== SELECT_NAMED_HAND_DISCARD_STEP_ID ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length < minCount ||
    uniqueSelectedCardIds.length > maxCount ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const costPayment = paySelectedDiscardHandCost(game, player.id, uniqueSelectedCardIds);
  if (!costPayment) {
    return game;
  }

  const rewardKind =
    effect.metadata?.namedHandDiscardRewardKind === 'SCORE'
      ? 'SCORE'
      : effect.metadata?.namedHandDiscardRewardKind === 'BLADE_PER_DISCARDED'
        ? 'BLADE_PER_DISCARDED'
        : null;
  if (rewardKind === null) {
    return game;
  }

  const rewardAmount =
    rewardKind === 'SCORE'
      ? typeof effect.metadata?.namedHandDiscardRewardAmount === 'number'
        ? effect.metadata.namedHandDiscardRewardAmount
        : 0
      : uniqueSelectedCardIds.length;
  const stateAfterModifier = addLiveModifier(costPayment.gameState, {
    kind: rewardKind === 'SCORE' ? 'SCORE' : 'BLADE',
    playerId: player.id,
    countDelta: rewardAmount,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  });
  const state = { ...stateAfterModifier, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step:
        rewardKind === 'SCORE'
          ? 'DISCARD_NAMED_HAND_CARDS_GAIN_SCORE'
          : 'DISCARD_NAMED_HAND_CARDS_GAIN_BLADE',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardIds: uniqueSelectedCardIds,
      rewardKind,
      rewardAmount,
    }),
    isOrderedResolutionEffect(game)
  );
}

function getNamedHandDiscardCandidateIds(
  game: GameState,
  playerId: string,
  names: readonly string[]
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return getCardIdsMatchingSelector(game, player.hand.cardIds, cardNameAliasAny(names));
}

function startKotoriLiveStartEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution?: boolean;
    readonly effectText?: string;
    readonly requiresOtherStageMember?: boolean;
    readonly heartColorOptions?: readonly HeartColor[];
  } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = player.hand.cardIds;
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        playerId: player.id,
        effectText: options.effectText ?? getCardAbilityEffectText(KOTORI_LIVE_START_HEART_ABILITY_ID),
        stepId: KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution: options.orderedResolution === true,
        metadata: {
          requiresOtherStageMemberForHeart: options.requiresOtherStageMember === true,
          heartColorOptions: options.heartColorOptions ?? KOTORI_HEART_COLOR_OPTIONS,
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    }
  );
}

function startKotoriLiveStartHeartChoice(game: GameState, discardCardId: string): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(discardCardId)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }
  const state = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!state) {
    return game;
  }
  const requiresOtherStageMember = effect.metadata?.requiresOtherStageMemberForHeart === true;
  if (requiresOtherStageMember && !hasOtherStageMember(state, player.id, effect.sourceCardId)) {
    const finishedState = {
      ...state,
      activeEffect: null,
    };
    return continuePendingCardEffects(
      addAction(finishedState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_HAND_CARD_NO_OTHER_MEMBER',
        discardCardId,
      }),
      isOrderedResolutionEffect(game)
    );
  }
  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: KOTORI_LIVE_START_SELECT_HEART_STEP_ID,
        stepText: '请选择本次 Live 结束前获得的 Heart。',
        selectableCardIds: [],
        selectableCardVisibility: 'PUBLIC',
        selectableOptions: getHeartColorOptionsForEffect(effect).map((color) => ({
          id: color,
          label: HEART_COLOR_OPTION_LABELS[color],
        })),
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          discardCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      discardCardId,
    }
  );
}

function finishKotoriLiveStartHeartBonus(
  game: GameState,
  selectedOptionId: string | null
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedColor = getHeartColorOptionsForEffect(effect).includes(
    selectedOptionId as HeartColor
  )
    ? (selectedOptionId as HeartColor)
    : null;
  if (!player || selectedColor === null) {
    return game;
  }
  const heartBonus = { color: selectedColor, count: 1 };
  const state = addLiveModifier(
    {
      ...game,
      activeEffect: null,
    },
    {
      kind: 'HEART',
      playerId: player.id,
      hearts: [heartBonus],
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_HEART_BONUS',
      heartColor: selectedColor,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startEliActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  return startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: ELI_ACTIVATED_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-sd1-002'],
    effectText: getCardAbilityEffectText(ELI_ACTIVATED_ABILITY_ID),
    stepId: ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    selectablePredicate: typeIs(CardType.MEMBER),
  });
}

function startRinActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  const state = startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: RIN_ACTIVATED_ABILITY_ID,
    expectedBaseCardCodes: getCardAbilityBaseCardCodes(RIN_ACTIVATED_ABILITY_ID),
    effectText: getCardAbilityEffectText(RIN_ACTIVATED_ABILITY_ID),
    stepId: RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    selectablePredicate: typeIs(CardType.LIVE),
  });
  return state;
}

function startPr017NicoActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  return startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-PR-017'],
    effectText: getCardAbilityEffectText(
      PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID
    ),
    stepId: PR_017_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
    selectablePredicate: and(typeIs(CardType.LIVE), groupIs("μ's")),
    selectionRequiredWhenHasTargets: true,
  });
}

function startDiscardHandThenWaitingRoomRecoveryActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string,
  config: DiscardHandThenWaitingRoomRecoveryActivatedConfig
): GameState {
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
    !config.expectedBaseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
    ) ||
    !isMemberCardData(sourceCard.data) ||
    !findMemberSlot(player, cardId) ||
    player.hand.cardIds.length < config.discardCount ||
    config.canActivate?.(game, player.id) === false
  ) {
    return game;
  }

  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: config.discardCount,
    maxCount: config.discardCount,
    optional: false,
  };
  const state = recordAbilityUse(game, player.id, config.abilityId, cardId);

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: config.abilityId,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: config.effectText,
        stepId: config.discardStepId,
        stepText: `请选择${config.discardCount}张手牌放置入休息室。`,
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: config.discardCount,
        maxSelectableCards: config.discardCount,
        selectionLabel: `选择要放置入休息室的${config.discardCount}张手牌`,
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          effectCosts: [discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
          discardCount: config.discardCount,
          recoveryStepId: config.recoveryStepId,
          recoverySelectionRequiredWhenHasTargets:
            config.recoverySelectionRequiredWhenHasTargets === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: config.abilityId,
      sourceCardId: cardId,
      step: 'START_SELECT_DISCARD',
      discardCount: config.discardCount,
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function startDiscardHandThenWaitingRoomRecoveryAfterDiscard(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const discardCount =
    typeof effect.metadata?.discardCount === 'number' ? effect.metadata.discardCount : 0;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    discardCount <= 0 ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== discardCount ||
    !uniqueSelectedCardIds.every(
      (selectedCardId) =>
        effect.selectableCardIds?.includes(selectedCardId) === true &&
        player.hand.cardIds.includes(selectedCardId)
    )
  ) {
    return game;
  }

  const costPayment = paySelectedDiscardHandCost(game, player.id, uniqueSelectedCardIds);
  if (!costPayment) {
    return game;
  }

  const museLivePredicate = and(typeIs(CardType.LIVE), groupIs("μ's"));
  const selectableCardIds = selectWaitingRoomCardIds(
    costPayment.gameState,
    player.id,
    museLivePredicate
  );
  const selectionRequired =
    effect.metadata?.recoverySelectionRequiredWhenHasTargets === true &&
    selectableCardIds.length > 0;
  const recoveryStepId =
    typeof effect.metadata?.recoveryStepId === 'string'
      ? effect.metadata.recoveryStepId
      : SELECT_WAITING_ROOM_CARD_STEP_ID;
  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: selectionRequired ? 1 : 0,
    optional: !selectionRequired,
  });

  return addAction(
    {
      ...costPayment.gameState,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: recoveryStepId,
        stepText: "请选择自己的休息室中1张『μ's』的LIVE卡加入手牌。",
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          discardedHandCardIds: uniqueSelectedCardIds,
        },
        zoneSelection,
      }),
    },
    'PAY_COST',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      discardedHandCardIds: uniqueSelectedCardIds,
      selectableCardIds,
    }
  );
}

function startBp4002EliActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  return startDiscardHandThenWaitingRoomRecoveryActivatedEffect(game, playerId, cardId, {
    abilityId: BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-bp4-002'],
    effectText: getCardAbilityEffectText(
      BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
    ),
    discardStepId: BP4_002_SELECT_DISCARD_STEP_ID,
    recoveryStepId: BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
    discardCount: 2,
    canActivate: (state, controllerId) => successLiveScoreAtLeast(state, controllerId, 6),
    recoverySelectionRequiredWhenHasTargets: true,
  });
}

function startPb1ActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  return startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: PB1_019_ACTIVATED_ABILITY_ID,
    expectedBaseCardCodes: getCardAbilityBaseCardCodes(PB1_019_ACTIVATED_ABILITY_ID),
    effectText: getCardAbilityEffectText(PB1_019_ACTIVATED_ABILITY_ID),
    stepId: PB1_019_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    selectablePredicate: typeIs(CardType.MEMBER),
  });
}

function startBp4ActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  return startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: BP4_003_ACTIVATED_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-bp4-003'],
    effectText: getCardAbilityEffectText(BP4_003_ACTIVATED_ABILITY_ID),
    stepId: BP4_003_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    selectablePredicate: typeIs(CardType.LIVE),
  });
}

function startHsBp1TsuzuriActivatedRecoverLive(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
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
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-bp1-004') ||
    !isMemberCardData(sourceCard.data) ||
    !findMemberSlot(player, cardId)
  ) {
    return game;
  }

  const selector = isHasunosoraLiveCard;
  const selectableCardIds = getCardIdsInZoneMatching(
    game,
    player.id,
    ZoneType.WAITING_ROOM,
    selector
  );
  if (selectableCardIds.length === 0) {
    return game;
  }

  let state = recordAbilityUse(
    game,
    player.id,
    HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
    cardId
  );
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 3 },
  ]);
  if (!costPayment) {
    return game;
  }
  state = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    abilityId: HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  const zoneSelection = createWaitingRoomToHandSelectionConfig();

  state = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getCardAbilityEffectText(HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID),
      stepId: HS_BP1_004_SELECT_WAITING_ROOM_LIVE_STEP_ID,
      stepText: '请选择自己的休息室中1张『莲之空』的LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      metadata: {
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
      },
      zoneSelection,
    }),
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
    sourceCardId: cardId,
    step: 'PAY_COST_SELECT_WAITING_ROOM_LIVE',
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    selectableCardIds,
  });
}

function startHsBp5KahoActivatedRevealHandLiveRecoverSameNameLive(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
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
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-bp5-001') ||
    !isMemberCardData(sourceCard.data) ||
    !findMemberSlot(player, cardId)
  ) {
    return game;
  }

  const selectableHandLiveCardIds = player.hand.cardIds.filter((handCardId) => {
    const handCard = getCardById(game, handCardId);
    return (
      handCard !== null &&
      isLiveCardData(handCard.data) &&
      getSameNameWaitingRoomLiveCardIds(game, player.id, handCardId).length > 0
    );
  });
  if (selectableHandLiveCardIds.length === 0) {
    return game;
  }

  let state = recordAbilityUse(
    game,
    player.id,
    HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    cardId
  );
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!costPayment) {
    return game;
  }
  state = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    abilityId: HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  state = {
    ...state,
    activeEffect: {
      id: `${HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getCardAbilityEffectText(HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID),
      stepId: HS_BP5_001_SELECT_HAND_LIVE_STEP_ID,
      stepText: '请选择手牌中1张LIVE卡公开。之后可从休息室将1张包含该卡卡名的LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds: selectableHandLiveCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: false,
      selectionLabel: '选择要公开的手牌LIVE',
      confirmSelectionLabel: '公开',
      metadata: {
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    sourceCardId: cardId,
    step: 'PAY_COST_SELECT_HAND_LIVE',
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    selectableCardIds: selectableHandLiveCardIds,
  });
}

function revealHsBp5KahoActivatedHandLive(
  game: GameState,
  selectedHandLiveCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID ||
    effect.stepId !== HS_BP5_001_SELECT_HAND_LIVE_STEP_ID ||
    selectedHandLiveCardId === null ||
    effect.selectableCardIds?.includes(selectedHandLiveCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(selectedHandLiveCardId)) {
    return game;
  }

  const revealedHandLive = getCardById(game, selectedHandLiveCardId);
  if (!revealedHandLive) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: HS_BP5_001_REVEAL_HAND_LIVE_STEP_ID,
        stepText: '已公开手牌LIVE。确认后从休息室选择1张同名LIVE卡加入手牌。',
        revealedCardIds: [selectedHandLiveCardId],
        selectableCardIds: [],
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: undefined,
        confirmSelectionLabel: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          revealedHandLiveCardId: selectedHandLiveCardId,
          revealedHandLiveCardName: revealedHandLive.data.name,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_HAND_LIVE',
      revealedHandLiveCardId: selectedHandLiveCardId,
      revealedHandLiveCardName: revealedHandLive.data.name,
    }
  );
}

function startHsBp5KahoActivatedSelectSameNameLive(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID ||
    effect.stepId !== HS_BP5_001_REVEAL_HAND_LIVE_STEP_ID ||
    typeof effect.metadata?.revealedHandLiveCardId !== 'string'
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedHandLiveCardId = effect.metadata.revealedHandLiveCardId;
  if (!player || !player.hand.cardIds.includes(selectedHandLiveCardId)) {
    return game;
  }

  const selectableCardIds = getSameNameWaitingRoomLiveCardIds(
    game,
    player.id,
    selectedHandLiveCardId
  );
  if (selectableCardIds.length === 0) {
    return game;
  }

  const revealedHandLive = getCardById(game, selectedHandLiveCardId);
  const state = {
    ...game,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: getCardAbilityEffectText(HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID),
      stepId: HS_BP5_001_SELECT_WAITING_ROOM_LIVE_STEP_ID,
      stepText: '已公开手牌LIVE。请选择休息室中1张同名LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        ...effect.metadata,
        revealedHandLiveCardId: selectedHandLiveCardId,
        revealedHandLiveCardName: revealedHandLive?.data.name ?? null,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'REVEAL_HAND_LIVE_SELECT_WAITING_ROOM_SAME_NAME_LIVE',
    revealedHandLiveCardId: selectedHandLiveCardId,
    revealedHandLiveCardName: revealedHandLive?.data.name ?? null,
    selectableCardIds,
  });
}

function getSameNameWaitingRoomLiveCardIds(
  game: GameState,
  playerId: string,
  revealedLiveCardId: string
): readonly string[] {
  const revealedLiveCard = getCardById(game, revealedLiveCardId);
  if (!revealedLiveCard || !isLiveCardData(revealedLiveCard.data)) {
    return [];
  }
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.LIVE), cardNameContains(revealedLiveCard.data.name))
  );
}

function startHsBp1KosuzuActivatedRecoverLowCostMember(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
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
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-bp1-003') ||
    !isMemberCardData(sourceCard.data) ||
    !findMemberSlot(player, cardId)
  ) {
    return game;
  }

  const selector = and(typeIs(CardType.MEMBER), costLte(4), isHasunosoraCard);
  const selectableCardIds = getCardIdsInZoneMatching(
    game,
    player.id,
    ZoneType.WAITING_ROOM,
    selector
  );
  if (selectableCardIds.length === 0) {
    return game;
  }

  let state = recordAbilityUse(
    game,
    player.id,
    HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
    cardId
  );
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }
  state = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    abilityId: HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  state = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getCardAbilityEffectText(HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID),
      stepId: HS_BP1_003_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
      stepText: '请选择自己的休息室中1张费用小于等于4的『莲之空』成员卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
    sourceCardId: cardId,
    step: 'PAY_COST_SELECT_WAITING_ROOM_MEMBER',
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    selectableCardIds,
  });
}

function startHsBp1SayakaActivatedPlayMemberToSourceSlot(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = player ? findMemberSlot(player, cardId) : null;
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-bp1-002') ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null
  ) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
    { kind: 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM' },
  ]);
  if (!costPayment || !costPayment.sourceSlot) {
    return game;
  }

  const selector = and(typeIs(CardType.MEMBER), costLte(15), isHasunosoraCard);
  const selectableCardIds = getCardIdsInZoneMatching(
    costPayment.gameState,
    player.id,
    ZoneType.WAITING_ROOM,
    selector
  );
  if (selectableCardIds.length === 0) {
    return game;
  }

  let state = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    abilityId: HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
    movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    sourceSlot: costPayment.sourceSlot,
  });

  state = {
    ...state,
    activeEffect: {
      id: `${HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getCardAbilityEffectText(HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID),
      stepId: HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
      stepText:
        '请选择自己的休息室中1张费用小于等于15的『莲之空』成员卡登场至此成员原本所在的区域。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      selectionLabel: '选择要从休息室登场的成员',
      confirmSelectionLabel: '登场',
      metadata: {
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
        movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
        sourceSlot: costPayment.sourceSlot,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
    sourceCardId: cardId,
    step: 'PAY_COST_SELECT_WAITING_ROOM_MEMBER_TO_PLAY',
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    sourceSlot: costPayment.sourceSlot,
    selectableCardIds,
  });
}

function finishHsBp1SayakaPlayMemberToSourceSlot(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot =
    typeof effect.metadata?.sourceSlot === 'string' &&
    Object.values(SlotPosition).includes(effect.metadata.sourceSlot as SlotPosition)
      ? (effect.metadata.sourceSlot as SlotPosition)
      : null;
  if (!player || sourceSlot === null || !player.waitingRoom.cardIds.includes(selectedCardId)) {
    return game;
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(game, player.id, [
    { cardId: selectedCardId, toSlot: sourceSlot },
  ]);
  if (!playResult) {
    return game;
  }

  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_MEMBER_FROM_WAITING_ROOM_TO_SOURCE_SLOT',
    playedCardId: selectedCardId,
    toSlot: sourceSlot,
  });
  const stateWithOnEnter = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: getNewEnterStageEvents(game, state),
  });

  return continuePendingCardEffects({ ...stateWithOnEnter, activeEffect: null }, false);
}

function startSacrificeSelfActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string,
  config: {
    readonly abilityId: string;
    readonly expectedBaseCardCodes: readonly string[];
    readonly effectText: string;
    readonly stepId: string;
    readonly selectablePredicate: (card: NonNullable<ReturnType<typeof getCardById>>) => boolean;
    readonly selectionRequiredWhenHasTargets?: boolean;
  }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  if (activePlayerId !== playerId) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !config.expectedBaseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
    ) ||
    !isMemberCardData(sourceCard.data)
  ) {
    return game;
  }
  const sourceSlot = findMemberSlot(player, cardId);
  if (!sourceSlot) {
    return game;
  }
  let state = recordAbilityUse(game, player.id, config.abilityId, cardId);
  const stateBeforeCost = state;
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM' },
  ]);
  if (!costPayment) {
    return game;
  }
  state = costPayment.gameState;
  const movedToWaitingRoomCardIds = costPayment.movedToWaitingRoomCardIds;
  if (costPayment.sourceSlot && movedToWaitingRoomCardIds.includes(cardId)) {
    state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_LEAVE_STAGE], {
      leaveStageEvents: getNewLeaveStageEvents(stateBeforeCost, state),
    });
  }
  const selectableCardIds = selectWaitingRoomCardIds(state, player.id, config.selectablePredicate);
  const selectionRequired =
    config.selectionRequiredWhenHasTargets === true && selectableCardIds.length > 0;
  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: selectionRequired ? 1 : 0,
    optional: !selectionRequired,
  });
  state = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: config.abilityId,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: config.effectText,
      stepId: config.stepId,
      awaitingPlayerId: player.id,
      selectableCardIds,
      metadata: {
        sourceSlot,
        movedToWaitingRoomCardIds,
      },
      zoneSelection,
    }),
  };
  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
    step: 'PAY_COST',
    fromSlot: sourceSlot,
    movedToWaitingRoomCardIds,
    selectableCardIds,
  });
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

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getEmptyMemberSlots(
  player: NonNullable<ReturnType<typeof getPlayerById>>
): SlotPosition[] {
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}

function calculateMemberCostSum(game: GameState, cardIds: readonly string[]): number {
  return cardIds.reduce((sum, cardId) => {
    const card = getCardById(game, cardId);
    return sum + (card && isMemberCardData(card.data) ? card.data.cost : Number.POSITIVE_INFINITY);
  }, 0);
}

function getDiscardLookTopCount(cardCode: string | undefined): number {
  if (cardCode && cardCodeMatchesBase(cardCode, 'PL!-sd1-015')) {
    return 5;
  }
  if (cardCode && cardCodeMatchesBase(cardCode, 'PL!-bp3-010')) {
    return 5;
  }
  return 3;
}

function getDiscardLookTopSelectableCardType(
  cardCode: string | undefined
): 'MEMBER' | 'LIVE' | null {
  if (cardCode && cardCodeMatchesBase(cardCode, 'PL!-sd1-015')) {
    return 'MEMBER';
  }
  if (cardCode && cardCodeMatchesBase(cardCode, 'PL!-bp3-010')) {
    return 'LIVE';
  }
  return null;
}

function isDiscardLookTopSelectionRequired(cardCode: string | undefined): boolean {
  if (!cardCode) {
    return false;
  }
  return [
    'PL!-sd1-011',
    'PL!-sd1-012',
    'PL!-sd1-016',
    'PL!HS-PR-001',
    'PL!HS-cl1-007',
    'PL!HS-pb1-011',
    'PL!N-PR-004',
    'PL!N-PR-006',
    'PL!N-PR-013',
    'PL!N-bp1-007',
    'PL!N-bp1-010',
    'PL!N-sd1-002',
    'PL!N-sd1-003',
  ].some((baseCardCode) => cardCodeMatchesBase(cardCode, baseCardCode));
}

function getDiscardLookTopEffectText(cardCode: string | undefined): string {
  if (!cardCode) {
    return getCardAbilityEffectText(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
  }
  if (
    ['PL!-sd1-011', 'PL!-sd1-012', 'PL!-sd1-016'].some((baseCardCode) =>
      cardCodeMatchesBase(cardCode, baseCardCode)
    )
  ) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的3张卡。将1张其中的卡片加入手牌，其余的卡片放置入休息室。';
  }
  if (cardCodeMatchesBase(cardCode, 'PL!-sd1-015')) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的5张卡。可以将1张其中的成员卡公开并加入手牌。其余的卡片放置入休息室。';
  }
  if (cardCodeMatchesBase(cardCode, 'PL!HS-PR-001')) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的3张卡，将1张加入手牌，其余放置入休息室。';
  }
  if (cardCodeMatchesBase(cardCode, 'PL!-bp3-010')) {
    return getCardAbilityEffectText(BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID);
  }
  return getCardAbilityEffectText(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
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

function getHeartColorOptionsForEffect(effect: ActiveEffectState): readonly HeartColor[] {
  if (Array.isArray(effect.metadata?.heartColorOptions)) {
    const colors = effect.metadata.heartColorOptions.filter((color): color is HeartColor =>
      Object.values(HeartColor).includes(color as HeartColor)
    );
    if (colors.length > 0) {
      return colors;
    }
  }
  return KOTORI_HEART_COLOR_OPTIONS;
}
