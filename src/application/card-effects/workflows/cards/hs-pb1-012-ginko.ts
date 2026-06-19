import {
  addAction,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  addBladeLiveModifierForSourceMember,
  recoverCardsFromWaitingRoomToHandForPlayer,
  shuffleWaitingRoomCardsToDeckBottomForPlayer,
} from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_PB1_012_RECYCLE_CONFIRM_STEP_ID = 'HS_PB1_012_RECYCLE_MEMBERS_CONFIRM';
export const HS_PB1_012_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'HS_PB1_012_SELECT_WAITING_ROOM_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPb1012GinkoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
    (game, ability, options) =>
      startHsPb1012OnEnterRecycleMembers(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
    HS_PB1_012_RECYCLE_CONFIRM_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'continue'
        ? finishHsPb1012RecycleWaitingRoomMembers(game, context.continuePendingCardEffects)
        : game
  );
  registerActiveEffectStepHandler(
    HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
    HS_PB1_012_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input, context) =>
      finishHsPb1012RecoverLiveAndGainBlade(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsPb1012OnEnterRecycleMembers(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
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

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID
      ),
      stepId: HS_PB1_012_RECYCLE_CONFIRM_STEP_ID,
      stepText: `双方将休息室成员洗回卡组底：自己${ownWaitingRoomMemberCardIds.length}张，对方${opponentWaitingRoomMemberCardIds.length}张，合计${totalWaitingRoomMemberCount}张。`,
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'continue', label: '继续处理' }],
      metadata: {
        orderedResolution,
        ownWaitingRoomMemberCardIds,
        opponentWaitingRoomMemberCardIds,
        totalWaitingRoomMemberCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_RECYCLE_BOTH_WAITING_ROOM_MEMBERS',
      ownWaitingRoomMemberCardIds,
      opponentWaitingRoomMemberCardIds,
      totalWaitingRoomMemberCount,
    },
  });
}

function finishHsPb1012RecycleWaitingRoomMembers(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
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
  const orderedResolution = effect.metadata?.orderedResolution === true;

  if (totalMovedMemberCount < 20) {
    const state = { ...opponentRecycleResult.gameState, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        ...baseAction,
        step: 'RECYCLE_MEMBERS_CONDITION_NOT_MET',
      }),
      orderedResolution
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
      orderedResolution
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
        effectText: getAbilityEffectText(
          HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID
        ),
        stepId: HS_PB1_012_SELECT_WAITING_ROOM_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张LIVE卡加入手牌。之后获得BLADE +2。',
        awaitingPlayerId: player.id,
        selectableCardIds: selectableLiveCardIds,
        canSkipSelection: false,
        metadata: {
          orderedResolution,
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
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
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
    effect.metadata?.orderedResolution === true
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
