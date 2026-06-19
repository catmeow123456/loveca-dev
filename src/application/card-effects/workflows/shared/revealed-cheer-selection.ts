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
  getBaseCardCode,
  normalizeCardCode,
} from '../../../../shared/utils/card-code.js';
import {
  and,
  costGte,
  costLte,
  groupAliasIs,
  hasBladeHeart,
  not,
} from '../../../effects/card-selectors.js';
import { revealCheerCardsFromMainDeck } from '../../../effects/cheer.js';
import {
  moveRevealedCheerCards,
  selectRevealedCheerCardIds,
  type CheerCardPredicate,
  type RevealedCheerCardDestination,
} from '../../../effects/cheer-selection.js';
import {
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
  HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
  HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
} from '../../ability-ids.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../../ability-definition-types.js';
import { CARD_ABILITY_DEFINITIONS } from '../../definitions/index.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
} from '../../runtime/workflow-helpers.js';

export const HS_BP6_001_SELECT_CHEER_TO_TOP_STEP_ID =
  'HS_BP6_001_SELECT_REVEALED_CHEER_TO_TOP';
export const HS_CL1_009_SELECT_CHEER_MEMBER_TO_HAND_STEP_ID =
  'HS_CL1_009_SELECT_REVEALED_CHEER_MEMBER_TO_HAND';
export const HS_BP6_027_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID =
  'HS_BP6_027_SELECT_REVEALED_CHEER_TO_WAITING_ROOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export type ResolvePendingCardEffects = (game: GameState) => { readonly gameState: GameState };

interface RevealedCheerSelectionWorkflowConfig {
  readonly abilityId: string;
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
}

interface RevealedCheerSelectionStartContext {
  readonly ability: PendingAbilityState;
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
    skipSelectionLabel: '不放置',
  },
];

export function registerRevealedCheerSelectionWorkflowHandlers(
  dependencies: RevealedCheerSelectionWorkflowDependencies
): void {
  for (const config of REVEALED_CHEER_SELECTION_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startRevealedCheerSelectionWorkflow(game, config, {
        ability,
        orderedResolution: options.orderedResolution === true,
        continuePendingCardEffects: context.continuePendingCardEffects,
      })
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input) =>
      finishRevealedCheerSelectionWorkflow(
        game,
        config,
        config.stepId === HS_BP6_027_SELECT_CHEER_TO_WAITING_ROOM_STEP_ID
          ? (input.selectedCardIds ?? [])
          : (input.selectedCardId ?? null),
        dependencies.continuePendingCardEffects
      )
    );
  }
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

  const selectableCardIds = selectRevealedCheerCardIds(game, player.id, config.predicate);
  if (selectableCardIds.length === 0) {
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

function getEffectDestination(effect: ActiveEffectState): RevealedCheerCardDestination | null {
  return effect.metadata?.destination === 'HAND' ||
    effect.metadata?.destination === 'MAIN_DECK_TOP' ||
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
  if (!cardCode) {
    return [];
  }
  return CARD_ABILITY_DEFINITIONS.filter((definition) =>
    doesAbilityDefinitionMatchCardCode(definition, cardCode)
  );
}

function doesAbilityDefinitionMatchCardCode(
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
