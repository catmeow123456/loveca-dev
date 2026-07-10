import { isMemberCardData } from '../../../../domain/entities/card.js';
import { getCardById, type GameState } from '../../../../domain/entities/game.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';

export interface RelayEnterLowerCostUnitContext {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly relayReplacements: unknown;
}

export interface RelayEnterLowerCostUnitCondition {
  readonly conditionMet: boolean;
  readonly reason:
    'MATCHED' | 'SOURCE_NOT_MEMBER' | 'NOT_RELAY_ENTER' | 'NO_LOWER_COST_UNIT_REPLACEMENT';
  readonly sourceEffectiveCost: number | null;
  readonly relayReplacementCardIds: readonly string[];
  readonly matchingRelayReplacementCardIds: readonly string[];
  readonly capturedReplacementEffectiveCosts: readonly number[];
}

interface RelayReplacement {
  readonly cardId: string;
  readonly effectiveCost: number;
}

export function evaluateRelayEnterLowerCostUnitCondition(
  game: GameState,
  context: RelayEnterLowerCostUnitContext,
  requiredUnitAlias: string
): RelayEnterLowerCostUnitCondition {
  const sourceCard = getCardById(game, context.sourceCardId);
  if (!sourceCard || !isMemberCardData(sourceCard.data)) {
    return {
      conditionMet: false,
      reason: 'SOURCE_NOT_MEMBER',
      sourceEffectiveCost: null,
      relayReplacementCardIds: [],
      matchingRelayReplacementCardIds: [],
      capturedReplacementEffectiveCosts: [],
    };
  }

  const sourceEffectiveCost = getMemberEffectiveCost(
    game,
    context.controllerId,
    context.sourceCardId
  );
  const replacements = parseRelayReplacements(context.relayReplacements);
  const relayReplacementCardIds = replacements.map((replacement) => replacement.cardId);
  const capturedReplacementEffectiveCosts = replacements.map(
    (replacement) => replacement.effectiveCost
  );
  if (replacements.length === 0) {
    return {
      conditionMet: false,
      reason: 'NOT_RELAY_ENTER',
      sourceEffectiveCost,
      relayReplacementCardIds,
      matchingRelayReplacementCardIds: [],
      capturedReplacementEffectiveCosts,
    };
  }

  const requiredUnitSelector = unitAliasIs(requiredUnitAlias);
  const matchingRelayReplacementCardIds = replacements.flatMap((replacement): string[] => {
    const replacedCard = getCardById(game, replacement.cardId);
    return replacedCard &&
      isMemberCardData(replacedCard.data) &&
      requiredUnitSelector(replacedCard) &&
      replacement.effectiveCost < sourceEffectiveCost
      ? [replacement.cardId]
      : [];
  });

  return {
    conditionMet: matchingRelayReplacementCardIds.length > 0,
    reason:
      matchingRelayReplacementCardIds.length > 0 ? 'MATCHED' : 'NO_LOWER_COST_UNIT_REPLACEMENT',
    sourceEffectiveCost,
    relayReplacementCardIds,
    matchingRelayReplacementCardIds,
    capturedReplacementEffectiveCosts,
  };
}

function parseRelayReplacements(value: unknown): readonly RelayReplacement[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): RelayReplacement[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const cardId = (entry as { readonly cardId?: unknown }).cardId;
    const effectiveCost = (entry as { readonly effectiveCost?: unknown }).effectiveCost;
    return typeof cardId === 'string' &&
      typeof effectiveCost === 'number' &&
      Number.isFinite(effectiveCost)
      ? [{ cardId, effectiveCost }]
      : [];
  });
}
