import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { isLiveCardData } from '../../../../domain/entities/card.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_SD2_027_LIVE_START_WAIT_UP_TO_THREE_NIJIGASAKI_SCORE_PER_WAITED_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { waitStageMembersAndEnqueueTriggers } from '../../runtime/wait-stage-members.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!N-sd2-027';
const SELECT_MEMBERS_STEP_ID = 'PL_N_SD2_027_SELECT_NIJIGASAKI_MEMBERS_TO_WAIT';
const MAX_TARGET_COUNT = 3;
const nijigasakiMember = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNSd2027KetsuiNoHikariWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    N_SD2_027_LIVE_START_WAIT_UP_TO_THREE_NIJIGASAKI_SCORE_PER_WAITED_ABILITY_ID,
    (game, ability, options, context) =>
      start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    N_SD2_027_LIVE_START_WAIT_UP_TO_THREE_NIJIGASAKI_SCORE_PER_WAITED_ABILITY_ID,
    SELECT_MEMBERS_STEP_ID,
    (game, input, context) =>
      finish(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = sourceIsValid(game, player.id, ability.sourceCardId)
    ? getWaitableNijigasakiMemberCardIds(game, player.id)
    : [];
  if (selectableCardIds.length === 0) {
    return consume(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_WAITABLE_NIJIGASAKI_STAGE_MEMBERS',
      selectedMemberCardIds: [],
      actuallyWaitedMemberCardIds: [],
      memberStateChangedEventIds: [],
      requestedCount: 0,
      actualWaitedCount: 0,
      scoreBonus: 0,
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_MEMBERS_STEP_ID,
      stepText: '可以将自己舞台上至多3名『虹咲』成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: Math.min(MAX_TARGET_COUNT, selectableCardIds.length),
      selectionLabel: '选择要变为待机状态的成员',
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NIJIGASAKI_MEMBERS_TO_WAIT',
      selectableCardIds,
      maxSelectableCards: Math.min(MAX_TARGET_COUNT, selectableCardIds.length),
    },
  });
}

function finish(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      N_SD2_027_LIVE_START_WAIT_UP_TO_THREE_NIJIGASAKI_SCORE_PER_WAITED_ABILITY_ID ||
    effect.stepId !== SELECT_MEMBERS_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > MAX_TARGET_COUNT ||
    uniqueSelectedCardIds.some((cardId) => effect.selectableCardIds?.includes(cardId) !== true)
  ) {
    return game;
  }
  if (!sourceIsValid(game, player.id, effect.sourceCardId)) {
    return finishNoOp(game, effect, continuePendingCardEffects, {
      step: 'SOURCE_LIVE_NO_LONGER_VALID',
      selectedMemberCardIds: uniqueSelectedCardIds,
    });
  }

  const currentlyEligibleCardIds = getWaitableNijigasakiMemberCardIds(game, player.id);
  const waitResult = waitStageMembersAndEnqueueTriggers(game, {
    playerId: player.id,
    memberCardIds: uniqueSelectedCardIds.filter((cardId) =>
      currentlyEligibleCardIds.includes(cardId)
    ),
    cause: {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    },
    enqueueTriggeredCardEffects,
  });
  const scoreBonus = waitResult.actuallyWaitedMemberCardIds.length;
  const stateWithScore = replaceScoreModifierAndRefresh(waitResult.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    scoreBonus,
  });

  return continuePendingCardEffects(
    addAction({ ...stateWithScore, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: scoreBonus > 0 ? 'WAIT_NIJIGASAKI_MEMBERS_GAIN_SCORE' : 'NO_MEMBERS_WAITED',
      selectedMemberCardIds: uniqueSelectedCardIds,
      actuallyWaitedMemberCardIds: waitResult.actuallyWaitedMemberCardIds,
      memberStateChangedEventIds: waitResult.memberStateChangedEventIds,
      requestedCount: uniqueSelectedCardIds.length,
      actualWaitedCount: scoreBonus,
      scoreBonus,
      liveCardId: effect.sourceCardId,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getWaitableNijigasakiMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, nijigasakiMember).filter(
    (cardId) => player?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function sourceIsValid(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    isLiveCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function replaceScoreModifierAndRefresh(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly sourceCardId: string;
    readonly abilityId: string;
    readonly scoreBonus: number;
  }
): GameState {
  const previousScoreBonus = game.liveResolution.liveModifiers
    .filter(
      (modifier) =>
        modifier.kind === 'SCORE' &&
        modifier.playerId === options.playerId &&
        modifier.liveCardId === options.sourceCardId &&
        modifier.sourceCardId === options.sourceCardId &&
        modifier.abilityId === options.abilityId
    )
    .reduce((sum, modifier) => sum + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null =
    options.scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: options.playerId,
          countDelta: options.scoreBonus,
          liveCardId: options.sourceCardId,
          sourceCardId: options.sourceCardId,
          abilityId: options.abilityId,
        }
      : null;
  const state = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      playerId: options.playerId,
      liveCardId: options.sourceCardId,
      sourceCardId: options.sourceCardId,
      abilityId: options.abilityId,
    },
    replacement
  );
  const playerScores = new Map(state.liveResolution.playerScores);
  playerScores.set(
    options.playerId,
    (playerScores.get(options.playerId) ?? 0) + options.scoreBonus - previousScoreBonus
  );
  return {
    ...state,
    liveResolution: {
      ...state.liveResolution,
      playerScores,
    },
  };
}

function consume(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function finishNoOp(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
