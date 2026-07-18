import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  HS_BP5_014_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
  SP_BP7_014_AUTO_ON_MOVE_GAIN_TWO_BLADE_ABILITY_ID,
  SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface OnMoveGainBladeConfig {
  readonly abilityId: string;
  readonly amount: number;
  readonly actionStep: string;
}

const ON_MOVE_GAIN_BLADE_CONFIGS: readonly OnMoveGainBladeConfig[] = [
  {
    abilityId: SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
    amount: 1,
    actionStep: 'ON_MOVE_GAIN_BLADE',
  },
  {
    abilityId: HS_BP5_014_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
    amount: 1,
    actionStep: 'ON_MOVE_GAIN_BLADE',
  },
  {
    abilityId: SP_BP7_014_AUTO_ON_MOVE_GAIN_TWO_BLADE_ABILITY_ID,
    amount: 2,
    actionStep: 'ON_MOVE_GAIN_TWO_BLADE',
  },
];

export function registerOnMoveGainBladeWorkflowHandlers(): void {
  for (const config of ON_MOVE_GAIN_BLADE_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      if (confirmation) {
        return confirmation;
      }
      return resolveOnMoveGainBlade(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    });
  }
}

function resolveOnMoveGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  config: OnMoveGainBladeConfig,
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
  const sourceSlot = getSourceMemberSlot(stateAfterUseRecord, player.id, ability.sourceCardId);
  const bladeResult =
    sourceSlot === null
      ? null
      : addBladeLiveModifierForSourceMember(stateAfterUseRecord, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          amount: config.amount,
        });
  if (!bladeResult) {
    return continuePendingCardEffects(
      addAction(stateAfterUseRecord, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_OP_SOURCE_MEMBER_UNAVAILABLE',
        sourceSlot: ability.sourceSlot,
        fromSlot: ability.metadata?.fromSlot,
        toSlot: ability.metadata?.toSlot,
        swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
      }),
      orderedResolution
    );
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      sourceSlot: ability.sourceSlot,
      fromSlot: ability.metadata?.fromSlot,
      toSlot: ability.metadata?.toSlot,
      swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
      bladeBonus: bladeResult.bladeBonus,
    }),
    orderedResolution
  );
}
