import { describe, expect, it } from 'vitest';
import {
  HS_BP8_003_ON_ENTER_BOTH_DISCARD_TO_SIX_ABILITY_ID,
  HS_BP8_012_ON_ENTER_SHUFFLE_WAITING_MEMBERS_BOTTOM_CERISE_GAIN_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { gameWithCards, live, member, P1, P2 } from '../helpers/card-effect-zone-fixture';

const CASES = [
  {
    cardCode: 'PL!HS-bp8-003-P',
    name: '大泽瑠璃乃',
    cost: 10,
    abilityId: HS_BP8_003_ON_ENTER_BOTH_DISCARD_TO_SIX_ABILITY_ID,
  },
  {
    cardCode: 'PL!HS-bp8-012-N',
    name: '百生吟子',
    cost: 7,
    abilityId: HS_BP8_012_ON_ENTER_SHUFFLE_WAITING_MEMBERS_BOTTOM_CERISE_GAIN_HEART_ABILITY_ID,
  },
] as const;

function setup(cardCode: string, activeEnergyCount: number) {
  // Source rules fields come from the October 20 JSON subset; other hand/deck cards are fillers.
  const source = member('source', { cardCode });
  const ownHand = Array.from({ length: 7 }, (_, i) => member(`own-${i}`));
  const opponentHand = Array.from({ length: 7 }, (_, i) => member(`other-${i}`, {}, P2));
  const deck = Array.from({ length: 4 }, (_, i) => member(`deck-${i}`));
  const waitingMembers = Array.from({ length: 3 }, (_, i) =>
    member(`waiting-${i}`, { cardCode: 'PL!HS-bp8-012-N' })
  );
  const waitingLive = live('waiting-live', { cardCode: 'PL!HS-bp8-017-L' });
  const energy = Array.from({ length: activeEnergyCount }, (_, i) =>
    createCardInstance(
      { cardCode: `energy-${i}`, name: 'Energy', cardType: CardType.ENERGY },
      P1,
      `energy-${i}`
    )
  );
  let game = registerCards(
    gameWithCards([source, ...ownHand, ...opponentHand, ...deck, ...waitingMembers, waitingLive]),
    energy
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: ['source', ...ownHand.map((card) => card.instanceId)] },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [...waitingMembers.map((card) => card.instanceId), 'waiting-live'],
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energy.map((card) => card.instanceId),
      cardStates: new Map(
        energy.map((card) => [
          card.instanceId,
          { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE },
        ])
      ),
    },
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: opponentHand.map((card) => card.instanceId) },
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
  session.createGame('october-20-rules', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

describe('October 20 member plays use real RULES commands and printed costs', () => {
  it.each(CASES)('$cardCode 费用$cost「$name」 pays energy and starts its own ON_ENTER', (card) => {
    const session = setup(card.cardCode, card.cost);
    expect(session.state!.cardRegistry.get('source')!.data).toMatchObject({
      cardCode: card.cardCode,
      name: card.name,
      cost: card.cost,
    });
    expect(session.manualOperationMode).toBe('RULES');
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(P1, 'source', SlotPosition.CENTER, { relayMode: 'NONE' })
    );
    expect(result.success, result.error).toBe(true);
    const entrance = session.state!.entranceRuntime?.pending;
    if (entrance)
      expect(
        session.executeCommand({
          type: GameCommandType.ACK_CARD_ENTRANCE,
          playerId: P1,
          entranceId: entrance.id,
          timestamp: Date.now(),
        }).success
      ).toBe(true);
    const state = session.state!;
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('source');
    expect(state.players[0].hand.cardIds).not.toContain('source');
    expect(
      [...state.players[0].energyZone.cardStates.values()].filter(
        (energy) => energy.orientation === OrientationState.WAITING
      )
    ).toHaveLength(card.cost);
    expect(state.eventLog).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: TriggerCondition.ON_ENTER_STAGE,
          cardInstanceId: 'source',
          fromZone: ZoneType.HAND,
        }),
      })
    );
    expect(state.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'TRIGGER_ABILITY',
        payload: expect.objectContaining({ abilityId: card.abilityId, sourceCardId: 'source' }),
      })
    );

    if (card.cardCode === 'PL!HS-bp8-003-P') {
      expect(state.activeEffect).toMatchObject({
        abilityId: card.abilityId,
        sourceCardId: 'source',
        awaitingPlayerId: P1,
        minSelectableCards: 1,
        maxSelectableCards: 1,
      });
      for (const [playerId, selection] of [
        [P1, 'own-0'],
        [P2, 'other-0'],
      ] as const) {
        const selectionResult = session.executeCommand(
          createConfirmEffectStepCommand(
            playerId,
            session.state!.activeEffect!.id,
            undefined,
            undefined,
            undefined,
            undefined,
            [selection]
          )
        );
        expect(selectionResult.success, selectionResult.error).toBe(true);
      }
      expect(session.state!.players.map((player) => player.hand.cardIds.length)).toEqual([6, 6]);
      expect(session.state!.activeEffect).toBeNull();
    } else {
      expect(state.players[0].waitingRoom.cardIds).toEqual(['waiting-live']);
      expect(state.players[0].mainDeck.cardIds.slice(0, 4)).toEqual([
        'deck-0',
        'deck-1',
        'deck-2',
        'deck-3',
      ]);
      expect(new Set(state.players[0].mainDeck.cardIds.slice(4))).toEqual(
        new Set(['waiting-0', 'waiting-1', 'waiting-2'])
      );
      expect(state.liveResolution.liveModifiers).toContainEqual(
        expect.objectContaining({
          kind: 'HEART',
          target: 'SOURCE_MEMBER',
          sourceCardId: 'source',
          abilityId: card.abilityId,
          hearts: [{ color: HeartColor.GREEN, count: 2 }],
        })
      );
      expect(state.activeEffect).toBeNull();
    }
  });

  it.each(CASES)(
    '$cardCode rejects $cost minus one energy without payment, movement or trigger',
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
      expect(after.liveResolution.liveModifiers).toEqual([]);
      expect(after.entranceRuntime?.pending).toBeUndefined();
      expect(after.players[0].hand.cardIds).toContain('source');
      expect(after.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
      expect(
        [...after.players[0].energyZone.cardStates.values()].every(
          (energy) => energy.orientation === OrientationState.ACTIVE
        )
      ).toBe(true);
    }
  );
});
