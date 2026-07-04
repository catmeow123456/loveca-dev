import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface MemberOnEnterDrawConfig {
  readonly abilityId: string;
  readonly drawCount: number;
  readonly actionStep: string;
}

const MEMBER_ON_ENTER_DRAW_CONFIGS: readonly MemberOnEnterDrawConfig[] = [
  {
    abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_DRAW_ONE',
  },
];

export function registerMemberOnEnterDrawWorkflowHandlers(): void {
  for (const config of MEMBER_ON_ENTER_DRAW_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveMemberOnEnterDraw(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveMemberOnEnterDraw(
  game: GameState,
  ability: PendingAbilityState,
  config: MemberOnEnterDrawConfig,
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
  const drawResult = drawCardsForPlayer(stateAfterUseRecord, player.id, config.drawCount);
  if (!drawResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      sourceSlot: ability.sourceSlot,
      drawnCardIds: drawResult.drawnCardIds,
      drawCount: drawResult.drawnCardIds.length,
    }),
    orderedResolution
  );
}
