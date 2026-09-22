import type { GameState } from '../../../domain/entities/game.js';
import { getCardById, getPlayerById } from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import { getMemberBelowMember } from '../../../domain/entities/zone.js';
import type { CardInstance } from '../../../domain/entities/card.js';
import type { SlotPosition } from '../../../shared/types/enums.js';
import type { EffectCostDefinition } from '../../effects/effect-costs.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';

/** Current, deterministic facts only. These queries never pay, trigger, or trial-resolve an effect. */
export interface ActivatedAbilityResources {
  readonly costs: readonly EffectCostDefinition[];
  readonly targetCardIds: readonly string[];
  readonly destination: 'HAND' | 'SOURCE_MEMBER_SLOT';
  readonly sourceSlot?: SlotPosition;
  /** The owning workflow reaches this card choice directly after cost, without drawing/revealing.
   * Consumers must still requery the actual window and discard preselection on interruptions. */
  readonly immediateSelection?: {
    readonly stepId: string;
    readonly min: number;
    readonly max: number;
    readonly canSkip: boolean;
  };
}

type ActivationQuery = (
  game: GameState,
  playerId: string,
  sourceCardId: string
) => ActivatedAbilityResources | undefined;
const activationQueries = new Map<string, ActivationQuery>();

export function registerActivatedAbilityResourceQuery(
  abilityId: string,
  query: ActivationQuery
): void {
  activationQueries.set(abilityId, query);
}

export function queryActivatedAbilityResources(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string
): ActivatedAbilityResources | undefined {
  return activationQueries.get(abilityId)?.(game, playerId, sourceCardId);
}

/** The source and its member stack reach the waiting room when paying the shared source cost. */
export function selectWaitingRoomTargetsAfterSourceCost(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  selector: (card: CardInstance) => boolean
): readonly string[] {
  const player = getPlayerById(game, playerId);
  const slot = player && findMemberSlot(player, sourceCardId);
  if (!player || !slot) return [];
  return [
    ...player.waitingRoom.cardIds,
    sourceCardId,
    ...getMemberBelowMember(player.memberSlots, slot),
  ].filter((id) => {
    const card = getCardById(game, id);
    return card !== null && selector(card);
  });
}

export interface MemberEntryResources {
  readonly conditionMet: boolean;
  readonly conditionCardIds: readonly string[];
  /** Maximum permitted by the effect; actual recovery also needs waiting energy at resolution. */
  readonly activateEnergyUpTo: number;
  readonly recoverLiveCardIds: readonly string[];
}

type EntryQuery = (
  game: GameState,
  playerId: string,
  enteringCardId: string,
  leavingCardIds: readonly string[]
) => MemberEntryResources;
const entryQueries = new Map<string, EntryQuery>();

export function registerMemberEntryResourceQuery(abilityId: string, query: EntryQuery): void {
  entryQueries.set(abilityId, query);
}

/** Only registered ON_ENTER facts are reported; omitted abilities are not claimed to do nothing. */
export function queryMemberEntryResources(
  game: GameState,
  playerId: string,
  enteringCardId: string,
  targetSlot: SlotPosition,
  leavingCardIds: readonly string[]
): readonly (MemberEntryResources & { readonly abilityId: string })[] {
  const card = getCardById(game, enteringCardId);
  return getCardAbilityDefinitionsForCardCode(card?.data.cardCode).flatMap((definition) => {
    if (
      definition.category !== 'ON_ENTER' ||
      (definition.requiredSourceSlots && !definition.requiredSourceSlots.includes(targetSlot))
    )
      return [];
    const query = entryQueries.get(definition.abilityId);
    return query
      ? [
          {
            abilityId: definition.abilityId,
            ...query(game, playerId, enteringCardId, leavingCardIds),
          },
        ]
      : [];
  });
}
