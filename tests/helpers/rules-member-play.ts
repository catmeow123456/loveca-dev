import { expect } from 'vitest';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { CardType, GamePhase, OrientationState, SlotPosition } from '../../src/shared/types/enums';

export function expectMemberPlayAtPrintedCost(data: MemberCardData): void {
  const member = createCardInstance(data, 'p1', 'member');
  const energy = Array.from({ length: data.cost }, (_, n) =>
    createCardInstance(
      { cardType: CardType.ENERGY, cardCode: 'LL-E-001-SD', name: '能量' },
      'p1',
      `energy-${n}`
    )
  );
  const deckCards = ['p1', 'p2'].map((id) => createCardInstance(data, id, `deck-${id}`));
  let game = registerCards(createGameState('draft-play', 'p1', 'P1', 'p2', 'P2'), [
    member,
    ...energy,
    ...deckCards,
  ]);
  for (const card of deckCards) {
    game = updatePlayer(game, card.ownerId, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: [card.instanceId] },
    }));
  }
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: [member.instanceId] },
    energyZone: energy
      .slice(1)
      .reduce((zone, card) => addCardToStatefulZone(zone, card.instanceId), p.energyZone),
  }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, isStarted: true, turnCount: 2 };
  const session = createGameSession();
  const play = () =>
    session.executeCommand(
      createPlayMemberToSlotCommand('p1', member.instanceId, SlotPosition.CENTER)
    );
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  expect(session.manualOperationMode).toBe('RULES');
  expect(play().success).toBe(false);
  expect(session.state!.players[0].hand.cardIds).toContain(member.instanceId);

  const funded = updatePlayer(game, 'p1', (p) => ({
    ...p,
    energyZone: addCardToStatefulZone(p.energyZone, energy[0].instanceId),
  }));
  session.restoreRuntimeState({ authorityState: funded, currentPublicSeq: 0 });
  const result = play();
  expect(result.success, result.error).toBe(true);
  const player = session.state!.players[0];
  expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(member.instanceId);
  expect(player.hand.cardIds).not.toContain(member.instanceId);
  expect(
    [...player.energyZone.cardStates.values()].filter(
      (card) => card.orientation === OrientationState.WAITING
    )
  ).toHaveLength(data.cost);
}
