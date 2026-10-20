import {
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { S_BP5_016_LIVE_START_HIGHER_COST_THAN_ALL_OPPONENT_STAGE_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { registerLiveStartConditionalSourceBladeWorkflowHandlers } from '../shared/live-start-conditional-source-blade.js';

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
  registerLiveStartConditionalSourceBladeWorkflowHandlers([
    {
      abilityId: S_BP5_016_LIVE_START_HIGHER_COST_THAN_ALL_OPPONENT_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
      bladeBonus: 2,
      bladeToken: '[BLADE]',
      actionStep: 'HIGHER_COST_GAIN_TWO_BLADE',
      getContext: (game, ability) => {
        const context = getSBp5016Context(game, ability);
        return {
          conditionMet: context.conditionMet,
          conditionText: `己方最高费用：${formatCostEntry(context.ownHighestCostMember)}；对方舞台成员费用：${formatOpponentCosts(context.opponentCosts)}`,
          metadata: {
            sourceOnStage: context.sourceOnStage,
            ownHighestCost: context.ownHighestCostMember?.cost ?? null,
            satisfyingMemberCardId: context.satisfyingMember?.cardId ?? null,
            opponentCosts: context.opponentCosts,
          },
        };
      },
    },
  ]);
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
