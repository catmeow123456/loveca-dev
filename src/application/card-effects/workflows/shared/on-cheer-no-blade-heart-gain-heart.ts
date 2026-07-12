import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { hasBladeHeart } from '../../../effects/card-selectors.js';
import {
  SP_BP2_015_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_PURPLE_HEART_ABILITY_ID,
  SP_BP2_020_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_RED_HEART_ABILITY_ID,
  SP_BP2_021_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_YELLOW_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

interface OnCheerNoBladeHeartGainHeartConfig {
  readonly abilityId: string;
  readonly heartColor: HeartColor;
  readonly actionStep: string;
}

const CONFIGS: readonly OnCheerNoBladeHeartGainHeartConfig[] = [
  {
    abilityId: SP_BP2_015_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_PURPLE_HEART_ABILITY_ID,
    heartColor: HeartColor.PURPLE,
    actionStep: 'NO_BLADE_HEART_GAIN_PURPLE_HEART',
  },
  {
    abilityId: SP_BP2_020_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_RED_HEART_ABILITY_ID,
    heartColor: HeartColor.RED,
    actionStep: 'NO_BLADE_HEART_GAIN_RED_HEART',
  },
  {
    abilityId: SP_BP2_021_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_YELLOW_HEART_ABILITY_ID,
    heartColor: HeartColor.YELLOW,
    actionStep: 'NO_BLADE_HEART_GAIN_YELLOW_HEART',
  },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerOnCheerNoBladeHeartGainHeartWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveOnCheerNoBladeHeartGainHeart(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveOnCheerNoBladeHeartGainHeart(
  game: GameState,
  ability: PendingAbilityState,
  config: OnCheerNoBladeHeartGainHeartConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return finishPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'SOURCE_NOT_ON_STAGE',
        sourceSlot,
      }
    );
  }

  const cheerEvent = getLatestOwnNormalCheerEventByIds(game, player.id, ability.eventIds);
  if (!cheerEvent) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_MATCHING_OWN_NORMAL_CHEER_EVENT',
        sourceSlot,
        eventId: null,
        revealedCardIds: [],
        conditionMet: false,
        gainedHearts: [],
      }
    );
  }

  const ownRevealedCards = cheerEvent.revealedCardIds
    .map((cardId) => getCardById(game, cardId))
    .filter(
      (card): card is NonNullable<typeof card> => card !== null && card.ownerId === player.id
    );
  if (ownRevealedCards.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_OWN_REVEALED_CARDS',
        sourceSlot,
        eventId: cheerEvent.eventId,
        revealedCardIds: cheerEvent.revealedCardIds,
        conditionMet: false,
        gainedHearts: [],
      }
    );
  }

  const bladeHeartCardIds = ownRevealedCards.filter(hasBladeHeart()).map((card) => card.instanceId);
  const conditionMet = bladeHeartCardIds.length === 0;

  let state = removePendingAbility(game, ability.id);
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  let gainedHearts: readonly { readonly color: HeartColor; readonly count: number }[] = [];
  if (conditionMet) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: config.heartColor, count: 1 }],
    });
    if (heartResult) {
      state = heartResult.gameState;
      gainedHearts = heartResult.heartBonus;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: config.actionStep,
      eventId: cheerEvent.eventId,
      revealedCardIds: cheerEvent.revealedCardIds,
      bladeHeartCardIds,
      conditionMet,
      gainedHearts,
    }),
    orderedResolution
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}
