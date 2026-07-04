import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'HS_SD1_020_LIVE_START_SELECT_HASUNOSORA_MEMBER_DISCARD';
const SELECT_TARGET_STEP_ID = 'HS_SD1_020_LIVE_START_SELECT_BLADE_TARGET';
const MAX_DISCARD_COUNT = 3;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsSd1020LinkToTheFutureWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsSd1020LiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishHsSd1020Discard(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID,
    SELECT_TARGET_STEP_ID,
    (game, input, context) =>
      finishHsSd1020Target(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsSd1020LiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const targetCardIds = getOwnStageMemberCardIds(game, player.id);
  if (targetCardIds.length === 0) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_STAGE_MEMBER_TARGET',
      { targetCardIds }
    );
  }

  const discardCandidateIds = getHasunosoraMemberHandCardIds(game, player.id);
  const maxSelectableCards = Math.min(MAX_DISCARD_COUNT, discardCandidateIds.length);
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText:
        maxSelectableCards > 0
          ? '可以将手牌中的至多3张『莲之空』成员卡放置入休息室。放置后选择自己舞台1名成员获得等量[BLADE]。'
          : '当前没有可放置入休息室的『莲之空』成员卡。可以不放置并继续处理。',
      awaitingPlayerId: player.id,
      selectableCardIds: discardCandidateIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards,
      selectionLabel: '选择要放置入休息室的莲之空成员卡',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HASUNOSORA_MEMBER_DISCARD',
      selectableCardIds: discardCandidateIds,
      maxSelectableCards,
      targetCardIds,
    },
  });
}

function finishHsSd1020Discard(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getHsSd1020Effect(game, SELECT_DISCARD_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  if (selectedCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_ZERO_NO_BLADE',
        discardedHandCardIds: [],
        bladeBonus: 0,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const currentCandidates = getHasunosoraMemberHandCardIds(game, player.id);
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > MAX_DISCARD_COUNT ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true ||
        !currentCandidates.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: uniqueSelectedCardIds.length,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const targetCardIds = getOwnStageMemberCardIds(discardResult.gameState, player.id);
  if (targetCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_NO_STAGE_MEMBER_TARGET',
        discardedHandCardIds: discardResult.discardedCardIds,
        bladeBonus: 0,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: SELECT_TARGET_STEP_ID,
        stepText: `请选择自己舞台上的1名成员获得[BLADE] x ${discardResult.discardedCardIds.length}。`,
        selectableCardIds: targetCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: '选择获得[BLADE]的成员',
        confirmSelectionLabel: '确定',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedHandCardIds: discardResult.discardedCardIds,
          bladeBonus: discardResult.discardedCardIds.length,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_SELECT_BLADE_TARGET',
      discardedHandCardIds: discardResult.discardedCardIds,
      bladeBonus: discardResult.discardedCardIds.length,
      targetCardIds,
    }
  );
}

function finishHsSd1020Target(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getHsSd1020Effect(game, SELECT_TARGET_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const bladeBonus = getNumberMetadata(effect, 'bladeBonus');
  if (
    !effect ||
    !player ||
    !selectedCardId ||
    bladeBonus <= 0 ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getOwnStageMemberCardIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      sourceCardId: selectedCardId,
      abilityId: effect.abilityId,
      amount: bladeBonus,
    }
  );
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_STAGE_MEMBER_GAIN_BLADE',
      discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
      targetMemberCardId: selectedCardId,
      bladeBonus: bladeResult.bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getHsSd1020Effect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function getHasunosoraMemberHandCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  const selector = and(typeIs(CardType.MEMBER), groupAliasIs('蓮ノ空'));
  return player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}

function getOwnStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER));
}

function getStringArrayMetadata(effect: ActiveEffectState, key: string): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function getNumberMetadata(effect: ActiveEffectState | null, key: string): number {
  const value = effect?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
