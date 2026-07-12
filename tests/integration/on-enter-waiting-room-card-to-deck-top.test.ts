import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const CARD_CODES = [
  'PL!N-bp4-021-N',
  'PL!SP-bp2-013-N',
  'PL!SP-bp2-014-N',
  'PL!SP-bp2-018-N',
] as const;

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['test'],
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setup(cardCode: string, waitingCount = 1): {
  state: GameState;
  targetIds: string[];
  deckTopId: string;
} {
  const source = createCardInstance(createMember(cardCode), PLAYER1, `source-${cardCode}`);
  const targets = Array.from({ length: waitingCount }, (_, index) =>
    createCardInstance(createMember(`WAITING-${index}`), PLAYER1, `waiting-${index}`)
  );
  const deckTop = createCardInstance(createMember('DECK-TOP'), PLAYER1, 'deck-top');
  let game = createGameState(`on-enter-deck-top-${cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...targets, deckTop]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: { ...player.waitingRoom, cardIds: targets.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: [deckTop.instanceId] },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(game, {
    eventId: `enter-${cardCode}`,
    eventType: TriggerCondition.ON_ENTER_STAGE,
    timestamp: 1,
    cardInstanceId: source.instanceId,
    fromZone: ZoneType.HAND,
    toZone: ZoneType.MEMBER_SLOT,
    toSlot: SlotPosition.CENTER,
    ownerId: PLAYER1,
    controllerId: PLAYER1,
  });
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(result.success, result.error).toBe(true);
  return {
    state: result.gameState,
    targetIds: targets.map((card) => card.instanceId),
    deckTopId: deckTop.instanceId,
  };
}

function attachSession(state: GameState) {
  const session = createGameSession();
  session.createGame('on-enter-deck-top-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function expirePublicWindow(session: ReturnType<typeof createGameSession>): number {
  const effect = session.state!.activeEffect!;
  const deadline = effect.publicCardSelectionAutoAdvanceAt!;
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    activeEffect: { ...effect, publicCardSelectionAutoAdvanceAt: 0 },
  };
  return deadline;
}

describe('shared on-enter waiting-room card to deck-top workflow', () => {
  it.each(CARD_CODES)('%s queues and opens the same shared selection workflow', (cardCode) => {
    const { state, targetIds } = setup(cardCode);
    expect(state.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
      selectableCardIds: targetIds,
      selectionLabel: '选择要放置于卡组顶的卡',
      confirmSelectionLabel: '放置于卡组顶',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
    });
    expect(state.pendingAbilities).toHaveLength(0);
  });

  it('consumes an empty waiting-room pending without opening an empty selection', () => {
    const { state, deckTopId } = setup(CARD_CODES[1], 0);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].mainDeck.cardIds).toEqual([deckTopId]);
  });

  it('allows explicitly choosing not to place a card and continues pending', () => {
    const { state, targetIds, deckTopId } = setup(CARD_CODES[2]);
    const session = attachSession(state);
    const effectId = session.state!.activeEffect!.id;
    const result = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, null));
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toHaveLength(0);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(targetIds);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckTopId]);
  });

  it.each([PLAYER1, PLAYER2])(
    'first submission only reveals; after the deadline %s can resume exactly once',
    (resumingPlayerId) => {
      const { state, targetIds, deckTopId } = setup(CARD_CODES[3]);
      const session = attachSession(state);
      const effectId = session.state!.activeEffect!.id;
      const beforeRewards = session.state!.actionHistory.length;
      const selected = session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, effectId, targetIds[0])
      );
      expect(selected.success, selected.error).toBe(true);
      expect(session.state?.activeEffect).toMatchObject({
        stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
        revealedCardIds: targetIds,
      });
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual(targetIds);
      expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckTopId]);
      expect(session.state?.pendingAbilities).toHaveLength(0);
      expect(session.state?.actionHistory).toHaveLength(beforeRewards);

      const deadline = session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!;
      expect(
        session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(resumingPlayerId, effectId, deadline)
        ).success
      ).toBe(false);

      expirePublicWindow(session);
      const resumed = session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(resumingPlayerId, effectId, 0)
      );
      expect(resumed.success, resumed.error).toBe(true);
      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
      expect(session.state?.players[0].mainDeck.cardIds).toEqual([targetIds[0], deckTopId]);
      expect(
        session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(PLAYER1, effectId, 0)
        ).success
      ).toBe(false);
      expect(session.state?.players[0].mainDeck.cardIds).toEqual([targetIds[0], deckTopId]);
    }
  );

  it('revalidates at deadline and does not move or advance a stale target', () => {
    const { state, targetIds, deckTopId } = setup(CARD_CODES[0]);
    const session = attachSession(state);
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, targetIds[0])).success
    ).toBe(true);
    const staleState = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      hand: { ...player.hand, cardIds: [targetIds[0]] },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = staleState;
    expirePublicWindow(session);
    const result = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 0)
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect?.stepId).not.toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckTopId]);
    expect(session.state?.players[0].hand.cardIds).toEqual(targetIds);
  });

  it('rejects non-candidate, duplicate, and stale selection payloads without advancing', () => {
    const { state, targetIds, deckTopId } = setup(CARD_CODES[1], 2);
    const session = attachSession(state);
    const effectId = session.state!.activeEffect!.id;
    const illegal = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, deckTopId)
    );
    expect(illegal.success).toBe(false);
    const duplicate = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        effectId,
        undefined,
        undefined,
        undefined,
        undefined,
        [targetIds[0], targetIds[0]]
      )
    );
    expect(duplicate.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(effectId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(targetIds);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckTopId]);
  });
});
