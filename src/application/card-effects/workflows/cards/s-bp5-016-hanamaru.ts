import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { S_BP5_016_LIVE_START_HIGHER_COST_THAN_ALL_OPPONENT_STAGE_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface StageCostEntry {
  readonly cardId: string;
  readonly cost: number;
}

interface HanamaruContext {
  readonly sourceOnStage: boolean;
  readonly ownHighestCostMember: StageCostEntry | null;
  readonly satisfyingMember: StageCostEntry | null;
  readonly opponentCosts: readonly number[];
  readonly conditionMet: boolean;
}

export function registerSBp5016HanamaruWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    S_BP5_016_LIVE_START_HIGHER_COST_THAN_ALL_OPPONENT_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSBp5016HanamaruLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getSBp5016ConfirmationConfig
  );
}

function getSBp5016ConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getSBp5016Context(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（己方最高费用：${formatCostEntry(
      context.ownHighestCostMember
    )}；对方舞台成员费用：${formatOpponentCosts(
      context.opponentCosts
    )}；条件${context.conditionMet ? '满足' : '未满足'}；实际${
      context.conditionMet ? '获得[BLADE][BLADE]' : '不获得[BLADE]'
    }。）`,
  };
}

function resolveSBp5016HanamaruLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const player = getPlayerById(stateWithoutPending, ability.controllerId);
  if (!player) {
    return continuePendingCardEffects(stateWithoutPending, orderedResolution);
  }

  const context = getSBp5016Context(stateWithoutPending, ability);
  const bladeResult = context.conditionMet
    ? addBladeLiveModifierForSourceMember(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: 2,
      })
    : null;
  const stateAfterBlade = bladeResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterBlade, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceOnStage: context.sourceOnStage,
      step: context.conditionMet ? 'HIGHER_COST_GAIN_TWO_BLADE' : 'CONDITION_NOT_MET',
      ownHighestCost: context.ownHighestCostMember?.cost ?? null,
      satisfyingMemberCardId: context.satisfyingMember?.cardId ?? null,
      opponentCosts: context.opponentCosts,
      conditionMet: context.conditionMet,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    orderedResolution
  );
}

function getSBp5016Context(game: GameState, ability: PendingAbilityState): HanamaruContext {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player) {
    return {
      sourceOnStage: false,
      ownHighestCostMember: null,
      satisfyingMember: null,
      opponentCosts: [],
      conditionMet: false,
    };
  }

  const ownStageMemberIds = getAllMemberCardIds(player.memberSlots);
  const sourceOnStage = ownStageMemberIds.includes(ability.sourceCardId);
  const ownCostEntries = ownStageMemberIds.map((cardId) => ({
    cardId,
    cost: getMemberEffectiveCost(game, player.id, cardId),
  }));
  const opponentCosts = opponent
    ? getAllMemberCardIds(opponent.memberSlots).map((cardId) =>
        getMemberEffectiveCost(game, opponent.id, cardId)
      )
    : [];
  const ownHighestCostMember = getHighestCostEntry(ownCostEntries);
  const satisfyingMember =
    ownHighestCostMember &&
    (opponentCosts.length === 0 ||
      opponentCosts.every((opponentCost) => ownHighestCostMember.cost > opponentCost))
      ? ownHighestCostMember
      : null;

  return {
    sourceOnStage,
    ownHighestCostMember,
    satisfyingMember,
    opponentCosts,
    conditionMet: sourceOnStage && satisfyingMember !== null,
  };
}

function getHighestCostEntry(entries: readonly StageCostEntry[]): StageCostEntry | null {
  return entries.reduce<StageCostEntry | null>(
    (highest, entry) => (!highest || entry.cost > highest.cost ? entry : highest),
    null
  );
}

function formatCostEntry(entry: StageCostEntry | null): string {
  return entry ? `${entry.cost}` : '无';
}

function formatOpponentCosts(costs: readonly number[]): string {
  return costs.length > 0 ? costs.join('/') : '无';
}
