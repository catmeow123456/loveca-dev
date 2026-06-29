import type { GameState } from '../../../domain/entities/game.js';
import { isMemberLiveStartSuppressed } from '../../../domain/rules/live-start-suppressions.js';
import type { SlotPosition } from '../../../shared/types/enums.js';
import type {
  CardAbilityDefinition,
} from '../ability-definition-types.js';
import { CardAbilitySourceZone } from '../ability-definition-types.js';

export interface LiveStartSuppressionContext {
  readonly game: GameState;
  readonly performingPlayerId: string;
  readonly liveCardIds: readonly string[];
  readonly sourceCardId: string;
  readonly sourceZone: CardAbilitySourceZone;
  readonly sourceSlot?: SlotPosition;
  readonly abilityDefinition: CardAbilityDefinition;
}

export type LiveStartSuppressionGate = (context: LiveStartSuppressionContext) => boolean;

const liveStartSuppressionGates = new Map<string, LiveStartSuppressionGate>();

export function registerLiveStartSuppressionGate(
  gateId: string,
  gate: LiveStartSuppressionGate
): void {
  liveStartSuppressionGates.set(gateId, gate);
}

export function isLiveStartAbilitySuppressed(context: LiveStartSuppressionContext): boolean {
  if (
    context.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
    isMemberLiveStartSuppressed(context.game, context.performingPlayerId, context.sourceCardId)
  ) {
    return true;
  }

  for (const gate of liveStartSuppressionGates.values()) {
    if (gate(context)) {
      return true;
    }
  }
  return false;
}
