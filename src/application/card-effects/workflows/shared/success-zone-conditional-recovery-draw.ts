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
  PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import { and, groupIs, typeIs } from '../../../effects/card-selectors.js';
import {
  countCardsInZoneMatching,
  hasCardInZoneMatching,
  successLiveScoreAtLeast,
} from '../../../effects/conditions.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import {
  finishWaitingRoomToHandWorkflow,
  startWaitingRoomToHandWorkflow,
} from './waiting-room-to-hand.js';

const BP6_013_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID = 'BP6_013_SELECT_WAITING_ROOM_MUSE_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface SuccessZoneConditionalDrawConfig {
  readonly abilityId: string;
  readonly drawCountWhenConditionNotMet: number;
  readonly drawCountWhenConditionMet: number;
  readonly actionStep: string;
}

const SUCCESS_ZONE_CONDITIONAL_DRAW_CONFIGS: readonly SuccessZoneConditionalDrawConfig[] = [
  {
    abilityId: BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID,
    drawCountWhenConditionNotMet: 1,
    drawCountWhenConditionMet: 2,
    actionStep: 'DRAW_BY_SUCCESS_ZONE_MUSE',
  },
  {
    abilityId: PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
    drawCountWhenConditionNotMet: 0,
    drawCountWhenConditionMet: 1,
    actionStep: 'DRAW_IF_SUCCESS_ZONE_MUSE',
  },
];

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

  for (const config of SUCCESS_ZONE_CONDITIONAL_DRAW_CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, context) =>
        resolveSuccessZoneConditionalDraw(
          game,
          ability,
          config,
          options.orderedResolution === true,
          context.continuePendingCardEffects
        ),
      (game, ability) => {
        const player = getPlayerById(game, ability.controllerId);
        const museSuccessCardCount = player
          ? countCardsInZoneMatching(game, player.id, ZoneType.SUCCESS_ZONE, groupIs("μ's"))
          : 0;
        const conditionMet = museSuccessCardCount > 0;
        const drawCount = conditionMet
          ? config.drawCountWhenConditionMet
          : config.drawCountWhenConditionNotMet;
        return {
          effectText: `${getAbilityEffectText(ability.abilityId)}（当前自己的成功LIVE卡区有${museSuccessCardCount}张『μ's』卡，条件${conditionMet ? '满足' : '未满足'}，实际抽${drawCount}张卡。）`,
          stepText: `当前自己的成功LIVE卡区有${museSuccessCardCount}张『μ's』卡，条件${conditionMet ? '满足' : '未满足'}；确认后抽${drawCount}张卡。`,
        };
      }
    );
  }
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

function resolveSuccessZoneConditionalDraw(
  game: GameState,
  ability: PendingAbilityState,
  config: SuccessZoneConditionalDrawConfig,
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
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawCount = hasMuseSuccessCard
    ? config.drawCountWhenConditionMet
    : config.drawCountWhenConditionNotMet;
  const drawResult =
    drawCount > 0 ? drawCardsForPlayer(stateWithoutPending, player.id, drawCount) : null;
  if (drawCount > 0 && !drawResult) {
    return game;
  }
  const stateAfterDraw = drawResult?.gameState ?? stateWithoutPending;
  const drawnCardIds = drawResult?.drawnCardIds ?? [];

  return continuePendingCardEffects(
    addAction(stateAfterDraw, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      hasMuseSuccessCard,
      drawCount,
      drawnCardIds,
    }),
    orderedResolution
  );
}

function getWaitingRoomMuseLiveCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, and(typeIs(CardType.LIVE), groupIs("μ's")));
}
