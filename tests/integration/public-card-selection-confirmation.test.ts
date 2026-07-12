import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  moveSelectedCardsFromZone,
} from '../../src/application/effects/zone-selection';
import { registerActiveEffectStepHandler } from '../../src/application/card-effects/runtime/step-registry';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { CardType, HeartColor } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const ABILITY_ID = 'test:public-waiting-room-selection';
const STEP_ID = 'SELECT_WAITING_ROOM_CARDS';

function member(id: string): ReturnType<typeof createCardInstance> {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, PLAYER1, id);
}

function setup(count = 1, optional = false): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly cardIds: readonly string[];
} {
  const cards = Array.from({ length: count }, (_, index) => member(`waiting-${index}`));
  let game = registerCards(
    createGameState('public-selection-test', PLAYER1, 'P1', PLAYER2, 'P2'),
    cards
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: { ...player.waitingRoom, cardIds: cards.map((card) => card.instanceId) },
  }));
  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: optional ? 0 : count,
    maxCount: count,
    optional,
  });
  game = {
    ...game,
    activeEffect: createWaitingRoomToHandEffectState({
      id: 'public-selection-effect',
      abilityId: ABILITY_ID,
      sourceCardId: cards[0].instanceId,
      controllerId: PLAYER1,
      effectText: '从休息室加入手牌。',
      stepId: STEP_ID,
      stepText: '选择要加入手牌的卡。',
      awaitingPlayerId: PLAYER1,
      selectableCardIds: cards.map((card) => card.instanceId),
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      zoneSelection,
    }),
  };
  registerActiveEffectStepHandler(ABILITY_ID, STEP_ID, (state, input) => {
    const effect = state.activeEffect;
    if (!effect) return state;
    const selected = input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
    const moved = moveSelectedCardsFromZone(
      state,
      effect.controllerId,
      selected,
      getZoneSelectionConfig(effect)
    );
    return moved ? { ...moved, activeEffect: null } : state;
  });
  const session = createGameSession();
  session.createGame('public-selection-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, cardIds: cards.map((card) => card.instanceId) };
}

describe('public waiting-room card selection confirmation', () => {
  it('reveals to both players before movement and only the awaiting player can confirm', () => {
    const { session, cardIds } = setup();
    const effectId = session.state!.activeEffect!.id;
    const opponentAttempt = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER2, effectId, cardIds[0])
    );
    expect(opponentAttempt.success).toBe(false);

    const selected = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, cardIds[0])
    );
    expect(selected.success, selected.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: cardIds,
      confirmSelectionLabel: '加入手牌',
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(cardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);

    const expectedObjectIds = cardIds.map(createPublicObjectId);
    expect(projectPlayerViewState(session.state!, PLAYER1).activeEffect?.revealedObjectIds).toEqual(
      expectedObjectIds
    );
    expect(projectPlayerViewState(session.state!, PLAYER2).activeEffect?.revealedObjectIds).toEqual(
      expectedObjectIds
    );

    const confirmed = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId));
    expect(confirmed.success, confirmed.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual(cardIds);

    const repeated = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId));
    expect(repeated.success).toBe(false);
    expect(session.state?.players[0].hand.cardIds).toEqual(cardIds);
  });

  it('preserves ordered multi selection and skips an empty optional choice without a reveal window', () => {
    const ordered = setup(2);
    const reverse = [...ordered.cardIds].reverse();
    expect(
      ordered.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          ordered.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          reverse
        )
      ).success
    ).toBe(true);
    expect(ordered.session.state?.activeEffect?.revealedCardIds).toEqual(reverse);
    expect(
      ordered.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, ordered.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(ordered.session.state?.players[0].hand.cardIds).toEqual(reverse);

    const skipped = setup(2, true);
    expect(
      skipped.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          skipped.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          []
        )
      ).success
    ).toBe(true);
    expect(skipped.session.state?.activeEffect).toBeNull();
    expect(skipped.session.state?.players[0].waitingRoom.cardIds).toEqual(skipped.cardIds);
  });

  it('restores the original selection when the revealed card becomes stale before final confirmation', () => {
    const { session, cardIds } = setup();
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, effectId, cardIds[0])
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(
      PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID
    );

    const staleState = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      hand: { ...player.hand, cardIds: [cardIds[0]] },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = staleState;

    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId)).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(STEP_ID);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual(cardIds);
  });
});
