import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  moveRevealedCheerCards,
  selectRevealedCheerCardIds,
} from '../../../effects/cheer-selection.js';
import { PL_PB1_031_LIVE_SUCCESS_DISCARD_HAND_RECOVER_MUSE_MEMBER_CHEER_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'PL_PB1_031_SELECT_DISCARD_HAND_CARD';
const SELECT_MUSE_CHEER_STEP_ID = 'PL_PB1_031_SELECT_MUSE_MEMBER_CHEER_TO_HAND';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const museMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs("μ's"));

export function registerPlPb1031KaguyaNoShiroDeOdoritaiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_PB1_031_LIVE_SUCCESS_DISCARD_HAND_RECOVER_MUSE_MEMBER_CHEER_ABILITY_ID,
    (game, ability, options, context) =>
      startKaguyaDiscardCost(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_PB1_031_LIVE_SUCCESS_DISCARD_HAND_RECOVER_MUSE_MEMBER_CHEER_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishKaguyaDiscardCost(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD_HAND_CARD',
          })
  );
  registerActiveEffectStepHandler(
    PL_PB1_031_LIVE_SUCCESS_DISCARD_HAND_RECOVER_MUSE_MEMBER_CHEER_ABILITY_ID,
    SELECT_MUSE_CHEER_STEP_ID,
    (game, input, context) =>
      finishKaguyaRecoverMuseCheer(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startKaguyaDiscardCost(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !isSourceLiveInLiveZone(game, ability.controllerId, ability.sourceCardId)) {
    return consumePendingNoOp(
      game,
      ability,
      ability.controllerId,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'SOURCE_NOT_IN_LIVE_ZONE'
    );
  }
  if (player.hand.cardIds.length === 0) {
    return consumePendingNoOp(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'NO_HAND_TO_DISCARD'
    );
  }

  const currentTargetCount = selectMuseMemberCheerCardIds(game, player.id).length;
  const effectText = `${getAbilityEffectText(
    ability.abilityId
  )}（当前手牌 ${player.hand.cardIds.length}张；当前可加入手牌的声援公开『μ's』成员卡 ${currentTargetCount}张。）`;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      ...createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability,
        playerId: player.id,
        effectText,
        stepId: SELECT_DISCARD_STEP_ID,
        selectableCardIds: player.hand.cardIds,
        orderedResolution: options.orderedResolution === true,
        stepText:
          "可以将1张手牌放置入休息室。支付后选择1张因声援公开的自己的『μ's』成员卡加入手牌。",
        selectionLabel: '选择要放置入休息室的手牌',
        skipSelectionLabel: '不发动',
      }),
      confirmSelectionLabel: '放置入休息室',
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_HAND_CARD',
      selectableCardIds: player.hand.cardIds,
      currentTargetCount,
    },
  });
}

function finishKaguyaDiscardCost(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getKaguyaActiveEffect(game, SELECT_DISCARD_STEP_ID);
  if (!effect || effect.selectableCardIds?.includes(discardCardId) !== true) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !isSourceLiveInLiveZone(game, player.id, effect.sourceCardId) ||
    !player.hand.cardIds.includes(discardCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const discardedCardId = discardResult.discardedCardIds[0] ?? discardCardId;
  if (!isSourceLiveInLiveZone(discardResult.gameState, player.id, effect.sourceCardId)) {
    return consumeActiveEffectNoMove(
      discardResult.gameState,
      effect,
      player.id,
      continuePendingCardEffects,
      'DISCARD_HAND_CARD_SOURCE_NOT_IN_LIVE_ZONE',
      {
        discardedCardId,
      }
    );
  }

  const selectableCardIds = selectMuseMemberCheerCardIds(discardResult.gameState, player.id);
  if (selectableCardIds.length === 0) {
    return consumeActiveEffectNoMove(
      discardResult.gameState,
      effect,
      player.id,
      continuePendingCardEffects,
      'DISCARD_HAND_CARD_NO_MUSE_MEMBER_CHEER_TARGET',
      {
        discardedCardId,
        selectableCardIds,
      }
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        effectText: `${getAbilityEffectText(
          effect.abilityId
        )}（已放置1张手牌入休息室；当前可加入手牌的声援公开『μ's』成员卡 ${selectableCardIds.length}张。）`,
        stepId: SELECT_MUSE_CHEER_STEP_ID,
        stepText: "请选择1张因声援公开的自己的『μ's』成员卡加入手牌。",
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: "选择声援公开的『μ's』成员卡",
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedCardId,
          publicCardSelectionConfirmation: {
            source: 'REVEALED_CHEER',
            destination: 'HAND',
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD_START_SELECT_MUSE_MEMBER_CHEER',
      discardedCardId,
      selectableCardIds,
    }
  );
}

function finishKaguyaRecoverMuseCheer(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getKaguyaActiveEffect(game, SELECT_MUSE_CHEER_STEP_ID);
  if (!effect || selectedCardId === null || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (!isSourceLiveInLiveZone(game, player.id, effect.sourceCardId)) {
    return consumeActiveEffectNoMove(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'SELECT_MUSE_MEMBER_CHEER_SOURCE_NOT_IN_LIVE_ZONE',
      {
        discardedCardId: effect.metadata?.discardedCardId,
      }
    );
  }

  const currentSelectableCardIds = selectMuseMemberCheerCardIds(game, player.id);
  if (!currentSelectableCardIds.includes(selectedCardId)) {
    return game;
  }

  const moveResult = moveRevealedCheerCards(game, player.id, [selectedCardId], 'HAND');
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD_MOVE_MUSE_MEMBER_CHEER_TO_HAND',
      discardedCardId: effect.metadata?.discardedCardId,
      selectedCardId,
      movedCardIds: moveResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function selectMuseMemberCheerCardIds(game: GameState, playerId: string): readonly string[] {
  return selectRevealedCheerCardIds(game, playerId, (card) => {
    return isMemberCardData(card.data) && museMemberSelector(card);
  });
}

function getKaguyaActiveEffect(
  game: GameState,
  stepId: string
): ActiveEffectState | null {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_PB1_031_LIVE_SUCCESS_DISCARD_HAND_RECOVER_MUSE_MEMBER_CHEER_ABILITY_ID ||
    effect.stepId !== stepId
  ) {
    return null;
  }
  return effect;
}

function isSourceLiveInLiveZone(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return player?.liveZone.cardIds.includes(sourceCardId) === true;
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
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
      }
    ),
    orderedResolution
  );
}

function consumeActiveEffectNoMove(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      selectedCardId: null,
      movedCardIds: [],
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
