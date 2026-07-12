import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
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
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function setupState(): {
  readonly game: GameState;
  readonly ids: Readonly<Record<string, string>>;
} {
  const source = createCardInstance(createMember('PL!N-bp3-010-R', '三船栞子'), PLAYER1, 'source');
  const live = createCardInstance(createLive('PL!N-test-live-L'), PLAYER1, 'live');
  const deckTop = createCardInstance(createMember('PL!N-test-deck-top', 'Deck Top'), PLAYER1, 'deck-top');
  const ownA = createCardInstance(createMember('PL!N-own-a', 'Own A'), PLAYER1, 'own-a');
  const ownB = createCardInstance(createMember('PL!N-own-b', 'Own B'), PLAYER1, 'own-b');
  const ownC = createCardInstance(createMember('PL!N-own-c', 'Own C'), PLAYER1, 'own-c');
  const ownLive = createCardInstance(createLive('PL!N-own-live-L'), PLAYER1, 'own-live');
  const oppDeckTop = createCardInstance(
    createMember('PL!N-opp-deck-top', 'Opponent Deck Top'),
    PLAYER2,
    'opp-deck-top'
  );
  const oppA = createCardInstance(createMember('PL!N-opp-a', 'Opponent A'), PLAYER2, 'opp-a');
  const oppB = createCardInstance(createMember('PL!N-opp-b', 'Opponent B'), PLAYER2, 'opp-b');
  const oppC = createCardInstance(createMember('PL!N-opp-c', 'Opponent C'), PLAYER2, 'opp-c');

  let game = createGameState('n-bp3-010-shioriko', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    live,
    deckTop,
    ownA,
    ownB,
    ownC,
    ownLive,
    oppDeckTop,
    oppA,
    oppB,
    oppC,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    mainDeck: addCardToZone(player.mainDeck, deckTop.instanceId),
    waitingRoom: [ownA.instanceId, ownB.instanceId, ownC.instanceId, ownLive.instanceId].reduce(
      (zone, cardId) => addCardToZone(zone, cardId),
      player.waitingRoom
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    mainDeck: addCardToZone(player.mainDeck, oppDeckTop.instanceId),
    waitingRoom: [oppA.instanceId, oppB.instanceId, oppC.instanceId].reduce(
      (zone, cardId) => addCardToZone(zone, cardId),
      player.waitingRoom
    ),
  }));

  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: PLAYER1,
      },
    },
    ids: {
      source: source.instanceId,
      deckTop: deckTop.instanceId,
      ownA: ownA.instanceId,
      ownB: ownB.instanceId,
      ownC: ownC.instanceId,
      ownLive: ownLive.instanceId,
      oppDeckTop: oppDeckTop.instanceId,
      oppA: oppA.instanceId,
      oppB: oppB.instanceId,
      oppC: oppC.instanceId,
    },
  };
}

function startLiveStartSelection(game: GameState): GameSession {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  const session = createGameSession();
  session.createGame('n-bp3-010-shioriko-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  expect(session.state?.activeEffect).toMatchObject({
    abilityId: PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID,
    selectableOptions: [
      { id: PLAYER1, label: '自己' },
      { id: PLAYER2, label: '对方' },
    ],
  });
  return session;
}

function selectTargetPlayer(session: GameSession, playerId: string): void {
  const effect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effect.id, undefined, undefined, undefined, playerId)
  );
  expect(result.success).toBe(true);
  if (session.state?.activeEffect?.stepId === 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION') {
    const confirmed = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effect.id));
    expect(confirmed.success).toBe(true);
  }
}

function moveSelectedCards(session: GameSession, selectedCardIds: readonly string[]): void {
  const effect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effect.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
  expect(result.success).toBe(true);
  if (session.state?.activeEffect?.stepId === 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION') {
    const confirmed = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effect.id));
    expect(confirmed.success).toBe(true);
  }
}

describe('PL!N-bp3-010 三船栞子', () => {
  it('chooses own waiting-room members and moves up to two to own deck bottom in selected order', () => {
    const { game, ids } = setupState();
    const session = startLiveStartSelection(game);

    selectTargetPlayer(session, PLAYER1);
    expect(session.state?.activeEffect).toMatchObject({
      selectableCardMode: 'ORDERED_MULTI',
      selectableCardVisibility: 'PUBLIC',
      minSelectableCards: 0,
      maxSelectableCards: 2,
      skipSelectionLabel: '不放置',
      selectableCardIds: [ids.ownA, ids.ownB, ids.ownC],
    });
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();

    moveSelectedCards(session, [ids.ownB, ids.ownA]);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      ids.deckTop,
      ids.ownB,
      ids.ownA,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([ids.ownC, ids.ownLive]);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID,
      step: 'MOVE_WAITING_MEMBERS_TO_DECK_BOTTOM',
      targetPlayerId: PLAYER1,
      movedCardIds: [ids.ownB, ids.ownA],
    });
  });

  it('can choose opponent and move opponent waiting-room members to opponent deck bottom', () => {
    const { game, ids } = setupState();
    const session = startLiveStartSelection(game);

    selectTargetPlayer(session, PLAYER2);
    expect(session.state?.activeEffect).toMatchObject({
      selectableCardMode: 'ORDERED_MULTI',
      selectableCardVisibility: 'PUBLIC',
      selectableCardIds: [ids.oppA, ids.oppB, ids.oppC],
    });

    moveSelectedCards(session, [ids.oppB, ids.oppA]);

    expect(session.state?.players[1].mainDeck.cardIds).toEqual([
      ids.oppDeckTop,
      ids.oppB,
      ids.oppA,
    ]);
    expect(session.state?.players[1].waitingRoom.cardIds).toEqual([ids.oppC]);
  });

  it('allows choosing zero cards and still consumes the pending ability', () => {
    const { game, ids } = setupState();
    const session = startLiveStartSelection(game);

    selectTargetPlayer(session, PLAYER1);
    moveSelectedCards(session, []);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([ids.deckTop]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      ids.ownA,
      ids.ownB,
      ids.ownC,
      ids.ownLive,
    ]);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      movedCardIds: [],
      selectedCardIds: [],
    });
  });

  it('rejects non-member, wrong-player, and over-limit selections before resolution', () => {
    const { game, ids } = setupState();
    const nonMemberSession = startLiveStartSelection(game);
    selectTargetPlayer(nonMemberSession, PLAYER1);
    const nonMemberEffect = nonMemberSession.state!.activeEffect!;
    expect(nonMemberEffect.selectableCardIds).not.toContain(ids.ownLive);
    expect(
      nonMemberSession.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          nonMemberEffect.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [ids.ownLive]
        )
      ).success
    ).toBe(false);

    const wrongPlayerSession = startLiveStartSelection(game);
    selectTargetPlayer(wrongPlayerSession, PLAYER1);
    const wrongPlayerEffect = wrongPlayerSession.state!.activeEffect!;
    expect(wrongPlayerEffect.selectableCardIds).not.toContain(ids.oppA);
    expect(
      wrongPlayerSession.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          wrongPlayerEffect.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [ids.oppA]
        )
      ).success
    ).toBe(false);

    const overLimitSession = startLiveStartSelection(game);
    selectTargetPlayer(overLimitSession, PLAYER1);
    const overLimitEffect = overLimitSession.state!.activeEffect!;
    expect(
      overLimitSession.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          overLimitEffect.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [ids.ownA, ids.ownB, ids.ownC]
        )
      ).success
    ).toBe(false);
    expect(overLimitSession.state?.players[0].mainDeck.cardIds).toEqual([ids.deckTop]);
    expect(overLimitSession.state?.players[0].waitingRoom.cardIds).toEqual([
      ids.ownA,
      ids.ownB,
      ids.ownC,
      ids.ownLive,
    ]);
  });
});
