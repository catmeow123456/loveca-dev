import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  createConfirmEffectStepCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  BladeHeartEffect,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import { live, member } from './card-effect-zone-fixture';

export function prepareHonokaMemory(
  options: {
    print?: string;
    mode?: 'LOCAL' | 'REMOTE' | 'OFF';
    score?: boolean;
    heart?: boolean;
    draw?: boolean;
    emptyWaiting?: boolean;
    foreignSuccess?: boolean;
    secondHonoka?: boolean;
  } = {}
) {
  let now = 1000;
  const session = createGameSession({
    ...(options.mode === 'OFF' ? {} : { cardEntrance: options.mode ?? 'REMOTE' }),
    now: () => now,
  });
  const initial = session.createGame('honoka-memory', 'p1', '穗乃果', 'p2', '对手');
  const muse = { groupNames: ["μ's"] };
  const honoka = {
    ...muse,
    cardCode: options.print ?? 'PL!-pb2-001-R',
    name: '高坂穗乃果',
    cost: 22,
  };
  const cards = [
    member('honoka', honoka),
    member('honoka-2', honoka),
    // Synthetic public success face combines icons to avoid the three-success win condition.
    live('memory', {
      ...muse,
      ...(options.foreignSuccess ? { groupNames: ['Aqours'] } : {}),
      bladeHearts: [
        ...(options.score !== false ? [{ effect: BladeHeartEffect.SCORE }] : []),
        ...(options.heart !== false
          ? [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }]
          : []),
        ...(options.draw ? [{ effect: BladeHeartEffect.DRAW }] : []),
      ],
    }),
    member('recovery-member', { ...muse, name: '南琴梨' }),
    live('recovery-live', { ...muse, name: '回忆歌曲' }),
    live('live'),
    member('secret', { cardCode: 'PRIVATE-HAND-CODE' }),
    ...Array.from({ length: 10 }, (_, i) => member(`deck-${i}`)),
    member('opponent', {}, 'p2'),
    member('opponent-deck', {}, 'p2'),
  ];
  let state = registerCards(initial, cards);
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    memberSlots: options.secondHonoka
      ? placeCardInSlot(
          placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'honoka', up),
          SlotPosition.LEFT,
          'honoka-2',
          up
        )
      : placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'honoka', up),
    hand: { ...p.hand, cardIds: ['secret'] },
    mainDeck: { ...p.mainDeck, cardIds: Array.from({ length: 10 }, (_, i) => `deck-${i}`) },
    successZone: { ...p.successZone, cardIds: ['memory'], cardStates: new Map([['memory', up]]) },
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: options.emptyWaiting ? [] : ['recovery-member', 'recovery-live'],
    },
    liveZone: {
      ...p.liveZone,
      cardIds: ['live'],
      cardStates: new Map([['live', { ...up, face: FaceState.FACE_DOWN }]]),
    },
  }));
  state = updatePlayer(state, 'p2', (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: ['opponent-deck'] },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'opponent', up),
  }));
  state = {
    ...state,
    isStarted: true,
    currentPhase: GamePhase.LIVE_SET_PHASE,
    currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
    currentTurnType: TurnType.LIVE_PHASE,
    activePlayerIndex: 0,
    firstPlayerIndex: 0,
    liveSetCompletedPlayers: ['p1', 'p2'],
    waitingForInput: false,
    waitingPlayerId: null,
    manualOperationMode: 'RULES',
  };
  session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
  const commit = (game: GameState) =>
    (session as unknown as { setAuthorityState(game: GameState): void }).setAuthorityState(game);
  const confirm = (cardId?: string) =>
    session.executeCommand(
      createConfirmEffectStepCommand('p1', session.state!.activeEffect!.id, cardId)
    );
  return {
    session,
    confirm,
    commit,
    start() {
      const result = new GameService().advancePhase(session.state!);
      if (!result.success) throw new Error(result.error);
      commit(result.gameState);
      if (session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility) confirm();
    },
    ack(playerId = 'p1', entranceId = session.state!.entranceRuntime!.pending!.id) {
      return session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId,
        entranceId,
        timestamp: now,
      });
    },
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
  };
}
