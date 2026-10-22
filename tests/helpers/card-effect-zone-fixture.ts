import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { CardType, HeartColor, TriggerCondition } from '../../src/shared/types/enums';
import sourceRows from '../fixtures/october-20-on-enter-copy-sources.json';

export function sourceCardFixture(cardCode: string): MemberCardData | LiveCardData | undefined {
  const row = (sourceRows as unknown as Readonly<Record<string, Record<string, unknown>>>)[
    cardCode
  ];
  if (!row) return undefined;
  if (row.cardType === CardType.MEMBER) return { ...row } as unknown as MemberCardData;
  const requirements = row.requirements as readonly {
    readonly color: HeartColor;
    readonly count: number;
  }[];
  return {
    ...row,
    requirements: createHeartRequirement(
      Object.fromEntries(requirements.map((entry) => [entry.color, entry.count]))
    ),
  } as unknown as LiveCardData;
}

export const P1 = 'p1',
  P2 = 'p2';
export function member(id: string, options: Partial<MemberCardData> = {}, ownerId = P1) {
  return createCardInstance(
    {
      cardCode: id,
      name: id,
      cardType: CardType.MEMBER,
      cost: 7,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      groupNames: ['蓮ノ空'],
      ...(options.cardCode ? sourceCardFixture(options.cardCode) : {}),
      ...options,
    },
    ownerId,
    id
  );
}
export function live(id: string, options: Partial<LiveCardData> = {}, ownerId = P1) {
  return createCardInstance(
    {
      cardCode: id,
      name: id,
      cardType: CardType.LIVE,
      score: 0,
      requirements: createHeartRequirement({ [HeartColor.GRAY]: 1 }),
      groupNames: ['蓮ノ空'],
      ...(options.cardCode ? sourceCardFixture(options.cardCode) : {}),
      ...options,
    },
    ownerId,
    id
  );
}
export function gameWithCards(
  cards: readonly ReturnType<typeof member | typeof live>[]
): GameState {
  return registerCards(createGameState('zone-effect-fixture', P1, 'P1', P2, 'P2'), [...cards]);
}
export function pending(
  abilityId: string,
  sourceCardId: string,
  timing = TriggerCondition.ON_LIVE_START
): PendingAbilityState {
  return {
    id: `pending:${abilityId}`,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: timing,
    eventIds: [],
  };
}
export function start(
  game: GameState,
  abilityId: string,
  sourceCardId: string,
  timing = TriggerCondition.ON_LIVE_START
): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [...game.pendingAbilities, pending(abilityId, sourceCardId, timing)],
  }).gameState;
}
export function choose(game: GameState, cardId?: string | null): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
}
export function chooseMany(game: GameState, ids: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    ids.length ? undefined : null,
    undefined,
    undefined,
    undefined,
    ids.length ? ids : undefined
  );
}
