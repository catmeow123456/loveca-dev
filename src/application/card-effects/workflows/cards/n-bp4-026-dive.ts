import {
  addAction,
  addLiveSetLimitReduction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, FaceState, GamePhase } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  PL_N_BP4_026_AUTO_FACE_UP_LIVE_ZONE_NIJIGASAKI_MEMBER_BLADE_ABILITY_ID,
  PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  addBladeLiveModifierForSourceMember,
  placeHandLiveCardInLiveZoneForPlayer,
} from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DIVE_LIVE_STEP_ID = 'PL_N_BP4_026_SELECT_DIVE_LIVE_TO_PLACE_FACE_UP';
const SELECT_NIJIGASAKI_MEMBER_STEP_ID = 'PL_N_BP4_026_SELECT_NIJIGASAKI_MEMBER_BLADE_TARGET';
const DIVE_CARD_NAME = 'DIVE!';
const BLADE_BONUS = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const nijigasakiMember = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));

export function registerNBp4026DiveWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startWaitingRoomToHandPlaceDiveLive(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
    SELECT_DIVE_LIVE_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishPlaceDiveLive(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects
          )
        : finishDeclinePlaceDiveLive(game, context.continuePendingCardEffects)
  );
  registerPendingAbilityStarterHandler(
    PL_N_BP4_026_AUTO_FACE_UP_LIVE_ZONE_NIJIGASAKI_MEMBER_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startFaceUpLiveZoneNijigasakiBlade(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_026_AUTO_FACE_UP_LIVE_ZONE_NIJIGASAKI_MEMBER_BLADE_ABILITY_ID,
    SELECT_NIJIGASAKI_MEMBER_STEP_ID,
    (game, input, context) =>
      finishNijigasakiMemberBlade(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startWaitingRoomToHandPlaceDiveLive(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  if (
    !player ||
    !sourceCard ||
    !isOwnMainPhase(game, player.id) ||
    !player.hand.cardIds.includes(ability.sourceCardId) ||
    !isDiveLiveCard(game, ability.sourceCardId)
  ) {
    return consumePendingAndContinue(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_OP_WAITING_TO_HAND_PLACE_DIVE',
      reason: !player
        ? 'MISSING_PLAYER'
        : !isOwnMainPhase(game, player.id)
          ? 'NOT_OWN_MAIN_PHASE'
          : 'SOURCE_NOT_LEGAL_IN_HAND',
    });
  }

  const selectableCardIds = getDiveLiveHandCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consumePendingAndContinue(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_OP_WAITING_TO_HAND_PLACE_DIVE',
      reason: 'NO_DIVE_LIVE_HAND_TARGET',
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
      stepId: SELECT_DIVE_LIVE_STEP_ID,
      stepText: '可以选择手牌中1张「DIVE!」LIVE卡，正面放置到LIVE卡置场。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要正面放置的「DIVE!」LIVE',
      confirmSelectionLabel: '正面放置',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        orderedResolution,
        selectableCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DIVE_LIVE_TO_PLACE_FACE_UP',
      selectableCardIds,
    },
  });
}

function finishPlaceDiveLive(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_DIVE_LIVE_STEP_ID ||
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const selectableCardIds = getDiveLiveHandCardIds(game, player.id);
  if (!selectableCardIds.includes(selectedCardId)) {
    return game;
  }

  const placeResult = placeHandLiveCardInLiveZoneForPlayer(game, player.id, selectedCardId, {
    candidateCardIds: selectableCardIds,
    face: FaceState.FACE_UP,
  });
  if (!placeResult) {
    return game;
  }

  const stateWithReduction = addLiveSetLimitReduction(placeResult.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: 1,
    expiresAt: 'NEXT_LIVE_SET_PHASE',
  });

  return continuePendingCardEffects(
    addAction({ ...stateWithReduction, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_DIVE_LIVE_FACE_UP_AND_REDUCE_NEXT_LIVE_SET_LIMIT',
      selectedCardId: placeResult.movedCardId,
      selectedCardIds: [placeResult.movedCardId],
      enterLiveZoneEventId: placeResult.enterLiveZoneEvent.eventId,
      nextLiveSetLimitReduction: 1,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishDeclinePlaceDiveLive(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_DIVE_LIVE_STEP_ID ||
    !player
  ) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DECLINE_PLACE_DIVE_LIVE',
      selectedCardIds: [],
      nextLiveSetLimitReduction: 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startFaceUpLiveZoneNijigasakiBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !isSourceFaceUpInOwnLiveZone(game, player.id, ability.sourceCardId)) {
    return consumePendingAndContinue(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_OP_FACE_UP_LIVE_ZONE_BLADE',
      reason: player ? 'SOURCE_NOT_FACE_UP_IN_LIVE_ZONE' : 'MISSING_PLAYER',
    });
  }

  const targetMemberCardIds = getNijigasakiStageMemberCardIds(game, player.id);
  if (targetMemberCardIds.length === 0) {
    return consumePendingAndContinue(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_OP_FACE_UP_LIVE_ZONE_BLADE',
      reason: 'NO_NIJIGASAKI_STAGE_MEMBER',
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
      stepId: SELECT_NIJIGASAKI_MEMBER_STEP_ID,
      stepText: '请选择自己舞台上1名『虹ヶ咲』成员获得[BLADE][BLADE]。',
      awaitingPlayerId: player.id,
      selectableCardIds: targetMemberCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择获得[BLADE][BLADE]的虹咲成员',
      confirmSelectionLabel: '获得[BLADE][BLADE]',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NIJIGASAKI_MEMBER_BLADE',
      selectableCardIds: targetMemberCardIds,
    },
  });
}

function finishNijigasakiMemberBlade(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_026_AUTO_FACE_UP_LIVE_ZONE_NIJIGASAKI_MEMBER_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_NIJIGASAKI_MEMBER_STEP_ID ||
    !player ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const targetMemberCardIds = getNijigasakiStageMemberCardIds(game, player.id);
  if (
    !isSourceFaceUpInOwnLiveZone(game, player.id, effect.sourceCardId) ||
    !targetMemberCardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: BLADE_BONUS,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_NIJIGASAKI_MEMBER_GAIN_BLADE',
      targetMemberCardId: selectedCardId,
      bladeBonus: BLADE_BONUS,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingAndContinue(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(removePending(game, ability.id), 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function removePending(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}

function getDiveLiveHandCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.hand.cardIds.filter((cardId) => isDiveLiveCard(game, cardId));
}

function isDiveLiveCard(game: GameState, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return card?.data.cardType === CardType.LIVE && card.data.name === DIVE_CARD_NAME;
}

function getNijigasakiStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, nijigasakiMember);
}

function isSourceFaceUpInOwnLiveZone(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCardState = player?.liveZone.cardStates.get(sourceCardId);
  return (
    player?.liveZone.cardIds.includes(sourceCardId) === true &&
    sourceCardState?.face === FaceState.FACE_UP
  );
}

function isOwnMainPhase(game: GameState, playerId: string): boolean {
  return (
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId
  );
}
