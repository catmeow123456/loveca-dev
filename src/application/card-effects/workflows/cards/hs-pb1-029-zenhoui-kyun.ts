import {
  addAction,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  collectLiveModifiers,
  memberHasMoreEffectiveHeartsThanPrinted,
  replaceLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import { HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID } from '../../ability-ids.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const miraCraMember = and(typeIs(CardType.MEMBER), unitAliasIs('Mira-Cra Park!'));

export function registerHsPb1029ZenhouiKyunWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsPb1029ZenhouiKyunLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getHsPb1029ZenhouiKyunConfirmationConfig
  );
}

function getHsPb1029ZenhouiKyunConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const extraHeartMemberIds = getMiraCraMembersWithExtraHeart(game, ability.controllerId);
  const shouldDraw = extraHeartMemberIds.length >= 1;
  const shouldReduceRequirement = extraHeartMemberIds.length >= 2;
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（额外Heart的みらくらぱーく！成员 ${extraHeartMemberIds.length}名，${shouldDraw ? '抽1张' : '不抽牌'}，${shouldReduceRequirement ? '减少2个[無ハート]' : '不减少必要[無ハート]'}）`,
  };
}

function resolveHsPb1029ZenhouiKyunLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const extraHeartMemberIds = getMiraCraMembersWithExtraHeart(game, player.id);
  const shouldDraw = extraHeartMemberIds.length >= 1;
  const shouldReduceRequirement = extraHeartMemberIds.length >= 2;
  const drawResult = shouldDraw ? drawCardsForPlayer(game, player.id, 1) : null;
  let state = drawResult?.gameState ?? game;
  const requirementModifier = createRequirementModifier(ability, shouldReduceRequirement);

  state = replaceLiveModifier(
    state,
    {
      kind: 'REQUIREMENT',
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    requirementModifier
  );
  state = {
    ...state,
    pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_AND_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA',
      extraHeartMiraCraMemberIds: extraHeartMemberIds,
      extraHeartMiraCraMemberCount: extraHeartMemberIds.length,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
      requirementReduction: shouldReduceRequirement ? 2 : 0,
    }),
    orderedResolution
  );
}

function getMiraCraMembersWithExtraHeart(game: GameState, playerId: string): readonly string[] {
  const liveModifiers = collectLiveModifiers(game);
  return getStageMemberCardIdsMatching(game, playerId, miraCraMember).filter((cardId) =>
    memberHasMoreEffectiveHeartsThanPrinted(game, playerId, cardId, liveModifiers)
  );
}

function createRequirementModifier(
  ability: PendingAbilityState,
  shouldReduceRequirement: boolean
): LiveModifierState | null {
  return shouldReduceRequirement
    ? {
        kind: 'REQUIREMENT',
        liveCardId: ability.sourceCardId,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      }
    : null;
}
