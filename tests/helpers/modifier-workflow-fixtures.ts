import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
  type LiveCardData,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { createGameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicEffectChoiceCommand,
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { getBaseCardCode } from '../../src/shared/utils/card-code';
import { sourceCardFixture } from './card-effect-zone-fixture';
const SOURCE_PRINTS: Readonly<Record<string, string>> = {
  'PL!HS-bp8-003': 'PL!HS-bp8-003-P',
  'PL!HS-bp8-013': 'PL!HS-bp8-013-N',
  'PL!N-bp8-010': 'PL!N-bp8-010-P',
  'PL!N-bp8-019': 'PL!N-bp8-019-N',
  'PL!N-bp8-026': 'PL!N-bp8-026-SECL',
  'PL!N-bp8-028': 'PL!N-bp8-028-L',
  'PL!SP-PR-035': 'PL!SP-PR-035-PR',
};
function printedSource(code: string) {
  return sourceCardFixture(code) ?? sourceCardFixture(SOURCE_PRINTS[getBaseCardCode(code)] ?? '');
}

export const P1 = 'player1';
export const P2 = 'player2';
// Explicit synthetic rule fields: fixtures never infer missing printed Hearts/Blade Hearts from export nulls.
export function member(
  code: string,
  id = code,
  owner = P1,
  overrides: Partial<MemberCardData> = {}
): CardInstance & { readonly data: MemberCardData } {
  const printed = printedSource(code);
  const data: MemberCardData = {
    name: code,
    cardType: CardType.MEMBER,
    groupNames: ['虹ヶ咲'],
    cost: 9,
    blade: 1,
    hearts: [{ color: HeartColor.RED, count: 1 }],
    bladeHearts: [],
    ...(printed?.cardType === CardType.MEMBER ? printed : {}),
    cardCode: code,
    ...overrides,
  };
  return { ...createCardInstance(data, owner, id), data };
}
export function live(
  code: string,
  id = code,
  overrides: Partial<LiveCardData> = {}
): CardInstance & { readonly data: LiveCardData } {
  const printed = printedSource(code);
  const data: LiveCardData = {
    name: code,
    cardType: CardType.LIVE,
    groupNames: ['虹ヶ咲'],
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1, [HeartColor.RAINBOW]: 10 }),
    bladeHearts: [],
    ...(printed?.cardType === CardType.LIVE ? printed : {}),
    cardCode: code,
    ...overrides,
  };
  return { ...createCardInstance(data, P1, id), data };
}
export function gameWith(cards: readonly CardInstance[]): GameState {
  return registerCards(createGameState('modifier-workflow', P1, 'P1', P2, 'P2'), [...cards]);
}
export function stage(game: GameState, cards: readonly CardInstance[], owner = P1): GameState {
  return updatePlayer(game, owner, (player) => ({
    ...player,
    memberSlots: cards.reduce(
      (slots, card, index) =>
        placeCardInSlot(
          slots,
          [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
          card.instanceId,
          { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }
        ),
      player.memberSlots
    ),
  }));
}
export function liveZone(game: GameState, card: CardInstance): GameState {
  return updatePlayer(game, card.ownerId, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, card.instanceId, {
      face: FaceState.FACE_UP,
      orientation: OrientationState.ACTIVE,
    }),
  }));
}
export function hand(game: GameState, cards: readonly CardInstance[], owner = P1): GameState {
  return updatePlayer(game, owner, (player) => ({
    ...player,
    hand: cards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
  }));
}
export function start(
  game: GameState,
  source: CardInstance,
  abilityId: string,
  timingId = TriggerCondition.ON_LIVE_START
): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      {
        id: `pending:${source.instanceId}`,
        abilityId,
        sourceCardId: source.instanceId,
        controllerId: source.ownerId,
        mandatory: true,
        timingId,
        eventIds: [],
      },
    ],
  }).gameState;
}
export function sessionFor(game: GameState) {
  const session = createGameSession();
  session.createGame('modifier-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}
export function setState(session: ReturnType<typeof sessionFor>, game: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}
export function confirm(
  session: ReturnType<typeof sessionFor>,
  playerId: string,
  ids?: readonly string[]
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      playerId,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ids
    )
  );
}
export function choose(session: ReturnType<typeof sessionFor>, color: HeartColor) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      color
    )
  );
  if (!result.success) return result;
  const effect = session.state!.activeEffect!;
  setState(session, {
    ...session.state!,
    activeEffect: { ...effect, publicEffectChoiceAutoAdvanceAt: 0 },
  });
  return session.executeCommand(createAutoAdvancePublicEffectChoiceCommand(P2, effect.id, 0));
}
export function advanceReveal(session: ReturnType<typeof sessionFor>) {
  const effect = session.state!.activeEffect!;
  const generation = effect.publicRevealGeneration ?? 'fixture-generation';
  setState(session, {
    ...session.state!,
    activeEffect: { ...effect, publicRevealGeneration: generation, publicRevealAutoAdvanceAt: 0 },
  });
  return session.executeCommand(createAutoAdvancePublicRevealCommand(P2, effect.id, 0, generation));
}
