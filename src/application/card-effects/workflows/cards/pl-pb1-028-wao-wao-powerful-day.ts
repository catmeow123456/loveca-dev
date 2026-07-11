import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { isMemberEffectActivationProhibited } from '../../../../domain/rules/member-effect-activation-prohibitions.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_PB1_028_LIVE_START_ACTIVATE_PRINTEMPS_MEMBERS_SCORE_ABILITY_ID } from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface PrintempsActivationContext {
  readonly sourceInLiveZone: boolean;
  readonly printempsMemberCardIds: readonly string[];
  readonly waitingPrintempsMemberCardIds: readonly string[];
  readonly actualActivationCount: number;
  readonly scoreBonus: number;
}

export function registerPlPb1028WaoWaoPowerfulDayWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_PB1_028_LIVE_START_ACTIVATE_PRINTEMPS_MEMBERS_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveWaoWaoPowerfulDayLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    getConfirmationConfig
  );
}

function getConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string; readonly stepText: string } {
  const context = getPrintempsActivationContext(game, ability);
  const dynamicText = formatDynamicText(context);
  const effectText = `${getAbilityEffectText(
    PL_PB1_028_LIVE_START_ACTIVATE_PRINTEMPS_MEMBERS_SCORE_ABILITY_ID
  )}${dynamicText}`;
  return {
    effectText,
    stepText: effectText,
  };
}

function resolveWaoWaoPowerfulDayLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getPrintempsActivationContext(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (!context.sourceInLiveZone || context.waitingPrintempsMemberCardIds.length === 0) {
    state = replaceScoreModifier(state, ability, player.id, 0);
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: context.sourceInLiveZone
          ? 'NO_WAITING_PRINTEMPS_MEMBER'
          : 'SOURCE_NOT_IN_LIVE_ZONE',
        sourceInLiveZone: context.sourceInLiveZone,
        printempsMemberCount: context.printempsMemberCardIds.length,
        waitingPrintempsMemberCount: context.waitingPrintempsMemberCardIds.length,
        actualActivationCount: 0,
        scoreBonus: 0,
      }),
      orderedResolution
    );
  }

  const orientationResult = setMembersOrientation(
    state,
    player.id,
    context.waitingPrintempsMemberCardIds,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!orientationResult) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'ACTIVATE_PRINTEMPS_FAILED',
        sourceInLiveZone: context.sourceInLiveZone,
        printempsMemberCount: context.printempsMemberCardIds.length,
        waitingPrintempsMemberCount: context.waitingPrintempsMemberCardIds.length,
        actualActivationCount: 0,
        scoreBonus: 0,
      }),
      orderedResolution
    );
  }

  const actualActivationCount = orientationResult.updatedMemberCardIds.length;
  const scoreBonus = actualActivationCount >= 3 ? 1 : 0;
  const stateWithScore = replaceScoreModifier(orientationResult.gameState, ability, player.id, scoreBonus);
  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    state,
    {
      ...orientationResult,
      gameState: stateWithScore,
    },
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterScore, result, memberStateChangedEvents) =>
        addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step:
            scoreBonus > 0
              ? 'ACTIVATE_PRINTEMPS_MEMBERS_GAIN_SCORE'
              : 'ACTIVATE_PRINTEMPS_MEMBERS_NO_SCORE',
          sourceInLiveZone: context.sourceInLiveZone,
          printempsMemberCount: context.printempsMemberCardIds.length,
          waitingPrintempsMemberCount: context.waitingPrintempsMemberCardIds.length,
          activatedMemberCardIds: result.updatedMemberCardIds,
          actualActivationCount,
          scoreBonus,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(stateWithMemberStateTriggers.gameState, orderedResolution);
}

function getPrintempsActivationContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): PrintempsActivationContext {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      printempsMemberCardIds: [],
      waitingPrintempsMemberCardIds: [],
      actualActivationCount: 0,
      scoreBonus: 0,
    };
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const printempsMemberCardIds = sourceInLiveZone ? getPrintempsStageMemberCardIds(game, player.id) : [];
  const waitingPrintempsMemberCardIds = printempsMemberCardIds.filter(
    (cardId) => player.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.WAITING
  );
  const actualActivationCount =
    sourceInLiveZone && !isMemberEffectActivationProhibited(game, player.id)
      ? waitingPrintempsMemberCardIds.length
      : 0;

  return {
    sourceInLiveZone,
    printempsMemberCardIds,
    waitingPrintempsMemberCardIds,
    actualActivationCount,
    scoreBonus: actualActivationCount >= 3 ? 1 : 0,
  };
}

function getPrintempsStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), unitAliasIs('Printemps'))
  );
}

function formatDynamicText(context: PrintempsActivationContext): string {
  if (!context.sourceInLiveZone) {
    return '（来源LIVE不在LIVE区，Printemps成员 0名，待机 0名，确认后实际变活跃 0名，不增加分数。）';
  }
  return `（Printemps成员 ${context.printempsMemberCardIds.length}名，待机 ${context.waitingPrintempsMemberCardIds.length}名，确认后实际变活跃 ${context.actualActivationCount}名，${
    context.scoreBonus > 0 ? '满足条件，分数+1' : '未满足条件，不增加分数'
  }。）`;
}

function replaceScoreModifier(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  scoreBonus: number
): GameState {
  const stateWithModifier = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId,
          countDelta: scoreBonus,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null
  );
  if (scoreBonus <= 0) {
    return stateWithModifier;
  }
  const playerScores = new Map(stateWithModifier.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...stateWithModifier,
    liveResolution: {
      ...stateWithModifier.liveResolution,
      playerScores,
    },
  };
}
