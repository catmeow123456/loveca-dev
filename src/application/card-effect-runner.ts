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
import { isLiveCardData, isMemberCardData } from '../domain/entities/card.js';
import type { ActiveEffectState, GameState, PendingAbilityState } from '../domain/entities/game.js';
import { addAction, getCardById, getPlayerById, updatePlayer } from '../domain/entities/game.js';
import { addCardToZone } from '../domain/entities/zone.js';
import { addLiveModifier, replaceLiveModifier } from '../domain/rules/live-modifiers.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  moveSelectedCardsFromZone,
  selectWaitingRoomCardIds,
} from './effects/zone-selection.js';
import { and, costLte, groupIs, typeIs } from './effects/card-selectors.js';
import {
  moveHandCardToWaitingRoomForEffect,
  payImmediateEffectCosts,
  type EffectCostDefinition,
} from './effects/effect-costs.js';
import {
  clearInspectionCards,
  inspectTopCards,
  moveInspectedCardsToWaitingRoom,
  moveInspectedSelectionToHandRestToWaitingRoom,
  moveTopDeckCardsToWaitingRoom,
} from './effects/look-top.js';
import { moveMemberBetweenSlots } from './effects/member-state.js';
import { drawCardsFromMainDeckToHand } from './effects/draw.js';

export const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';
export const NOZOMI_ON_ENTER_ABILITY_ID = 'PL!-sd1-007-SD:on-enter-mill-five-draw-if-live';
export const UMI_ON_ENTER_ABILITY_ID = 'PL!-sd1-004-SD:on-enter-look-five-take-muse-live';
export const HONOKA_ON_ENTER_ABILITY_ID = 'PL!-sd1-001-SD:on-enter-take-live-if-two-success';
export const KOTORI_ON_ENTER_ABILITY_ID = 'PL!-sd1-003-SD:on-enter-take-low-cost-muse-member';
export const MAKI_ON_ENTER_ABILITY_ID = 'PL!-sd1-006-SD:on-enter-swap-hand-live-success-live';
export const GENERIC_DISCARD_LOOK_TOP_ABILITY_ID = 'PL!-sd1:discard-one-look-top-take-one';
export const KARIN_LIVE_START_ABILITY_ID = 'PL!N-pb1-004-P+:live-start-reveal-top-member';
export const KOTORI_LIVE_START_HEART_ABILITY_ID = 'PL!-sd1-003-SD:live-start-discard-gain-heart';
export const NICO_LIVE_START_SCORE_ABILITY_ID = 'PL!-sd1-009-SD:live-start-score-plus-if-25-muse';
export const BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID =
  'PL!-sd1-022-SD:live-start-reduce-requirement-by-success-live';
export const ELI_ACTIVATED_ABILITY_ID =
  'PL!-sd1-002-SD:activated-send-self-to-waiting-room-add-member';
export const RIN_ACTIVATED_ABILITY_ID =
  'PL!-sd1-005-SD:activated-send-self-to-waiting-room-add-live';
export const HANAYO_ACTIVATED_ABILITY_ID = 'PL!-sd1-008-SD:activated-pay-two-mill-ten';
export const START_DASH_LIVE_SUCCESS_ABILITY_ID = 'PL!-sd1-019-SD:live-success-start-dash';

export enum CardAbilityCategory {
  CONTINUOUS = 'CONTINUOUS',
  ON_ENTER = 'ON_ENTER',
  ACTIVATED = 'ACTIVATED',
  LIVE_START = 'LIVE_START',
  LIVE_SUCCESS = 'LIVE_SUCCESS',
  AUTO = 'AUTO',
}

export enum CardAbilitySourceZone {
  PLAYED_MEMBER = 'PLAYED_MEMBER',
  STAGE_MEMBER = 'STAGE_MEMBER',
  LIVE_CARD = 'LIVE_CARD',
}

export interface ActivatedAbilityUiConfig {
  readonly abilityId: string;
  readonly text: string;
  readonly title: string;
}

export interface CardAbilityDefinition {
  readonly abilityId: string;
  readonly cardCodes: readonly string[];
  readonly category: CardAbilityCategory;
  readonly sourceZone: CardAbilitySourceZone;
  readonly triggerCondition?: TriggerCondition;
  readonly queued: boolean;
  readonly implemented: boolean;
  readonly effectText: string;
  readonly perTurnLimit?: number;
  readonly activatedUi?: ActivatedAbilityUiConfig;
  readonly notes?: string;
}

const NOZOMI_EFFECT_TEXT = '【登场】将自己卡组顶的5张卡放置入休息室。其中有LIVE卡的场合，抽1张卡。';
const UMI_EFFECT_TEXT =
  "【登场】检视自己卡组顶的5张卡。可以将1张其中的『μ's』的LIVE卡公开并加入手牌。其余的卡片放置入休息室。";
const HONOKA_ON_ENTER_EFFECT_TEXT =
  '【登场】自己的成功LIVE卡区中的卡片大于等于2张的场合，从自己的休息室将1张LIVE卡加入手牌。';
const KOTORI_ON_ENTER_EFFECT_TEXT =
  "【登场】从自己的休息室将1张费用小于等于4的『μ's』的成员卡加入手牌。";
const KOTORI_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以将1张手牌放置入休息室：选择[桃ハート]或[黄ハート]或[紫ハート]中的1种，LIVE结束时为止，获得1个选择了的Heart。';
const MAKI_EFFECT_TEXT =
  '【登场】可以将1张手牌中的LIVE卡公开：将1张自己的成功LIVE卡区中的卡片加入手牌。如此做的场合，将因此公开的卡放置入自己的成功LIVE卡区。';
const GENERIC_DISCARD_LOOK_TOP_EFFECT_TEXT =
  '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的卡。将1张其中的卡片加入手牌，其余的卡片放置入休息室。';
const KARIN_EFFECT_TEXT =
  '【LIVE开始时】公开自己卡组顶的卡片。公开的卡片为费用小于等于9的成员卡的场合，将公开的卡片加入手牌，此成员进行站位变换。除此之外的场合，将公开的卡片放置入休息室。';
const NICO_EFFECT_TEXT =
  "【LIVE开始时】自己的休息室中存在大于等于25张『μ's』的卡片的场合，LIVE结束时为止，获得「【常时】LIVE的合计分数＋１。」。";
const BOKUIMA_EFFECT_TEXT =
  '【LIVE开始时】每存在1张自己的成功LIVE卡区中的卡片，使此卡成功的必要HEART减少[無ハート][無ハート]。';
const ELI_EFFECT_TEXT = '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。';
const RIN_EFFECT_TEXT = '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。';
const HANAYO_EFFECT_TEXT = '【起动】[1回合1次][E][E]：将自己卡组顶的10张卡放置入休息室。';
const START_DASH_EFFECT_TEXT =
  '【LIVE成功时】检视自己卡组顶的3张卡。将任意张按任意顺序放置于卡组顶，其余放置入休息室。';
const DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL = '请选择要放置入休息室的卡牌';
const DISCARD_HAND_TO_ACTIVATE_STEP_TEXT = '请选择要放置入休息室的手牌。也可以选择不发动此效果。';
const DECLINE_OPTION_LABEL = '不发动';
const ACTIVATED_ABILITY_USE_STEP = 'ACTIVATED_ABILITY_USE';
const START_DASH_ARRANGE_STEP_ID = 'START_DASH_ARRANGE_TOP_DECK';

interface DiscardHandToWaitingRoomEffectConfig {
  readonly ability: PendingAbilityState;
  readonly playerId: string;
  readonly effectText: string;
  readonly stepId: string;
  readonly selectableCardIds: readonly string[];
  readonly orderedResolution: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
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

export const CARD_ABILITY_DEFINITIONS: readonly CardAbilityDefinition[] = [
  {
    abilityId: `${HONOKA_ON_ENTER_ABILITY_ID}:continuous-extra-blade`,
    cardCodes: ['PL!-sd1-001-SD'],
    category: CardAbilityCategory.CONTINUOUS,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: '【常时】LIVE判定时，每有1张自己的成功LIVE卡，因声援公开的张数+1。',
    notes: '持续修正不进队列，由 collectLiveModifiers 动态收集为 BLADE modifier。',
  },
  {
    abilityId: HONOKA_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-001-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HONOKA_ON_ENTER_EFFECT_TEXT,
  },
  {
    abilityId: ELI_ACTIVATED_ABILITY_ID,
    cardCodes: ['PL!-sd1-002-SD'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: ELI_EFFECT_TEXT,
    activatedUi: {
      abilityId: ELI_ACTIVATED_ABILITY_ID,
      text: '起动：将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。',
      title: '将此成员从舞台放置入休息室，从自己的休息室将1张成员卡加入手牌',
    },
  },
  {
    abilityId: KOTORI_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-003-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: KOTORI_ON_ENTER_EFFECT_TEXT,
  },
  {
    abilityId: KOTORI_LIVE_START_HEART_ABILITY_ID,
    cardCodes: ['PL!-sd1-003-SD'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: KOTORI_LIVE_START_EFFECT_TEXT,
  },
  {
    abilityId: UMI_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-004-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: UMI_EFFECT_TEXT,
  },
  {
    abilityId: RIN_ACTIVATED_ABILITY_ID,
    cardCodes: ['PL!-sd1-005-SD'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: RIN_EFFECT_TEXT,
    activatedUi: {
      abilityId: RIN_ACTIVATED_ABILITY_ID,
      text: '起动：将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。',
      title: '将此成员从舞台放置入休息室，从自己的休息室将1张LIVE卡加入手牌',
    },
  },
  {
    abilityId: MAKI_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-006-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: MAKI_EFFECT_TEXT,
  },
  {
    abilityId: NOZOMI_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-007-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: NOZOMI_EFFECT_TEXT,
  },
  {
    abilityId: HANAYO_ACTIVATED_ABILITY_ID,
    cardCodes: ['PL!-sd1-008-SD'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: HANAYO_EFFECT_TEXT,
    perTurnLimit: 1,
    activatedUi: {
      abilityId: HANAYO_ACTIVATED_ABILITY_ID,
      text: '起动：[E][E]：将自己卡组顶的10张卡放置入休息室。',
      title: '支付2能量，将自己卡组顶的10张卡放置入休息室',
    },
  },
  {
    abilityId: NICO_LIVE_START_SCORE_ABILITY_ID,
    cardCodes: ['PL!-sd1-009-SD'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: NICO_EFFECT_TEXT,
  },
  {
    abilityId: GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
    cardCodes: ['PL!-sd1-011-SD', 'PL!-sd1-012-SD', 'PL!-sd1-015-SD', 'PL!-sd1-016-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: GENERIC_DISCARD_LOOK_TOP_EFFECT_TEXT,
  },
  {
    abilityId: START_DASH_LIVE_SUCCESS_ABILITY_ID,
    cardCodes: ['PL!-sd1-019-SD'],
    category: CardAbilityCategory.LIVE_SUCCESS,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    queued: true,
    implemented: true,
    effectText: START_DASH_EFFECT_TEXT,
    notes: '使用通用检视卡组顶、选任意张排序放回卡组顶、其余入休息室流程。',
  },
  {
    abilityId: BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
    cardCodes: ['PL!-sd1-022-SD'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: BOKUIMA_EFFECT_TEXT,
  },
  {
    abilityId: KARIN_LIVE_START_ABILITY_ID,
    cardCodes: ['PL!N-pb1-004-P+'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: KARIN_EFFECT_TEXT,
    notes: '测试用虹咲样例卡，保留在同一分类表中验证 LIVE开始队列共性。',
  },
];

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
  return CARD_ABILITY_DEFINITIONS.filter((definition) => definition.cardCodes.includes(cardCode));
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

export interface ActivatedAbilityLimitStatus {
  readonly abilityId: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
}

export function getActivatedAbilityLimitStatus(
  game: GameState,
  playerId: string,
  abilityId: string
): ActivatedAbilityLimitStatus | null {
  const definition = getActivatedAbilityDefinition(abilityId);
  const limit = definition?.perTurnLimit;
  if (limit === undefined) {
    return null;
  }

  const used = game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.playerId === playerId &&
      action.payload.abilityId === abilityId &&
      action.payload.step === ACTIVATED_ABILITY_USE_STEP &&
      action.payload.turnCount === game.turnCount
  ).length;

  return {
    abilityId,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

export function canUseActivatedAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string
): boolean {
  const status = getActivatedAbilityLimitStatus(game, playerId, abilityId);
  return status === null || status.used < status.limit;
}

function getQueuedAbilityIdForCard(
  cardCode: string | undefined,
  category: CardAbilityCategory,
  sourceZone: CardAbilitySourceZone
): string | null {
  return (
    getCardAbilityDefinitions(cardCode).find(
      (ability) =>
        ability.category === category &&
        ability.sourceZone === sourceZone &&
        ability.queued &&
        ability.implemented
    )?.abilityId ?? null
  );
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

function recordActivatedAbilityUse(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', playerId, {
    abilityId,
    sourceCardId,
    step: ACTIVATED_ABILITY_USE_STEP,
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
const KARIN_REVEAL_STEP_ID = 'KARIN_REVEAL_TOP_CARD';
const KARIN_POSITION_CHANGE_STEP_ID = 'KARIN_POSITION_CHANGE';
const KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID = 'KOTORI_LIVE_START_SELECT_DISCARD';
const KOTORI_LIVE_START_SELECT_HEART_STEP_ID = 'KOTORI_LIVE_START_SELECT_HEART';
const NICO_SCORE_BONUS_STEP_ID = 'NICO_SCORE_BONUS';
const BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID = 'BOKUIMA_REQUIREMENT_REDUCTION';
const ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'ELI_SELECT_WAITING_ROOM_MEMBER';
const RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'RIN_SELECT_WAITING_ROOM_LIVE';
const ABILITY_ORDER_SELECTION_STEP_ID = 'SELECT_NEXT_PENDING_ABILITY';

interface CardEffectRunnerResult {
  readonly gameState: GameState;
  readonly resolvedAbilityIds: readonly string[];
}

export function enqueueTriggeredCardEffects(
  game: GameState,
  triggerConditions: readonly TriggerCondition[]
): GameState {
  let state = game;

  if (triggerConditions.includes(TriggerCondition.ON_ENTER_STAGE)) {
    state = enqueueOnEnterCardEffects(state);
  }

  if (triggerConditions.includes(TriggerCondition.ON_LIVE_START)) {
    state = enqueueLiveStartCardEffects(state);
  }

  if (triggerConditions.includes(TriggerCondition.ON_LIVE_SUCCESS)) {
    state = enqueueLiveSuccessCardEffects(state);
  }

  return state;
}

function enqueueOnEnterCardEffects(game: GameState): GameState {
  const action = [...game.actionHistory]
    .reverse()
    .find((candidate) => candidate.type === 'PLAY_MEMBER');
  const sourceCardId = typeof action?.payload.cardId === 'string' ? action.payload.cardId : null;
  if (!action || !sourceCardId) {
    return game;
  }

  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard) {
    return game;
  }

  const abilityId = getQueuedAbilityIdForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.ON_ENTER,
    CardAbilitySourceZone.PLAYED_MEMBER
  );
  if (!abilityId) {
    return game;
  }

  const pendingAbilityId = `${abilityId}:${action.sequence}`;
  if (hasAbilityInstance(game, pendingAbilityId)) {
    return game;
  }

  const pendingAbility: PendingAbilityState = {
    id: pendingAbilityId,
    abilityId,
    sourceCardId,
    controllerId: action.playerId ?? sourceCard.ownerId,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`action:${action.sequence}`],
  };

  return addAction(
    {
      ...game,
      pendingAbilities: [...game.pendingAbilities, pendingAbility],
    },
    'TRIGGER_ABILITY',
    pendingAbility.controllerId,
    {
      pendingAbilityId,
      abilityId: pendingAbility.abilityId,
      sourceCardId,
      timingId: pendingAbility.timingId,
    }
  );
}

function enqueueLiveStartCardEffects(game: GameState): GameState {
  const performingPlayerId =
    game.liveResolution.performingPlayerId ?? game.players[game.activePlayerIndex]?.id;
  const player = performingPlayerId ? getPlayerById(game, performingPlayerId) : null;
  if (!player) {
    return game;
  }

  let state = game;
  const sourceEntries = [
    ...Object.values(player.memberSlots.slots)
      .filter((cardId): cardId is string => !!cardId)
      .map((cardId) => ({ cardId, sourceZone: CardAbilitySourceZone.STAGE_MEMBER })),
    ...player.liveZone.cardIds.map((cardId) => ({
      cardId,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
    })),
  ];
  for (const sourceEntry of sourceEntries) {
    const sourceCardId = sourceEntry.cardId;
    const sourceCard = getCardById(state, sourceCardId);
    const abilityId = getQueuedAbilityIdForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.LIVE_START,
      sourceEntry.sourceZone
    );
    if (!sourceCard || !abilityId) {
      continue;
    }

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
      eventIds: [`live-start:${state.turnCount}:${performingPlayerId}`],
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
      }
    );
  }

  return state;
}

function enqueueLiveSuccessCardEffects(game: GameState): GameState {
  const playerId = getLiveSuccessEffectPlayerId(game);
  const player = playerId ? getPlayerById(game, playerId) : null;
  if (!player) {
    return game;
  }

  let state = game;
  const successfulLiveCardIds = [...state.liveResolution.liveResults.entries()]
    .filter(([cardId, isSuccess]) => {
      const card = getCardById(state, cardId);
      return isSuccess === true && card?.ownerId === player.id;
    })
    .map(([cardId]) => cardId);

  for (const sourceCardId of successfulLiveCardIds) {
    const sourceCard = getCardById(state, sourceCardId);
    const abilityId = getQueuedAbilityIdForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.LIVE_SUCCESS,
      CardAbilitySourceZone.LIVE_CARD
    );
    if (!sourceCard || !abilityId) {
      continue;
    }

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
      eventIds: [`live-success:${state.turnCount}:${player.id}:${sourceCardId}`],
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
      }
    );
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

  const sameTimingAbilities = pendingAbilities.filter(
    (candidate) =>
      candidate.controllerId === ability.controllerId && candidate.timingId === ability.timingId
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
    return selectPendingAbilityOrder(game, selectedCardId, resolveInOrder === true);
  }

  if (effect.abilityId === NOZOMI_ON_ENTER_ABILITY_ID && effect.stepId === NOZOMI_REVEAL_STEP_ID) {
    return finishNozomiOnEnter(game);
  }

  if (
    (effect.abilityId === HONOKA_ON_ENTER_ABILITY_ID ||
      effect.abilityId === KOTORI_ON_ENTER_ABILITY_ID) &&
    effect.stepId === SELECT_WAITING_ROOM_CARD_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
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
    effect.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID &&
    effect.stepId === DISCARD_LOOK_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? startDiscardLookTopInspection(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID &&
    effect.stepId === DISCARD_LOOK_SELECT_TAKE_STEP_ID
  ) {
    if (effect.metadata?.revealSelectedBeforeHand === true && selectedCardId) {
      return revealDiscardLookTopSelectedCard(game, selectedCardId);
    }
    return finishDiscardLookTopEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID &&
    effect.stepId === DISCARD_LOOK_REVEAL_SELECTED_STEP_ID
  ) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishDiscardLookTopEffect(game, selectedCardIdFromMetadata);
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
    effect.abilityId === KOTORI_LIVE_START_HEART_ABILITY_ID &&
    effect.stepId === KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? startKotoriLiveStartHeartChoice(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === KOTORI_LIVE_START_HEART_ABILITY_ID &&
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
    effect.abilityId === START_DASH_LIVE_SUCCESS_ABILITY_ID &&
    effect.stepId === START_DASH_ARRANGE_STEP_ID
  ) {
    return finishArrangeInspectedDeckTopEffect(game, selectedCardIds ?? []);
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

  return game;
}

export function activateCardAbility(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): GameState {
  if (!canUseActivatedAbilityThisTurn(game, playerId, abilityId)) {
    return game;
  }

  switch (abilityId) {
    case ELI_ACTIVATED_ABILITY_ID:
      return startEliActivatedEffect(game, playerId, cardId);
    case RIN_ACTIVATED_ABILITY_ID:
      return startRinActivatedEffect(game, playerId, cardId);
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
  return {
    ...game,
    activeEffect: {
      id: `${ABILITY_ORDER_SELECTION_ID}:${firstAbility.timingId}:${firstAbility.controllerId}`,
      abilityId: ABILITY_ORDER_SELECTION_ID,
      sourceCardId: firstAbility.sourceCardId,
      controllerId: firstAbility.controllerId,
      effectText: '请选择下一个要发动的效果。也可以选择“顺序发动”，按当前队列顺序依次处理。',
      stepId: ABILITY_ORDER_SELECTION_STEP_ID,
      stepText: '选择下一个 LIVE 开始时效果',
      awaitingPlayerId: firstAbility.controllerId,
      selectableCardIds: abilities.map((ability) => ability.sourceCardId),
      canResolveInOrder: true,
      metadata: {
        pendingAbilityIds: abilities.map((ability) => ability.id),
      },
    },
  };
}

function selectPendingAbilityOrder(
  game: GameState,
  selectedCardId: string | null | undefined,
  resolveInOrder: boolean
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
    { orderedResolution: resolveInOrder }
  );
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
  const sameTimingAbilities = pendingAbilities.filter(
    (candidate) =>
      candidate.controllerId === nextAbility.controllerId &&
      candidate.timingId === nextAbility.timingId
  );

  return sameTimingAbilities.length > 1
    ? startAbilityOrderSelection(game, sameTimingAbilities)
    : startPendingAbilityEffect(game, nextAbility);
}

function isOrderedResolutionEffect(game: GameState): boolean {
  return game.activeEffect?.metadata?.orderedResolution === true;
}

function startPendingAbilityEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
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
    case MAKI_ON_ENTER_ABILITY_ID:
      return startMakiOnEnterSelection(game, ability, options);
    case GENERIC_DISCARD_LOOK_TOP_ABILITY_ID:
      return startGenericDiscardLookTopEffect(game, ability, options);
    case KARIN_LIVE_START_ABILITY_ID:
      return startKarinLiveStartInspection(game, ability, options);
    case KOTORI_LIVE_START_HEART_ABILITY_ID:
      return startKotoriLiveStartEffect(game, ability, options);
    case NICO_LIVE_START_SCORE_ABILITY_ID:
      return startNicoLiveStartScoreBonus(game, ability, options);
    case BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID:
      return startBokuimaLiveStartRequirementReduction(game, ability, options);
    case START_DASH_LIVE_SUCCESS_ABILITY_ID:
      return startStartDashLiveSuccessEffect(game, ability, options);
    default:
      return game;
  }
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
    player.successZone.cardIds.length >= 2
      ? selectWaitingRoomCardIds(game, player.id, typeIs(CardType.LIVE))
      : [];
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: HONOKA_ON_ENTER_EFFECT_TEXT,
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
    effectText: KOTORI_ON_ENTER_EFFECT_TEXT,
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
  });
}

function startWaitingRoomCardSelection(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  config: {
    readonly effectText: string;
    readonly selectableCardIds: readonly string[];
    readonly orderedResolution: boolean;
  }
): GameState {
  const zoneSelection = createWaitingRoomToHandSelectionConfig();
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
        stepId: SELECT_WAITING_ROOM_CARD_STEP_ID,
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

function finishSelectCardsFromZoneToHandEffect(
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
  const selectedIsValid =
    selectedCardId !== null &&
    effect.selectableCardIds?.includes(selectedCardId) === true &&
    player.waitingRoom.cardIds.includes(selectedCardId);
  const cardToHandId = selectedIsValid ? selectedCardId : null;
  const zoneSelection = getZoneSelectionConfig(effect);
  const movedState = moveSelectedCardsFromZone(
    game,
    player.id,
    cardToHandId ? [cardToHandId] : [],
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
      selectedCardId: cardToHandId,
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
  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isLiveCardData(card.data);
  });
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: MAKI_EFFECT_TEXT,
        stepId: MAKI_SELECT_HAND_LIVE_STEP_ID,
        stepText: MAKI_EFFECT_TEXT,
        awaitingPlayerId: player.id,
        selectableCardIds,
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
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: MAKI_SELECT_SUCCESS_LIVE_STEP_ID,
        stepText: '请选择要加入手牌的成功 Live。所公开的手牌 Live 会放置入成功 Live 卡区。',
        selectableCardIds: player.successZone.cardIds.filter((cardId) => {
          const card = getCardById(game, cardId);
          return card !== null && isLiveCardData(card.data);
        }),
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

  const museWaitingRoomCount = countMuseWaitingRoomCards(game, player.id);
  const isConditionMet = museWaitingRoomCount >= 25;
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
      effectText: NICO_EFFECT_TEXT,
      conditionMet: isConditionMet,
      museWaitingRoomCount,
      scoreBonus: isConditionMet ? 1 : 0,
    }),
    isOrderedResolutionEffect(game)
  );
}

function formatNicoEffectText(game: GameState, playerId: string): string {
  return `${NICO_EFFECT_TEXT}（当前${countMuseWaitingRoomCards(game, playerId)}张）`;
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

  const successLiveCount = player.successZone.cardIds.length;
  const reduction = successLiveCount * 2;
  const effectText = `${BOKUIMA_EFFECT_TEXT}（当前成功LIVE ${successLiveCount}张，减少${reduction}个無Heart）`;

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

  const successLiveCount = player.successZone.cardIds.length;
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

function countMuseWaitingRoomCards(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isMuseCard(card.data);
  }).length;
}

function isMuseCard(cardData: {
  readonly cardCode?: string;
  readonly groupName?: string;
  readonly cardText?: string;
}): boolean {
  if (cardData.groupName?.includes('μ') || cardData.cardText?.includes('μ')) {
    return true;
  }

  return cardData.cardCode?.startsWith('PL!-') === true;
}

function isMuseLiveCardData(cardData: Parameters<typeof isLiveCardData>[0] | undefined): boolean {
  return cardData !== undefined && isLiveCardData(cardData) && isMuseCard(cardData);
}

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
      effectText: NOZOMI_EFFECT_TEXT,
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
    selectablePredicate: (card) => isMuseLiveCardData(card.data),
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds, selectableCardIds } = inspection;

  const state = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: UMI_EFFECT_TEXT,
      stepId: UMI_SELECT_STEP_ID,
      stepText: UMI_EFFECT_TEXT,
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      selectableCardIds,
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
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        playerId: player.id,
        effectText: getDiscardLookTopEffectText(sourceCard.data.cardCode),
        stepId: DISCARD_LOOK_SELECT_DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution: options.orderedResolution === true,
        metadata: {
          topCount: getDiscardLookTopCount(sourceCard.data.cardCode),
          memberOnly: sourceCard.data.cardCode === 'PL!-sd1-015-SD',
          revealSelectedBeforeHand: sourceCard.data.cardCode === 'PL!-sd1-015-SD',
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
  const selectionRequired = !memberOnly;
  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!stateAfterDiscard) {
    return game;
  }
  const inspection = inspectTopCards(stateAfterDiscard, player.id, {
    count: topCount,
    selectablePredicate: memberOnly ? (card) => isMemberCardData(card.data) : undefined,
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
        stepText: memberOnly
          ? '请选择其中1张成员卡加入手牌，其余放置入休息室。'
          : '请选择其中1张卡加入手牌，其余放置入休息室。',
        inspectionCardIds: inspectedCardIds,
        selectableCardIds,
        selectionLabel: selectionRequired ? '请选择要加入手牌的卡牌' : '请选择要加入手牌的成员卡',
        canSkipSelection: !selectionRequired,
        skipSelectionLabel: memberOnly ? '不加入' : undefined,
        metadata: {
          ...effect.metadata,
          discardCardId,
          selectionRequired,
          revealSelectedBeforeHand: effect.metadata?.revealSelectedBeforeHand === true,
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
      effectText: KARIN_EFFECT_TEXT,
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
    effectText: START_DASH_EFFECT_TEXT,
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
  const hasMilledLiveCard = inspectedCardIds.some(
    (cardId) => getCardById(game, cardId)?.data.cardType === CardType.LIVE
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
    stepText: UMI_EFFECT_TEXT,
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
  const selectedIsValid =
    selectedCardId !== null &&
    inspectedCardIds.includes(selectedCardId) &&
    isMuseLiveCardData(getCardById(game, selectedCardId)?.data);
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
      effectText: KARIN_EFFECT_TEXT,
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

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'POSITION_CHANGE',
      fromSlot: moveResult.fromSlot,
      toSlot: moveResult.toSlot,
      swappedCardId: moveResult.swappedCardId,
    }),
    orderedResolution
  );
}

function startKotoriLiveStartEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
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
        effectText: KOTORI_LIVE_START_EFFECT_TEXT,
        stepId: KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID,
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
  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: KOTORI_LIVE_START_SELECT_HEART_STEP_ID,
        stepText: '请选择本次 Live 结束前获得的 Heart。',
        selectableCardIds: [],
        selectableOptions: [
          { id: HeartColor.PINK, label: '粉心' },
          { id: HeartColor.YELLOW, label: '黄心' },
          { id: HeartColor.PURPLE, label: '紫心' },
        ],
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
  const selectedColor = [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE].includes(
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
    expectedCardCode: 'PL!-sd1-002-SD',
    effectText: ELI_EFFECT_TEXT,
    stepId: ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    selectablePredicate: typeIs(CardType.MEMBER),
  });
}

function startRinActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  const state = startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: RIN_ACTIVATED_ABILITY_ID,
    expectedCardCode: 'PL!-sd1-005-SD',
    effectText: RIN_EFFECT_TEXT,
    stepId: RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    selectablePredicate: typeIs(CardType.LIVE),
  });
  return state;
}

function startSacrificeSelfActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string,
  config: {
    readonly abilityId: string;
    readonly expectedCardCode: string;
    readonly effectText: string;
    readonly stepId: string;
    readonly selectablePredicate: (card: NonNullable<ReturnType<typeof getCardById>>) => boolean;
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
    sourceCard.data.cardCode !== config.expectedCardCode ||
    !isMemberCardData(sourceCard.data)
  ) {
    return game;
  }
  const sourceSlot = findMemberSlot(player, cardId);
  if (!sourceSlot) {
    return game;
  }
  let state = recordActivatedAbilityUse(game, player.id, config.abilityId, cardId);
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM' },
  ]);
  if (!costPayment) {
    return game;
  }
  state = costPayment.gameState;
  const movedToWaitingRoomCardIds = costPayment.movedToWaitingRoomCardIds;
  const zoneSelection = createWaitingRoomToHandSelectionConfig();
  const selectableCardIds = selectWaitingRoomCardIds(state, player.id, config.selectablePredicate);
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
    sourceCard.data.cardCode !== 'PL!-sd1-008-SD'
  ) {
    return game;
  }
  let state = recordActivatedAbilityUse(game, player.id, HANAYO_ACTIVATED_ABILITY_ID, cardId);
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
    effectText: HANAYO_EFFECT_TEXT,
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

function getDiscardLookTopCount(cardCode: string | undefined): number {
  return cardCode === 'PL!-sd1-015-SD' ? 5 : 3;
}

function getDiscardLookTopEffectText(cardCode: string | undefined): string {
  switch (cardCode) {
    case 'PL!-sd1-011-SD':
    case 'PL!-sd1-012-SD':
    case 'PL!-sd1-016-SD':
      return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的3张卡。将1张其中的卡片加入手牌，其余的卡片放置入休息室。';
    case 'PL!-sd1-015-SD':
      return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的5张卡。可以将1张其中的成员卡公开并加入手牌。其余的卡片放置入休息室。';
    default:
      return GENERIC_DISCARD_LOOK_TOP_EFFECT_TEXT;
  }
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
