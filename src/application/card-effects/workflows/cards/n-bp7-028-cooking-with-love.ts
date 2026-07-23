import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_BP7_028_LIVE_START_SHUFFLE_WAITING_ROOM_BOTTOM_STAGE_NIJIGASAKI_GAIN_PINK_HEART_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { shuffleWaitingRoomCardsToDeckBottomForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID =
  N_BP7_028_LIVE_START_SHUFFLE_WAITING_ROOM_BOTTOM_STAGE_NIJIGASAKI_GAIN_PINK_HEART_ABILITY_ID;
const EXACT_CARD_CODE = 'PL!N-bp7-028-L';
const ACTIVATE_STEP_ID = 'N_BP7_028_SHUFFLE_WAITING_ROOM_BOTTOM_OPTION';

const nijigasakiLive = and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲'));
const nijigasakiMemberWithoutBladeHeart = and(
  typeIs(CardType.MEMBER),
  groupAliasIs('虹ヶ咲'),
  not(hasBladeHeart())
);
const nijigasakiMember = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface WaitingRoomCondition {
  readonly nijigasakiLiveCardIds: readonly string[];
  readonly nijigasakiMemberWithoutBladeHeartCardIds: readonly string[];
  readonly conditionMet: boolean;
}

export function registerNBp7028CookingWithLoveWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startCookingWithLove(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, ACTIVATE_STEP_ID, (game, input, context) => {
    if (input.selectedOptionId === 'activate') {
      return finishCookingWithLove(game, context.continuePendingCardEffects);
    }
    if (input.selectedOptionId === null || input.selectedOptionId === undefined) {
      return finishSkippedActiveEffect(game, context.continuePendingCardEffects);
    }
    return game;
  });
}

function startCookingWithLove(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceValid = isValidSourceLive(game, ability.controllerId, ability.sourceCardId);
  const waitingRoomCondition = getWaitingRoomCondition(game, ability.controllerId);
  if (!player || !sourceValid || !waitingRoomCondition.conditionMet) {
    return consumePendingNoOp(game, ability, orderedResolution, continuePendingCardEffects, {
      step: sourceValid ? 'CONDITION_NOT_MET_AT_START' : 'SOURCE_INVALID_AT_START',
      sourceValid,
      ...waitingRoomCondition,
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: ACTIVATE_STEP_ID,
      stepText:
        '可以将自己的休息室中的所有卡片洗牌并放置于卡组底，使自己舞台上的所有『虹咲』成员获得[桃ハート]。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'activate', label: '发动' }],
      confirmSelectionLabel: '发动',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SHUFFLE_WAITING_ROOM_BOTTOM_OPTION',
      ...waitingRoomCondition,
    },
  });
}

function finishCookingWithLove(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== ACTIVATE_STEP_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceValid = isValidSourceLive(game, effect.controllerId, effect.sourceCardId);
  const waitingRoomCondition = getWaitingRoomCondition(game, effect.controllerId);
  if (!player || !sourceValid || !waitingRoomCondition.conditionMet) {
    return resolveActiveEffectNoOp(game, effect, continuePendingCardEffects, {
      step: sourceValid ? 'CONDITION_NOT_MET_AT_CONFIRM' : 'SOURCE_INVALID_AT_CONFIRM',
      sourceValid,
      ...waitingRoomCondition,
    });
  }

  const waitingRoomCardIds = [...player.waitingRoom.cardIds];
  const targetMemberCardIds = getStageMemberCardIdsMatching(game, player.id, nijigasakiMember);
  const shuffleResult = shuffleWaitingRoomCardsToDeckBottomForPlayer(
    game,
    player.id,
    waitingRoomCardIds
  );
  if (!shuffleResult) {
    return game;
  }

  let state = shuffleResult.gameState;
  for (const memberCardId of targetMemberCardIds) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
    if (!heartResult) {
      return game;
    }
    state = heartResult.gameState;
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SHUFFLE_WAITING_ROOM_BOTTOM_AND_GAIN_PINK_HEART',
      originalWaitingRoomCardIds: shuffleResult.originalCardIds,
      movedWaitingRoomCardIds: shuffleResult.movedCardIds,
      targetMemberCardIds,
      pinkHeartCountPerMember: 1,
      sourceValid,
      ...waitingRoomCondition,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getWaitingRoomCondition(game: GameState, playerId: string): WaitingRoomCondition {
  const nijigasakiLiveCardIds = getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    nijigasakiLive
  );
  const nijigasakiMemberWithoutBladeHeartCardIds = getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    nijigasakiMemberWithoutBladeHeart
  );
  return {
    nijigasakiLiveCardIds,
    nijigasakiMemberWithoutBladeHeartCardIds,
    conditionMet:
      nijigasakiLiveCardIds.length > 0 && nijigasakiMemberWithoutBladeHeartCardIds.length > 0,
  };
}

function isValidSourceLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    isLiveCardData(source.data) &&
    source.data.cardCode === EXACT_CARD_CODE &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function resolveActiveEffectNoOp(
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

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}
