import { describe, expect, it } from 'vitest';
import {
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance, isMemberCardData } from '../../src/domain/entities/card';
import { updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { gameWithCards, member, P1, P2 } from '../helpers/card-effect-zone-fixture';
import { getOctober26CardData, OCTOBER_26_CARD_CODES } from '../helpers/october-26-card-effects';

const MEMBERS = OCTOBER_26_CARD_CODES.map(getOctober26CardData).filter(isMemberCardData);

function setup(cardCode: string, activeEnergyCount: number) {
  const source = createCardInstance(getOctober26CardData(cardCode), P1, 'source');
  const filler = member('hand-filler');
  const deck = Array.from({ length: 6 }, (_, index) => member(`deck-${index}`));
  const energy = Array.from({ length: activeEnergyCount }, (_, index) =>
    createCardInstance(
      { cardType: CardType.ENERGY, cardCode: `energy-${index}`, name: '能量' },
      P1,
      `energy-${index}`
    )
  );
  let game = gameWithCards([source, filler, ...deck, ...energy]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: ['source', 'hand-filler'] },
    mainDeck: { ...player.mainDeck, cardIds: deck.map(({ instanceId }) => instanceId) },
    energyZone: {
      ...player.energyZone,
      cardIds: energy.map(({ instanceId }) => instanceId),
      cardStates: new Map(
        energy.map(({ instanceId }) => [
          instanceId,
          {
            face: FaceState.FACE_UP,
            orientation: OrientationState.ACTIVE,
          },
        ])
      ),
    },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
    manualOperationMode: 'RULES',
  };
  const session = createGameSession({ cardEntrance: 'LOCAL' });
  session.createGame(`october-26-rules-${cardCode}`, P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

describe('October 26 member cards use exported costs through RULES commands', () => {
  it('covers all eight new member cards', () => expect(MEMBERS).toHaveLength(8));

  it.each(MEMBERS)('$cardCode 费用$cost「$name」 pays its printed cost before entering', (card) => {
    const session = setup(card.cardCode, card.cost);
    expect(session.manualOperationMode).toBe('RULES');
    const played = session.executeCommand(
      createPlayMemberToSlotCommand(P1, 'source', SlotPosition.CENTER, { relayMode: 'NONE' })
    );
    expect(played.success, played.error).toBe(true);
    const entrance = session.state!.entranceRuntime?.pending;
    if (entrance) {
      const ack = session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId: P1,
        entranceId: entrance.id,
        timestamp: Date.now(),
      });
      expect(ack.success, ack.error).toBe(true);
    }
    const state = session.state!;
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('source');
    expect(state.players[0].hand.cardIds).not.toContain('source');
    expect(
      [...state.players[0].energyZone.cardStates.values()].filter(
        ({ orientation }) => orientation === OrientationState.WAITING
      )
    ).toHaveLength(card.cost);
    expect(state.cardRegistry.get('source')!.data).toMatchObject({
      name: card.name,
      cost: card.cost,
    });
    expect(state.eventLog).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: TriggerCondition.ON_ENTER_STAGE,
          cardInstanceId: 'source',
          fromZone: ZoneType.HAND,
        }),
      })
    );
    if (card.cardCode === 'PL!HS-bp8-014-N' || card.cardCode === 'PL!N-bp8-006-R') {
      expect(state.actionHistory).toContainEqual(
        expect.objectContaining({
          type: 'TRIGGER_ABILITY',
          payload: expect.objectContaining({ sourceCardId: 'source' }),
        })
      );
    }
  });

  it.each(MEMBERS)(
    '$cardCode rejects insufficient energy without movement, payment or triggering',
    (card) => {
      const session = setup(card.cardCode, card.cost - 1);
      const before = session.state!;
      expect(session.manualOperationMode).toBe('RULES');
      const result = session.executeCommand(
        createPlayMemberToSlotCommand(P1, 'source', SlotPosition.CENTER, { relayMode: 'NONE' })
      );
      expect(result.success).toBe(false);
      const after = session.state!;
      expect(after.players).toEqual(before.players);
      expect(after.eventLog).toEqual(before.eventLog);
      expect(after.actionHistory).toEqual(before.actionHistory);
      expect(after.pendingAbilities).toEqual([]);
      expect(after.activeEffect).toBeNull();
      expect(after.entranceRuntime?.pending).toBeUndefined();
    }
  );
});
