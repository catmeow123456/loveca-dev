import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import {
  and,
  groupAliasIs,
  type CardSelector,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
  PL_N_BP1_004_ON_ENTER_OTHER_NIJIGASAKI_ACTIVATE_ONE_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type OtherMemberIdentity =
  | { readonly kind: 'GROUP'; readonly alias: string }
  | { readonly kind: 'UNIT'; readonly alias: string };

interface OnEnterOtherIdentityActivateEnergyConfig {
  readonly abilityId: string;
  readonly identity: OtherMemberIdentity;
  readonly activationCount: number;
  readonly actionStep: string;
  readonly noOtherMemberStep: string;
}

const CONFIGS: readonly OnEnterOtherIdentityActivateEnergyConfig[] = [
  {
    abilityId: HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
    identity: { kind: 'UNIT', alias: 'Cerise Bouquet' },
    activationCount: 1,
    actionStep: 'ACTIVATE_WAITING_ENERGY',
    noOtherMemberStep: 'NO_OTHER_CERISE_BOUQUET_MEMBER',
  },
  {
    abilityId: PL_N_BP1_004_ON_ENTER_OTHER_NIJIGASAKI_ACTIVATE_ONE_ENERGY_ABILITY_ID,
    identity: { kind: 'GROUP', alias: '虹ヶ咲' },
    activationCount: 1,
    actionStep: 'ACTIVATE_WAITING_ENERGY',
    noOtherMemberStep: 'NO_OTHER_NIJIGASAKI_MEMBER',
  },
];

export function registerOnEnterOtherIdentityActivateEnergyWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveOnEnterOtherIdentityActivateEnergy(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveOnEnterOtherIdentityActivateEnergy(
  game: GameState,
  ability: PendingAbilityState,
  config: OnEnterOtherIdentityActivateEnergyConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const otherIdentityMemberIds = getStageMemberCardIdsMatching(
    game,
    player.id,
    getIdentityMemberSelector(config.identity)
  ).filter((cardId) => cardId !== ability.sourceCardId);
  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );

  if (otherIdentityMemberIds.length === 0) {
    return finishWithAction(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: config.noOtherMemberStep,
      otherIdentityMemberIds,
      waitingEnergyCardIds,
      activatedEnergyCardIds: [],
    });
  }

  const activationCount = Math.min(config.activationCount, waitingEnergyCardIds.length);
  const activationResult = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!activationResult) return game;

  return finishWithAction(
    activationResult.gameState,
    ability,
    player.id,
    orderedResolution,
    continuePendingCardEffects,
    {
      step: activationCount > 0 ? config.actionStep : 'NO_WAITING_ENERGY',
      requestedActivationCount: config.activationCount,
      otherIdentityMemberIds,
      waitingEnergyCardIds,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    }
  );
}

function getIdentityMemberSelector(identity: OtherMemberIdentity): CardSelector {
  const identitySelector =
    identity.kind === 'GROUP' ? groupAliasIs(identity.alias) : unitAliasIs(identity.alias);
  return and(typeIs(CardType.MEMBER), identitySelector);
}

function finishWithAction(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
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
      sourceSlot: ability.sourceSlot,
      ...payload,
    }),
    orderedResolution
  );
}
