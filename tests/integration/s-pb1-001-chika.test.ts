import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { AnyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLive(cardCode: string, score = 3): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function instance<TData extends AnyCardData>(
  data: TData,
  id: string,
  ownerId = PLAYER1
): CardInstance<TData> {
  return createCardInstance(data, ownerId, id);
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('s-pb1-001-chika', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setupChika(options: {
  readonly sourceCardCode?: 'PL!S-pb1-001-R' | 'PL!S-pb1-001-P＋';
  readonly ownHandCount?: number;
  readonly opponentHandCount?: number;
  readonly waitingRoomCards?: readonly CardInstance<AnyCardData>[];
} = {}): {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly ownHandCards: readonly CardInstance<MemberCardData>[];
  readonly opponentHandCards: readonly CardInstance<MemberCardData>[];
  readonly waitingRoomCards: readonly CardInstance<AnyCardData>[];
} {
  const source = instance(
    createMember(options.sourceCardCode ?? 'PL!S-pb1-001-R', {
      name: '高海千歌',
      cost: 13,
    }),
    'chika-source'
  );
  const ownHandCards = Array.from({ length: options.ownHandCount ?? 1 }, (_, index) =>
    instance(createMember(`own-hand-${index}`), `own-hand-${index}`)
  );
  const opponentHandCards = Array.from({ length: options.opponentHandCount ?? 3 }, (_, index) =>
    instance(createMember(`opponent-hand-${index}`), `opponent-hand-${index}`, PLAYER2)
  );
  const waitingRoomCards =
    options.waitingRoomCards ??
    [
      instance(createLive('waiting-live'), 'waiting-live'),
      instance(createMember('waiting-member'), 'waiting-member'),
    ];

  let game = createGameState('s-pb1-001-chika', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...ownHandCards, ...opponentHandCards, ...waitingRoomCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    hand: ownHandCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    waitingRoom: waitingRoomCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    hand: opponentHandCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
  }));

  return { game, source, ownHandCards, opponentHandCards, waitingRoomCards };
}

function startOnEnter(game: GameState, sourceId: string): GameState {
  const enterStageEvent = createEnterStageEvent(
    sourceId,
    ZoneType.HAND,
    SlotPosition.CENTER,
    PLAYER1,
    PLAYER1
  );
  const withEvent = emitGameEvent(game, enterStageEvent);
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(withEvent, [TriggerCondition.ON_ENTER_STAGE], {
      enterStageEvents: [enterStageEvent],
    })
  ).gameState;
}

describe('PL!S-pb1-001 Chika on-enter recovery', () => {
  it('recovers one LIVE from waiting room when opponent has at least two more hand cards', () => {
    const { game, source, waitingRoomCards } = setupChika({
      sourceCardCode: 'PL!S-pb1-001-P＋',
      ownHandCount: 1,
      opponentHandCount: 3,
    });
    const liveId = waitingRoomCards[0]!.instanceId;
    const memberId = waitingRoomCards[1]!.instanceId;
    const started = startOnEnter(game, source.instanceId);

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID,
      selectableCardIds: [liveId],
      canSkipSelection: false,
    });
    expect(started.activeEffect?.selectableCardIds).not.toContain(memberId);

    const session = sessionWithState(started);
    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, liveId)
    );
    expect(result.success, result.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0]!.hand.cardIds).toContain(liveId);
    expect(session.state!.players[0]!.waitingRoom.cardIds).not.toContain(liveId);
    expect(session.state!.players[0]!.waitingRoom.cardIds).toContain(memberId);
  });

  it('consumes the pending ability without targets when opponent hand is not two cards ahead', () => {
    const waitingLive = instance(createLive('waiting-live'), 'waiting-live');
    const { game, source } = setupChika({
      ownHandCount: 2,
      opponentHandCount: 3,
      waitingRoomCards: [waitingLive],
    });
    const resolved = startOnEnter(game, source.instanceId);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0]!.waitingRoom.cardIds).toContain(waitingLive.instanceId);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID &&
          action.payload.step === 'SKIP_OPPONENT_HAND_NOT_TWO_MORE'
      )
    ).toBe(true);
  });

  it('consumes the pending ability safely when waiting room has no LIVE target', () => {
    const waitingMember = instance(createMember('waiting-member'), 'waiting-member');
    const { game, source } = setupChika({
      ownHandCount: 1,
      opponentHandCount: 3,
      waitingRoomCards: [waitingMember],
    });
    const resolved = startOnEnter(game, source.instanceId);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0]!.waitingRoom.cardIds).toContain(waitingMember.instanceId);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID &&
          action.payload.step === 'NO_WAITING_ROOM_LIVE_TARGET'
      )
    ).toBe(true);
  });

  it('rejects non-LIVE selections and does not move a LIVE that left waiting room', () => {
    const { game, source, waitingRoomCards } = setupChika({
      ownHandCount: 1,
      opponentHandCount: 3,
    });
    const liveId = waitingRoomCards[0]!.instanceId;
    const memberId = waitingRoomCards[1]!.instanceId;
    const started = startOnEnter(game, source.instanceId);

    const invalidSelectionSession = sessionWithState(started);
    const invalidSelection = invalidSelectionSession.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, memberId)
    );
    expect(invalidSelection.success).toBe(false);
    expect(invalidSelection.error).toBe('选择的卡牌不能用于当前效果');
    expect(invalidSelectionSession.state!.players[0]!.waitingRoom.cardIds).toContain(memberId);

    const movedLiveState = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== liveId),
      },
      hand: addCardToZone(player.hand, liveId),
    }));
    const movedLiveSession = sessionWithState(movedLiveState);
    const movedLiveSelection = movedLiveSession.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, movedLiveState.activeEffect!.id, liveId)
    );
    expect(movedLiveSelection.success).toBe(false);
    expect(movedLiveSession.state!.players[0]!.hand.cardIds).toContain(liveId);
    expect(movedLiveSession.state!.players[0]!.waitingRoom.cardIds).not.toContain(liveId);
    expect(movedLiveSession.state!.activeEffect).toMatchObject({
      abilityId: PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID,
      selectableCardIds: [liveId],
    });
  });
});
