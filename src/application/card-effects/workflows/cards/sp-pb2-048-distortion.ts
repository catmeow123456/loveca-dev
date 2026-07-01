import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveRequirementModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier, replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { applyHeartRequirementModifiers } from '../../../../domain/rules/live-requirement-modifiers.js';
import { CardType, HeartColor, SlotPosition } from '../../../../shared/types/enums.js';
import { and, normalizeCardName, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];
const catchuMember = and(typeIs(CardType.MEMBER), unitAliasIs('CatChu!'));

export function registerSpPb2048DistortionWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb2048DistortionLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getSpPb2048ConfirmationConfig
  );
}

function getSpPb2048ConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const player = getPlayerById(game, ability.controllerId);
  const liveCard = getCardById(game, ability.sourceCardId);
  const catchuCount = player ? getDifferentNamedCatchuStageMembers(game, player.id).length : 0;
  const requirementModifiers = createRequirementModifiers(catchuCount);
  const adjustedRequirement =
    liveCard && isLiveCardData(liveCard.data)
      ? applyHeartRequirementModifiers(liveCard.data.requirements, requirementModifiers)
      : null;
  const adjustedRedRequirement = adjustedRequirement?.colorRequirements.get(HeartColor.RED) ?? 0;
  const scoreBonus = adjustedRedRequirement >= 9 ? 1 : 0;
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前不同名CatChu!成员 ${catchuCount}名，减少${
      catchuCount * 2
    }个[無ハート]、增加${catchuCount}个[赤ハート]，调整后[赤ハート]必要数 ${adjustedRedRequirement}，${
      scoreBonus > 0 ? '分数+1' : '不增加分数'
    }）`,
  };
}

function resolveSpPb2048DistortionLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const liveCard = getCardById(game, ability.sourceCardId);
  if (!player || !liveCard || !isLiveCardData(liveCard.data)) {
    return game;
  }

  const differentNamedCatchuMembers = getDifferentNamedCatchuStageMembers(game, player.id);
  const catchuCount = differentNamedCatchuMembers.length;
  const requirementModifiers = createRequirementModifiers(catchuCount);
  const adjustedRequirement = applyHeartRequirementModifiers(
    liveCard.data.requirements,
    requirementModifiers
  );
  const adjustedRedRequirement = adjustedRequirement.colorRequirements.get(HeartColor.RED) ?? 0;
  const scoreBonus = adjustedRedRequirement >= 9 ? 1 : 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterRequirement = replaceLiveModifier(
    stateWithoutPending,
    {
      kind: 'REQUIREMENT',
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    catchuCount > 0
      ? {
          kind: 'REQUIREMENT',
          liveCardId: ability.sourceCardId,
          modifiers: requirementModifiers,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null
  );
  const stateAfterScore =
    scoreBonus > 0
      ? addLiveModifier(stateAfterRequirement, {
          kind: 'SCORE',
          playerId: player.id,
          countDelta: scoreBonus,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        })
      : stateAfterRequirement;
  const stateAfterScoreRefresh =
    scoreBonus > 0
      ? refreshPlayerScoreDraft(stateAfterScore, player.id, scoreBonus)
      : stateAfterScore;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE',
      differentNamedCatchuMemberCardIds: differentNamedCatchuMembers.map((member) => member.cardId),
      differentNamedCatchuNames: differentNamedCatchuMembers.map((member) => member.name),
      catchuCount,
      requirementModifiers,
      adjustedRedRequirement,
      scoreBonus,
    }),
    orderedResolution
  );
}

function getDifferentNamedCatchuStageMembers(
  game: GameState,
  playerId: string
): readonly { readonly cardId: string; readonly name: string }[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const seenNames = new Set<string>();
  const members: { readonly cardId: string; readonly name: string }[] = [];
  for (const slot of STAGE_SLOTS) {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    if (!cardId || !card || !catchuMember(card)) {
      continue;
    }

    const normalizedName = normalizeCardName(card.data.name);
    if (seenNames.has(normalizedName)) {
      continue;
    }
    seenNames.add(normalizedName);
    members.push({ cardId, name: card.data.name });
  }
  return members;
}

function createRequirementModifiers(catchuCount: number): readonly LiveRequirementModifierState[] {
  return catchuCount > 0
    ? [
        { color: HeartColor.RAINBOW, countDelta: -2 * catchuCount },
        { color: HeartColor.RED, countDelta: catchuCount },
      ]
    : [];
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}
