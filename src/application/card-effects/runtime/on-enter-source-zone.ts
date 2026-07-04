import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import { ZoneType } from '../../../shared/types/enums.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface ConsumeOnEnterSourceZoneNoOpOptions {
  readonly expectedFromZone: ZoneType;
  readonly orderedResolution: boolean;
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
  readonly step?: string;
}

export function isOnEnterFromZone(
  ability: Pick<PendingAbilityState, 'metadata'>,
  expectedFromZone: ZoneType
): boolean {
  return ability.metadata?.fromZone === expectedFromZone;
}

export function isOnEnterFromWaitingRoom(
  ability: Pick<PendingAbilityState, 'metadata'>
): boolean {
  return isOnEnterFromZone(ability, ZoneType.WAITING_ROOM);
}

export function consumeOnEnterSourceZoneMismatch(
  game: GameState,
  ability: PendingAbilityState,
  options: ConsumeOnEnterSourceZoneNoOpOptions
): GameState {
  return consumeOnEnterSourceZoneNoOp(game, ability, {
    ...options,
    step: options.step ?? 'ON_ENTER_SOURCE_ZONE_MISMATCH',
  });
}

export function consumeOnEnterSourceZoneNoOp(
  game: GameState,
  ability: PendingAbilityState,
  options: ConsumeOnEnterSourceZoneNoOpOptions
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return options.continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: options.step ?? 'ON_ENTER_SOURCE_ZONE_NO_OP',
      expectedFromZone: options.expectedFromZone,
      actualFromZone: getActualFromZone(ability),
    }),
    options.orderedResolution
  );
}

function getActualFromZone(ability: Pick<PendingAbilityState, 'metadata'>): ZoneType | null {
  const fromZone = ability.metadata?.fromZone;
  return typeof fromZone === 'string' ? (fromZone as ZoneType) : null;
}
