import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import {
  HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID,
  S_BP6_013_ON_ENTER_GAIN_TWO_BLADE_ABILITY_ID,
  S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface OnEnterSourceMemberGainBladeConfig {
  readonly abilityId: string;
  readonly bladeAmount: number;
  readonly actionStep: string;
}

const ON_ENTER_SOURCE_MEMBER_GAIN_BLADE_CONFIGS: readonly OnEnterSourceMemberGainBladeConfig[] = [
  {
    abilityId: S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID,
    bladeAmount: 1,
    actionStep: 'ON_ENTER_SOURCE_MEMBER_GAIN_ONE_BLADE',
  },
  {
    abilityId: S_BP6_013_ON_ENTER_GAIN_TWO_BLADE_ABILITY_ID,
    bladeAmount: 2,
    actionStep: 'ON_ENTER_SOURCE_MEMBER_GAIN_TWO_BLADE',
  },
  {
    abilityId: HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID,
    bladeAmount: 3,
    actionStep: 'ON_ENTER_SOURCE_MEMBER_GAIN_THREE_BLADE',
  },
];

export function registerOnEnterSourceMemberGainBladeWorkflowHandlers(): void {
  for (const config of ON_ENTER_SOURCE_MEMBER_GAIN_BLADE_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveOnEnterSourceMemberGainBlade(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveOnEnterSourceMemberGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  config: OnEnterSourceMemberGainBladeConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const player = getPlayerById(stateWithoutPending, ability.controllerId);
  if (!player) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', null, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot,
        step: 'CONTROLLER_NOT_FOUND_NO_OP',
        sourceOnStage: false,
        bladeBonus: 0,
      }),
      orderedResolution
    );
  }

  const sourceOnStage = getAllMemberCardIds(player.memberSlots).includes(ability.sourceCardId);
  const bladeResult = sourceOnStage
    ? addBladeLiveModifierForSourceMember(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: config.bladeAmount,
      })
    : null;
  const bladeApplied = bladeResult !== null;

  return continuePendingCardEffects(
    addAction(bladeResult?.gameState ?? stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: bladeApplied ? config.actionStep : 'SOURCE_MEMBER_GAIN_BLADE_NO_OP',
      sourceOnStage,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
      expectedBladeBonus: config.bladeAmount,
      bladeApplied,
    }),
    orderedResolution
  );
}
