import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import {
  BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID,
  BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import { and, groupIs, typeIs } from '../../../effects/card-selectors.js';
import { hasCardInZoneMatching, successLiveScoreAtLeast } from '../../../effects/conditions.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import {
  finishWaitingRoomToHandWorkflow,
  startWaitingRoomToHandWorkflow,
} from '../shared/waiting-room-to-hand.js';

const BP6_013_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID = 'BP6_013_SELECT_WAITING_ROOM_MUSE_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp6013And023SuccessZoneWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID,
    (game, ability, options, context) =>
      startBp6013RecoverMuseLive(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID,
    BP6_013_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );

  registerManualConfirmablePendingAbilityStarterHandler(
    BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveBp6023DrawBySuccessZone(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    (game, ability) => {
      const player = getPlayerById(game, ability.controllerId);
      const hasMuseSuccessCard = player
        ? hasCardInZoneMatching(game, player.id, ZoneType.SUCCESS_ZONE, groupIs("μ's"))
        : false;
      return {
        stepText: hasMuseSuccessCard
          ? "自己的成功LIVE区有 μ's 卡。确认后抽 2 张卡。"
          : "自己的成功LIVE区没有 μ's 卡。确认后抽 1 张卡。",
      };
    }
  );
}

function startBp6013RecoverMuseLive(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const successScoreConditionMet = successLiveScoreAtLeast(game, player.id, 6);
  const selectableCardIds = successScoreConditionMet
    ? getWaitingRoomMuseLiveCardIds(game, player.id)
    : [];
  if (!successScoreConditionMet || selectableCardIds.length === 0) {
    return consumeBp6013Pending(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      successScoreConditionMet,
      selectableCardIds
    );
  }

  return startWaitingRoomToHandWorkflow(game, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: BP6_013_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
    stepText: "请选择自己的休息室中1张[μ's]的LIVE卡加入手牌。",
    candidateBuilder: () => selectableCardIds,
    countRule: { minCount: 0, maxCount: 1 },
    optional: false,
    orderedResolution,
    selectionRequiredWhenHasTargets: true,
  });
}

function consumeBp6013Pending(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  successScoreConditionMet: boolean,
  selectableCardIds: readonly string[]
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'NO_RECOVER_TARGET',
      successScoreConditionMet,
      selectableCardIds,
    }),
    orderedResolution
  );
}

function resolveBp6023DrawBySuccessZone(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const hasMuseSuccessCard = hasCardInZoneMatching(
    game,
    player.id,
    ZoneType.SUCCESS_ZONE,
    groupIs("μ's")
  );
  const drawCount = hasMuseSuccessCard ? 2 : 1;
  const drawResult = drawCardsForPlayer(game, player.id, drawCount);
  if (!drawResult) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...drawResult.gameState,
    pendingAbilities: drawResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_BY_SUCCESS_ZONE_MUSE',
      hasMuseSuccessCard,
      drawCount,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    orderedResolution
  );
}

function getWaitingRoomMuseLiveCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, and(typeIs(CardType.LIVE), groupIs("μ's")));
}
