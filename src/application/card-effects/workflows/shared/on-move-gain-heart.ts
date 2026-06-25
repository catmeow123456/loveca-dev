import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  SP_SD2_002_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
  SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID,
  SP_SD2_013_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
  SP_SD2_022_AUTO_ON_MOVE_GAIN_YELLOW_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface OnMoveGainHeartConfig {
  readonly abilityId: string;
  readonly baseCardCodes: readonly string[];
  readonly heartColor: HeartColor;
  readonly actionStep: string;
  readonly payloadLabel: string;
}

const ON_MOVE_GAIN_HEART_CONFIGS: readonly OnMoveGainHeartConfig[] = [
  {
    abilityId: SP_SD2_002_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
    baseCardCodes: ['PL!SP-sd2-002'],
    heartColor: HeartColor.PURPLE,
    actionStep: 'ON_MOVE_GAIN_PURPLE_HEART',
    payloadLabel: 'purpleHeartBonus',
  },
  {
    abilityId: SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID,
    baseCardCodes: ['PL!SP-sd2-012'],
    heartColor: HeartColor.RED,
    actionStep: 'ON_MOVE_GAIN_RED_HEART',
    payloadLabel: 'redHeartBonus',
  },
  {
    abilityId: SP_SD2_013_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
    baseCardCodes: ['PL!SP-sd2-013'],
    heartColor: HeartColor.PURPLE,
    actionStep: 'ON_MOVE_GAIN_PURPLE_HEART',
    payloadLabel: 'purpleHeartBonus',
  },
  {
    abilityId: SP_SD2_022_AUTO_ON_MOVE_GAIN_YELLOW_HEART_ABILITY_ID,
    baseCardCodes: ['PL!SP-sd2-022'],
    heartColor: HeartColor.YELLOW,
    actionStep: 'ON_MOVE_GAIN_YELLOW_HEART',
    payloadLabel: 'yellowHeartBonus',
  },
];

export function registerOnMoveGainHeartWorkflowHandlers(): void {
  for (const config of ON_MOVE_GAIN_HEART_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveOnMoveGainHeart(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveOnMoveGainHeart(
  game: GameState,
  ability: PendingAbilityState,
  config: OnMoveGainHeartConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterUseRecord = recordAbilityUseForContext(stateWithoutPending, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  const heartResult = addHeartLiveModifierForMember(stateAfterUseRecord, {
    playerId: player.id,
    memberCardId: ability.sourceCardId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    hearts: [{ color: config.heartColor, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(heartResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      sourceSlot: ability.sourceSlot,
      fromSlot: ability.metadata?.fromSlot,
      toSlot: ability.metadata?.toSlot,
      swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
      heartBonus: heartResult.heartBonus,
      [config.payloadLabel]: heartResult.heartBonus,
    }),
    orderedResolution
  );
}
