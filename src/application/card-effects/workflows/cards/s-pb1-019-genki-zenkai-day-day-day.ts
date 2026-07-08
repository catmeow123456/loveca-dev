import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
  isLiveAbilitySuppressed,
  suppressLiveAbility,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  PL_S_PB1_019_LIVE_START_AQOURS_RED_HEART_SUPPRESS_SUCCESS_ABILITY_ID,
  PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface AqoursRedHeartContext {
  readonly sourceInLiveZone: boolean;
  readonly aqoursMemberCardIds: readonly string[];
  readonly redHeartTotal: number;
  readonly suppressesLiveSuccess: boolean;
}

export function registerSPb1019GenkiZenkaiDayDayDayWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_S_PB1_019_LIVE_START_AQOURS_RED_HEART_SUPPRESS_SUCCESS_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveStartSuppression(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getLiveStartConfirmationConfig
  );

  registerManualConfirmablePendingAbilityStarterHandler(
    PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveSuccessWaitingEnergy(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function getLiveStartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string; readonly stepText: string } {
  const text = `${getAbilityEffectText(
    PL_S_PB1_019_LIVE_START_AQOURS_RED_HEART_SUPPRESS_SUCCESS_ABILITY_ID
  )}${formatLiveStartDynamicText(getAqoursRedHeartContext(game, ability))}`;
  return { effectText: text, stepText: text };
}

function resolveLiveStartSuppression(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const context = getAqoursRedHeartContext(game, ability);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateWithSuppression = context.suppressesLiveSuccess
    ? suppressLiveAbility(stateWithoutPending, {
        sourceCardId: ability.sourceCardId,
        suppressedAbilityId: PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID,
        abilityId: ability.abilityId,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateWithSuppression, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: context.suppressesLiveSuccess
        ? 'SUPPRESS_LIVE_SUCCESS_ABILITY'
        : context.sourceInLiveZone
          ? 'CONDITION_NOT_MET'
          : 'SOURCE_NOT_IN_LIVE_ZONE',
      sourceInLiveZone: context.sourceInLiveZone,
      aqoursMemberCardIds: context.aqoursMemberCardIds,
      aqoursMemberCount: context.aqoursMemberCardIds.length,
      redHeartTotal: context.redHeartTotal,
      suppressedAbilityId: context.suppressesLiveSuccess
        ? PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID
        : undefined,
    }),
    orderedResolution
  );
}

function resolveLiveSuccessWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const opponent = getOpponent(game, ability.controllerId);
  const suppressed = isLiveAbilitySuppressed(game, ability.sourceCardId, ability.abilityId);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (!player || !sourceInLiveZone || !opponent || suppressed) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: suppressed
          ? 'SUPPRESSED'
          : !sourceInLiveZone
            ? 'SOURCE_NOT_IN_LIVE_ZONE'
            : 'NO_OP_NO_OPPONENT',
        sourceInLiveZone,
        opponentId: opponent?.id ?? null,
      }),
      orderedResolution
    );
  }

  const placeResult = placeEnergyFromDeckToZoneByCardEffect(
    stateWithoutPending,
    opponent.id,
    1,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!placeResult) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_OP_PLACE_ENERGY_FAILED',
        opponentId: opponent.id,
      }),
      orderedResolution
    );
  }

  return continuePendingCardEffects(
    addAction(placeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step:
        placeResult.placedEnergyCardIds.length > 0
          ? 'PLACE_OPPONENT_WAITING_ENERGY'
          : 'NO_OP_OPPONENT_ENERGY_DECK_EMPTY',
      opponentId: opponent.id,
      placedEnergyCardIds: placeResult.placedEnergyCardIds,
      orientation: OrientationState.WAITING,
    }),
    orderedResolution
  );
}

function getAqoursRedHeartContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): AqoursRedHeartContext {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  if (!player || !sourceInLiveZone) {
    return {
      sourceInLiveZone,
      aqoursMemberCardIds: [],
      redHeartTotal: 0,
      suppressesLiveSuccess: false,
    };
  }

  const liveModifiers = collectLiveModifiers(game);
  const aqoursMemberCardIds = getStageMemberCardIdsMatching(
    game,
    player.id,
    and(typeIs(CardType.MEMBER), groupAliasIs('Aqours'))
  );
  const redHeartTotal = aqoursMemberCardIds.reduce((total, memberCardId) => {
    const redHearts = getMemberEffectiveHeartIcons(
      game,
      player.id,
      memberCardId,
      liveModifiers
    ).filter((heart) => heart.color === HeartColor.RED);
    return total + redHearts.reduce((heartTotal, heart) => heartTotal + heart.count, 0);
  }, 0);

  return {
    sourceInLiveZone,
    aqoursMemberCardIds,
    redHeartTotal,
    suppressesLiveSuccess: redHeartTotal >= 6,
  };
}

function formatLiveStartDynamicText(context: AqoursRedHeartContext): string {
  if (!context.sourceInLiveZone) {
    return '（来源LIVE不在LIVE区，Aqours成员 0名，[赤ハート]合计0个，未满足条件，不会无效化。）';
  }
  return `（Aqours成员 ${context.aqoursMemberCardIds.length}名，[赤ハート]合计${context.redHeartTotal}个，${
    context.suppressesLiveSuccess
      ? '满足条件，将使此卡【LIVE成功时】能力无效。'
      : '未满足条件，【LIVE成功时】能力正常处理。'
  }）`;
}
