import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { TriggerCondition } from '../../../../shared/types/enums.js';
import {
  and,
  costGte,
  costLte,
  groupAliasIs,
  hasBladeHeart,
  not,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { revealCheerCardsFromMainDeck } from '../../../effects/cheer.js';
import {
  moveRevealedCheerCards,
  evaluateCurrentLiveRevealedCheerCardCondition,
  selectRevealedCheerCardIds,
  type CheerCardPredicate,
  type RevealedCheerCardDestination,
} from '../../../effects/cheer-selection.js';
import {
  HS_BP1_021_LIVE_SUCCESS_HASUNOSORA_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID,
  HS_BP6_005_LIVE_SUCCESS_DOLLCHESTRA_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID,
  HS_BP6_032_LIVE_SUCCESS_LOW_COST_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID,
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
  HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
  HS_CL1_012_LIVE_SUCCESS_EQUAL_SCORE_REVEALED_CHEER_HIGH_COST_MEMBER_TO_HAND_ABILITY_ID,
  HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
  S_BP6_021_ON_CHEER_SEND_NO_BLADE_AQOURS_MEMBER_ADDITIONAL_CHEER_ABILITY_ID,
  S_BP2_021_LIVE_SUCCESS_REVEALED_CHEER_LIVE_TO_DECK_BOTTOM_ABILITY_ID,
  S_SD1_019_LIVE_SUCCESS_AQOURS_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID,
  SP_BP2_025_LIVE_SUCCESS_TWO_DISTINCT_NAMED_STAGE_MEMBERS_REVEALED_CHEER_TO_HAND_ABILITY_ID,
} from '../../ability-ids.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { cardNameAliasMatches } from '../../../../shared/utils/card-identity.js';
import {
  registerLiveSuccessAbilityAvailabilityGate,
  type LiveSuccessAbilityAvailabilityGate,
} from '../../runtime/live-success-ability-availability-gates.js';

export const HS_BP6_001_SELECT_CHEER_TO_TOP_STEP_ID = 'HS_BP6_001_SELECT_REVEALED_CHEER_TO_TOP';
export const HS_CL1_009_SELECT_CHEER_MEMBER_TO_HAND_STEP_ID =
  'HS_CL1_009_SELECT_REVEALED_CHEER_MEMBER_TO_HAND';
export const HS_BP6_032_SELECT_LOW_COST_CHEER_MEMBER_TO_HAND_STEP_ID =
  'HS_BP6_032_SELECT_REVEALED_CHEER_LOW_COST_MEMBER_TO_HAND';
export const HS_BP6_005_SELECT_DOLLCHESTRA_CHEER_MEMBER_TO_HAND_STEP_ID =
  'HS_BP6_005_SELECT_REVEALED_CHEER_DOLLCHESTRA_MEMBER_TO_HAND';
export const HS_CL1_012_SELECT_HIGH_COST_CHEER_MEMBER_TO_HAND_STEP_ID =
  'HS_CL1_012_SELECT_REVEALED_CHEER_HIGH_COST_MEMBER_TO_HAND';
export const HS_BP6_027_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID =
  'HS_BP6_027_SELECT_REVEALED_CHEER_TO_WAITING_ROOM';
export const S_BP6_021_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID =
  'S_BP6_021_SELECT_REVEALED_CHEER_TO_WAITING_ROOM';
export const S_SD1_019_SELECT_AQOURS_LIVE_CHEER_TO_HAND_STEP_ID =
  'S_SD1_019_SELECT_REVEALED_CHEER_AQOURS_LIVE_TO_HAND';
export const S_BP2_021_SELECT_REVEALED_CHEER_LIVE_TO_DECK_BOTTOM_STEP_ID =
  'S_BP2_021_SELECT_REVEALED_CHEER_LIVE_TO_DECK_BOTTOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface RevealedCheerSelectionStartConditionResult {
  readonly conditionMet: boolean;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export type ResolvePendingCardEffects = (game: GameState) => { readonly gameState: GameState };

interface RevealedCheerSelectionWorkflowConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly predicate?: CheerCardPredicate;
  readonly destination: RevealedCheerCardDestination;
  readonly optional: boolean;
  readonly confirmWhenNoTargets?: boolean;
  readonly availabilityGate?: LiveSuccessAbilityAvailabilityGate;
  readonly startCondition?: (
    game: GameState,
    playerId: string,
    ability: PendingAbilityState
  ) => RevealedCheerSelectionStartConditionResult;
  readonly selectMin?: number;
  readonly selectMax?: number;
  readonly additionalCheerEqualToMoved?: boolean;
  readonly additionalCheerCountFromMovedCards?: (
    game: GameState,
    movedCardIds: readonly string[]
  ) => number;
  readonly recordAbilityUseWhenMoved?: boolean;
  readonly skipSelectionLabel?: string;
}

interface RevealedCheerSelectionStartContext {
  readonly ability: PendingAbilityState;
  readonly options: PendingAbilityStarterOptions;
  readonly orderedResolution: boolean;
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
}

export interface RevealedCheerSelectionWorkflowDependencies {
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
}

export interface SyncHsBp6027ManualCheerAdjustmentOptions {
  readonly allowCreate?: boolean;
}

export interface SyncHsBp6027ManualCheerAdjustmentDependencies {
  readonly resolvePendingCardEffects: ResolvePendingCardEffects;
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
}

const REVEALED_CHEER_SELECTION_WORKFLOWS: readonly RevealedCheerSelectionWorkflowConfig[] = [
  {
    abilityId:
      SP_BP2_025_LIVE_SUCCESS_TWO_DISTINCT_NAMED_STAGE_MEMBERS_REVEALED_CHEER_TO_HAND_ABILITY_ID,
    stepId: 'SP_BP2_025_SELECT_REVEALED_CHEER_TO_HAND',
    stepText: '请选择1张因声援被公开的自己的卡片加入手牌。',
    selectionLabel: '选择要加入手牌的声援公开卡',
    destination: 'HAND',
    optional: false,
    confirmWhenNoTargets: true,
    availabilityGate: ({ game, controllerId }) =>
      hasTwoDistinctTargetNamedStageMembers(game, controllerId),
  },
  {
    abilityId: S_BP2_021_LIVE_SUCCESS_REVEALED_CHEER_LIVE_TO_DECK_BOTTOM_ABILITY_ID,
    stepId: S_BP2_021_SELECT_REVEALED_CHEER_LIVE_TO_DECK_BOTTOM_STEP_ID,
    stepText: '请选择至多1张因声援被公开的自己的LIVE卡放置于入卡组底。',
    selectionLabel: '选择要放置于入卡组底的声援公开 LIVE',
    predicate: typeIs(CardType.LIVE),
    destination: 'MAIN_DECK_BOTTOM',
    optional: true,
    confirmWhenNoTargets: true,
    selectMin: 0,
    selectMax: 1,
    skipSelectionLabel: '不放置',
  },
  {
    abilityId: S_SD1_019_LIVE_SUCCESS_AQOURS_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID,
    stepId: S_SD1_019_SELECT_AQOURS_LIVE_CHEER_TO_HAND_STEP_ID,
    stepText: '请选择1张因声援被公开的『Aqours』LIVE卡加入手牌。',
    selectionLabel: '选择要加入手牌的声援公开 Aqours LIVE',
    predicate: and(typeIs(CardType.LIVE), groupAliasIs('Aqours')),
    destination: 'HAND',
    optional: false,
  },
  {
    abilityId: HS_BP1_021_LIVE_SUCCESS_HASUNOSORA_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID,
    stepId: 'HS_BP1_021_SELECT_HASUNOSORA_LIVE_CHEER_TO_HAND',
    stepText: '请选择1张因声援被公开的自己的『莲之空』LIVE卡加入手牌。',
    selectionLabel: '选择要加入手牌的声援公开莲之空 LIVE',
    predicate: and(typeIs(CardType.LIVE), groupAliasIs('蓮ノ空')),
    destination: 'HAND',
    optional: false,
    startCondition: (game, playerId, ability) => {
      const condition = evaluateCurrentLiveRevealedCheerCardCondition(game, playerId, {
        minCount: 1,
        cardTypes: CardType.LIVE,
        groupAliases: ['蓮ノ空'],
      });
      return {
        conditionMet: condition.conditionMet,
        payload: {
          revealedCheerFactCardIds: condition.matchingCardIds,
          revealedCheerFactCount: condition.matchingCount,
        },
      };
    },
  },
  {
    abilityId: HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
    stepId: HS_BP6_001_SELECT_CHEER_TO_TOP_STEP_ID,
    stepText: '请选择1张因声援被公开的自己的卡片放置到卡组顶。也可以选择不放置。',
    selectionLabel: '选择要放回卡组顶的声援公开卡',
    destination: 'MAIN_DECK_TOP',
    optional: true,
    skipSelectionLabel: '不放置',
  },
  {
    abilityId: HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
    stepId: HS_CL1_009_SELECT_CHEER_MEMBER_TO_HAND_STEP_ID,
    stepText: '请选择1张因声援被公开的费用4-9成员卡加入手牌。',
    selectionLabel: '选择要加入手牌的声援公开成员',
    predicate: (card) => isMemberCardData(card.data) && costGte(4)(card) && costLte(9)(card),
    destination: 'HAND',
    optional: false,
  },
  {
    abilityId: HS_BP6_032_LIVE_SUCCESS_LOW_COST_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID,
    stepId: HS_BP6_032_SELECT_LOW_COST_CHEER_MEMBER_TO_HAND_STEP_ID,
    stepText: '请选择1张因声援被公开的费用4以下成员卡加入手牌。',
    selectionLabel: '选择要加入手牌的声援公开低费成员',
    predicate: (card) => isMemberCardData(card.data) && costLte(4)(card),
    destination: 'HAND',
    optional: false,
  },
  {
    abilityId: HS_BP6_005_LIVE_SUCCESS_DOLLCHESTRA_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID,
    stepId: HS_BP6_005_SELECT_DOLLCHESTRA_CHEER_MEMBER_TO_HAND_STEP_ID,
    stepText: '请选择1张因声援被公开的 DOLLCHESTRA 成员卡加入手牌。',
    selectionLabel: '选择要加入手牌的声援公开 DOLLCHESTRA 成员',
    predicate: (card) => isMemberCardData(card.data) && unitAliasIs('DOLLCHESTRA')(card),
    destination: 'HAND',
    optional: false,
  },
  {
    abilityId:
      HS_CL1_012_LIVE_SUCCESS_EQUAL_SCORE_REVEALED_CHEER_HIGH_COST_MEMBER_TO_HAND_ABILITY_ID,
    stepId: HS_CL1_012_SELECT_HIGH_COST_CHEER_MEMBER_TO_HAND_STEP_ID,
    stepText: '请选择1张因声援被公开的费用9以上成员卡加入手牌。',
    selectionLabel: '选择要加入手牌的声援公开高费成员',
    predicate: (card) => isMemberCardData(card.data) && costGte(9)(card),
    destination: 'HAND',
    optional: false,
    startCondition: liveScoresAreEqual,
  },
  {
    abilityId: HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
    stepId: HS_BP6_027_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID,
    stepText:
      '请选择至多3张因声援被公开的自己的不持有 BLADE HEART 的「莲之空」卡片放置入休息室。之后追加等量声援。',
    selectionLabel: '选择要放置入休息室的声援公开卡',
    predicate: selectHsBp6027CheerCard,
    destination: 'WAITING_ROOM',
    optional: true,
    selectMin: 0,
    selectMax: 3,
    additionalCheerEqualToMoved: true,
    recordAbilityUseWhenMoved: true,
    skipSelectionLabel: '不放置',
  },
  {
    abilityId: S_BP6_021_ON_CHEER_SEND_NO_BLADE_AQOURS_MEMBER_ADDITIONAL_CHEER_ABILITY_ID,
    stepId: S_BP6_021_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID,
    stepText:
      '请选择至多1张因声援被公开的自己的不持有 BLADE HEART 的『Aqours』成员卡放置入休息室。之后按该成员费用每5点追加1次声援，最多4次。',
    selectionLabel: '选择要放置入休息室的声援公开成员',
    predicate: selectSBp6021CheerCard,
    destination: 'WAITING_ROOM',
    optional: true,
    selectMin: 0,
    selectMax: 1,
    additionalCheerCountFromMovedCards: countSBp6021AdditionalCheer,
    recordAbilityUseWhenMoved: true,
    skipSelectionLabel: '不放置',
  },
];

export function registerRevealedCheerSelectionWorkflowHandlers(
  dependencies: RevealedCheerSelectionWorkflowDependencies
): void {
  for (const config of REVEALED_CHEER_SELECTION_WORKFLOWS) {
    if (config.availabilityGate) {
      registerLiveSuccessAbilityAvailabilityGate(config.abilityId, config.availabilityGate);
    }
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startRevealedCheerSelectionWorkflow(game, config, {
        ability,
        options,
        orderedResolution: options.orderedResolution === true,
        continuePendingCardEffects: context.continuePendingCardEffects,
      })
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input) =>
      finishRevealedCheerSelectionWorkflow(
        game,
        config,
        isMultiSelectRevealedCheerConfig(config)
          ? (input.selectedCardIds ?? [])
          : (input.selectedCardId ?? null),
        dependencies.continuePendingCardEffects
      )
    );
  }
}

const SP_BP2_025_TARGET_MEMBER_NAMES = [
  '澁谷かのん',
  'ウィーン・マルガレーテ',
  '鬼塚冬毬',
] as const;

function hasTwoDistinctTargetNamedStageMembers(game: GameState, playerId: string): boolean {
  const stageMemberCardIds = getStageMemberCardIdsMatching(game, playerId, (card) =>
    SP_BP2_025_TARGET_MEMBER_NAMES.some((name) => cardNameAliasMatches(card.data, name))
  );
  return stageMemberCardIds.some((firstCardId, firstIndex) => {
    const firstCard = getCardById(game, firstCardId);
    if (!firstCard) {
      return false;
    }
    return stageMemberCardIds.slice(firstIndex + 1).some((secondCardId) => {
      const secondCard = getCardById(game, secondCardId);
      if (!secondCard) {
        return false;
      }
      return SP_BP2_025_TARGET_MEMBER_NAMES.some(
        (firstName) =>
          cardNameAliasMatches(firstCard.data, firstName) &&
          SP_BP2_025_TARGET_MEMBER_NAMES.some(
            (secondName) =>
              secondName !== firstName && cardNameAliasMatches(secondCard.data, secondName)
          )
      );
    });
  });
}

export function syncHsBp6027ManualCheerAdjustment(
  game: GameState,
  playerId: string,
  options: SyncHsBp6027ManualCheerAdjustmentOptions = {},
  dependencies: SyncHsBp6027ManualCheerAdjustmentDependencies
): GameState {
  const activeEffect = game.activeEffect;
  if (isHsBp6027CheerSelectionEffect(activeEffect)) {
    return refreshHsBp6027ManualCheerSelection(
      game,
      activeEffect,
      dependencies.continuePendingCardEffects
    );
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
    ).find(
      (ability) =>
        ability.abilityId === HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID &&
        ability.triggerCondition === TriggerCondition.ON_CHEER
    );
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

  return dependencies.resolvePendingCardEffects(state).gameState;
}

function startRevealedCheerSelectionWorkflow(
  game: GameState,
  config: RevealedCheerSelectionWorkflowConfig,
  context: RevealedCheerSelectionStartContext
): GameState {
  const player = getPlayerById(game, context.ability.controllerId);
  if (!player) {
    return game;
  }

  const startCondition = config.startCondition?.(game, player.id, context.ability);
  if (startCondition && !startCondition.conditionMet) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== context.ability.id
      ),
    };
    return context.continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: context.ability.id,
        abilityId: context.ability.abilityId,
        sourceCardId: context.ability.sourceCardId,
        step: 'CONDITION_NOT_MET',
        ...startCondition.payload,
      }),
      context.orderedResolution
    );
  }

  const selectableCardIds = selectRevealedCheerCardIds(game, player.id, config.predicate);
  if (selectableCardIds.length === 0) {
    if (config.confirmWhenNoTargets === true) {
      const manualConfirmation = maybeStartConfirmablePendingAbilityConfirmation(
        game,
        context.ability,
        context.options
      );
      if (manualConfirmation) {
        return manualConfirmation;
      }
    }
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== context.ability.id
      ),
    };
    return context.continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: context.ability.id,
        abilityId: context.ability.abilityId,
        sourceCardId: context.ability.sourceCardId,
        step: 'NO_REVEALED_CHEER_TARGET',
        ...startCondition?.payload,
      }),
      context.orderedResolution
    );
  }

  const selectMin = config.selectMin ?? (config.optional ? 0 : 1);
  const selectMax = Math.min(config.selectMax ?? 1, selectableCardIds.length);
  const useMultiSelect =
    selectMax > 1 || config.selectMin !== undefined || config.selectMax !== undefined;

  const state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== context.ability.id
    ),
    activeEffect: {
      id: context.ability.id,
      abilityId: context.ability.abilityId,
      sourceCardId: context.ability.sourceCardId,
      controllerId: context.ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: useMultiSelect ? 'ORDERED_MULTI' : 'SINGLE',
      minSelectableCards: useMultiSelect ? selectMin : undefined,
      maxSelectableCards: useMultiSelect ? selectMax : undefined,
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: getConfirmSelectionLabel(config.destination),
      canSkipSelection: config.optional,
      skipSelectionLabel: config.skipSelectionLabel,
      metadata: {
        cheerRevealedCardSelection: true,
        destination: config.destination,
        additionalCheerEqualToMoved: config.additionalCheerEqualToMoved === true,
        orderedResolution: context.orderedResolution,
        ...startCondition?.payload,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: context.ability.id,
    abilityId: context.ability.abilityId,
    sourceCardId: context.ability.sourceCardId,
    step: 'START_SELECT_REVEALED_CHEER_CARD',
    selectableCardIds,
    destination: config.destination,
    ...startCondition?.payload,
  });
}

function finishRevealedCheerSelectionWorkflow(
  game: GameState,
  config: RevealedCheerSelectionWorkflowConfig,
  selectedCardIdOrIds: string | readonly string[] | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.metadata?.cheerRevealedCardSelection !== true) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const destination = getEffectDestination(effect);
  if (!destination || destination !== config.destination) {
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
      effect.metadata?.orderedResolution === true
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
  if (config.recordAbilityUseWhenMoved === true && moveResult.movedCardIds.length > 0) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    });
  }
  const additionalCheerCount =
    config.additionalCheerCountFromMovedCards?.(state, moveResult.movedCardIds) ??
    (effect.metadata?.additionalCheerEqualToMoved === true ? moveResult.movedCardIds.length : 0);
  let additionalCheerCardIds: readonly string[] = [];
  if (additionalCheerCount > 0) {
    const cheerResult = revealCheerCardsFromMainDeck(state, player.id, additionalCheerCount, {
      automated: true,
      additional: true,
    });
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
      additionalCheerCount,
      destination,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function refreshHsBp6027ManualCheerSelection(
  game: GameState,
  activeEffect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects
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
      activeEffect.metadata?.orderedResolution === true
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

function isHsBp6027CheerSelectionEffect(
  effect: ActiveEffectState | null
): effect is ActiveEffectState {
  return (
    effect?.abilityId === HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID &&
    effect.stepId === HS_BP6_027_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID
  );
}

function selectHsBp6027CheerCardIds(game: GameState, playerId: string): readonly string[] {
  return selectRevealedCheerCardIds(game, playerId, selectHsBp6027CheerCard);
}

function selectHsBp6027CheerCard(card: Parameters<CheerCardPredicate>[0]): boolean {
  return and(groupAliasIs('蓮ノ空'), not(hasBladeHeart()))(card);
}

function selectSBp6021CheerCard(card: Parameters<CheerCardPredicate>[0]): boolean {
  return and(typeIs(CardType.MEMBER), groupAliasIs('Aqours'), not(hasBladeHeart()))(card);
}

function countSBp6021AdditionalCheer(game: GameState, movedCardIds: readonly string[]): number {
  const cheerCount = movedCardIds.reduce((total, cardId) => {
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data)) {
      return total;
    }
    return total + Math.floor(card.data.cost / 5);
  }, 0);
  return Math.min(4, cheerCount);
}

function liveScoresAreEqual(
  game: GameState,
  playerId: string
): RevealedCheerSelectionStartConditionResult {
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  const ownScore = game.liveResolution.playerScores.get(playerId) ?? 0;
  const opponentScore = opponent ? (game.liveResolution.playerScores.get(opponent.id) ?? 0) : 0;
  return {
    conditionMet: ownScore === opponentScore,
    payload: {
      ownScore,
      opponentScore,
    },
  };
}

function isMultiSelectRevealedCheerConfig(config: RevealedCheerSelectionWorkflowConfig): boolean {
  return config.selectMin !== undefined || config.selectMax !== undefined;
}

function getEffectDestination(effect: ActiveEffectState): RevealedCheerCardDestination | null {
  return effect.metadata?.destination === 'HAND' ||
    effect.metadata?.destination === 'MAIN_DECK_TOP' ||
    effect.metadata?.destination === 'MAIN_DECK_BOTTOM' ||
    effect.metadata?.destination === 'WAITING_ROOM'
    ? effect.metadata.destination
    : null;
}

function getConfirmSelectionLabel(destination: RevealedCheerCardDestination): string {
  if (destination === 'HAND') {
    return '加入手牌';
  }
  if (destination === 'WAITING_ROOM') {
    return '放置入休息室';
  }
  if (destination === 'MAIN_DECK_BOTTOM') {
    return '放置于入卡组底';
  }
  return '放回卡组顶';
}

function hasAbilityInstance(game: GameState, abilityInstanceId: string): boolean {
  return (
    game.pendingAbilities.some((ability) => ability.id === abilityInstanceId) ||
    game.activeEffect?.id === abilityInstanceId ||
    game.actionHistory.some(
      (historyAction) =>
        historyAction.type === 'RESOLVE_ABILITY' &&
        historyAction.payload.pendingAbilityId === abilityInstanceId
    )
  );
}

function getQueuedAbilityDefinitionsForCard(
  cardCode: string | undefined,
  category: CardAbilityCategory,
  sourceZone: CardAbilitySourceZone
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitions(cardCode).filter(
    (ability) =>
      ability.category === category &&
      ability.sourceZone === sourceZone &&
      ability.queued === true &&
      ability.implemented === true
  );
}

function getCardAbilityDefinitions(cardCode: string | undefined): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitionsForCardCode(cardCode);
}
