import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  createConfirmEffectStepCommand,
  createEndPhaseCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID as SUCCESS } from '../../src/application/card-effects/ability-ids';
import {
  registerCards,
  updatePlayer,
  emitGameEvent,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';
import { live, member } from '../helpers/card-effect-zone-fixture';
import { getBokuhikaPresentation } from '../../client/src/lib/bokuhikaPresentation';
import { BOKUHIKA_CAST } from '../../client/src/components/game/song-animation/bokuhikaCast';
import { ENTRANCE_WAIT_LIMIT_MS } from '../../src/shared/card-entrance';
import {
  serializeReplayPayload,
  rehydrateAuthorityGameState,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import type { DeckConfig } from '../../src/application/game-service';
import type { AnyCardData } from '../../src/domain/entities/card';
import { CardType } from '../../src/shared/types/enums';

function prepare(
  options: {
    mode?: 'LOCAL' | 'REMOTE' | 'OFF';
    print?: string;
    count?: number;
    multiple?: boolean;
  } = {},
  existing?: ReturnType<typeof createGameSession>
) {
  let now = 1000;
  const session =
    existing ??
    createGameSession({
      ...(options.mode === 'OFF' ? {} : { cardEntrance: options.mode ?? 'LOCAL' }),
      now: () => now,
    });
  const initial = session.state ?? session.createGame('bokuhika', 'p1', '先攻', 'p2', '后攻');
  const [p1, p2] = initial.players.map((p) => p.id);
  const names = BOKUHIKA_CAST.slice(0, options.count ?? 3).map((m) => m.name);
  const muse = { groupNames: ["μ's"] };
  const cards = [
    live('song', { ...muse, cardCode: options.print ?? 'PL!-pb2-039-L', score: 9 }, p1),
    live('song2', { ...muse, cardCode: 'PL!-pb2-039-L+', score: 9 }, p1),
    ...names.map((name, i) => member(`m${i}`, { ...muse, name }, p1)),
    member('secret', { ...muse, name: '矢澤にこ', cardCode: 'PRIVATE-HAND-CODE' }, p1),
    member('deck', { ...muse, name: '東條希', cardCode: 'PRIVATE-DECK-CODE' }, p1),
    member('opponent-deck', {}, p2),
  ];
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  let state = registerCards(initial, cards);
  state = updatePlayer(state, p1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['secret'] },
    mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
    memberSlots: names.length
      ? placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'm0', up)
      : p.memberSlots,
    liveZone: {
      ...p.liveZone,
      cardIds: options.multiple ? ['song', 'song2'] : ['song'],
      cardStates: new Map([
        ['song', up],
        ['song2', up],
      ]),
    },
    waitingRoom: { ...p.waitingRoom, cardIds: names.slice(1).map((_, i) => `m${i + 1}`) },
  }));
  state = updatePlayer(state, p2, (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: ['opponent-deck'] },
  }));
  const cheerIds = names.slice(1).map((_, i) => `m${i + 1}`);
  state = emitGameEvent(
    state,
    createCheerEvent(p1, cheerIds, cheerIds.length, { automated: true })
  );
  state = {
    ...state,
    isStarted: true,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    currentTurnType: TurnType.LIVE_PHASE,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
    activeEffect: null,
    pendingChoice: null,
    manualOperationMode: 'RULES',
    liveResolution: {
      ...state.liveResolution,
      firstPlayerCheerCardIds: cheerIds,
      playerScores: new Map([[p1, 9]]),
    },
    pendingAbilities: (options.multiple ? ['song', 'song2'] : ['song']).map((sourceCardId) => ({
      id: `pending:${sourceCardId}`,
      abilityId: SUCCESS,
      sourceCardId,
      controllerId: p1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      eventIds: [],
    })),
  };
  session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
  const commit = (game: GameState) =>
    (session as unknown as { setAuthorityState(g: GameState): void }).setAuthorityState(game);
  return {
    session,
    p1,
    p2,
    commit,
    start() {
      commit(resolvePendingCardEffects(session.state!).gameState);
    },
    confirm(cardId?: string) {
      return session.executeCommand(
        createConfirmEffectStepCommand(p1, session.state!.activeEffect!.id, cardId)
      );
    },
    ack(playerId = p1, entranceId = session.state!.entranceRuntime!.pending!.id) {
      return session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId,
        entranceId,
        timestamp: now,
      });
    },
    score: () => session.state!.liveResolution.playerScores.get(p1),
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('Bokuhika public LIVE-success barrier', () => {
  it.each(['PL!-pb2-039-L', 'PL!-pb2-039-L+', 'PL!-pb2-039'])(
    'precedes the existing confirmation and scores exactly once for %s',
    (print) => {
      const f = prepare({ print });
      f.start();
      const wait = f.session.state!.entranceRuntime!.pending!;
      const effect = f.session.state!.activeEffect!;
      expect(wait.deadlineAt).toBe(f.now() + ENTRANCE_WAIT_LIMIT_MS);
      expect(wait.bokuhikaSuccess).toEqual({
        sourceCardId: 'song',
        normalizedNames: ['高坂穂乃果', '絢瀬絵里', '南ことり'],
        scoreBonus: 3,
      });
      expect(effect.stepId).toBe('CONFIRM_ONLY_EFFECT');
      expect(f.score()).toBe(9);
      expect(f.confirm().success).toBe(false);
      expect(f.session.executeCommand(createEndPhaseCommand(f.p1)).success).toBe(false);
      expect(f.session.undoLastStep().success).toBe(false);
      expect(f.ack('outsider').success).toBe(false);
      expect(f.ack().success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      expect(f.session.state!.activeEffect!.id).toBe(effect.id);
      expect(f.score()).toBe(9);
      expect(f.confirm().success).toBe(true);
      expect(f.score()).toBe(12);
      expect(
        f.session.state!.liveResolution.liveModifiers.filter((m) => m.abilityId === SUCCESS)
      ).toHaveLength(1);
      expect(f.ack(f.p1, wait.id).success).toBe(false);
      expect(
        f.session.executeCommand(createConfirmEffectStepCommand(f.p1, effect.id)).success
      ).toBe(false);
      expect(f.score()).toBe(12);
    }
  );
  it.each([0, 3, 9])(
    'projects only public identities to both seats, including %i contributors',
    (count) => {
      const f = prepare({ mode: 'REMOTE', count });
      f.start();
      const self = f.session.getPlayerViewState(f.p1)!;
      const opponent = f.session.getPlayerViewState(f.p2)!;
      expect(self.match.entrance).toEqual(opponent.match.entrance);
      for (const view of [self, opponent]) {
        expect(getBokuhikaPresentation(view)).toEqual({
          members: BOKUHIKA_CAST.slice(0, count).map((m) => m.id),
          scoreBonus: count,
        });
      }
      expect(JSON.stringify(opponent)).not.toContain('PRIVATE-HAND-CODE');
      expect(JSON.stringify(opponent)).not.toContain('PRIVATE-DECK-CODE');
      expect(f.ack().success).toBe(true);
      expect(f.ack().success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual([f.p2]);
      expect(f.ack(f.p2).success).toBe(true);
      expect(f.score()).toBe(9);
      f.confirm();
      expect(f.score()).toBe(9 + count);
    }
  );
  it('waits for an order selection and gives each selected song its own cue', () => {
    const f = prepare({ multiple: true });
    f.start();
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(getBokuhikaPresentation(f.session.getPlayerViewState(f.p1)!)).toBeNull();
    expect(f.confirm('song2').success).toBe(true);
    const first = f.session.state!.entranceRuntime!.pending!;
    expect(first.bokuhikaSuccess!.sourceCardId).toBe('song2');
    f.ack();
    f.confirm();
    const second = f.session.state!.entranceRuntime!.pending!;
    expect(second.id).not.toBe(first.id);
    expect(second.bokuhikaSuccess!.sourceCardId).toBe('song');
    expect(f.score()).toBe(12);
    expect(f.ack(f.p1, first.id).success).toBe(false);
    f.ack();
    f.confirm();
    expect(f.score()).toBe(15);
  });
  it('presents each auto-ordered result without inserting a confirmation or resolving it twice', () => {
    const f = prepare({ multiple: true });
    f.start();
    expect(
      f.session.executeCommand(
        createConfirmEffectStepCommand(
          f.p1,
          f.session.state!.activeEffect!.id,
          undefined,
          undefined,
          true
        )
      ).success
    ).toBe(true);
    const first = f.session.state!.entranceRuntime!.pending!;
    expect(f.session.state!.activeEffect).toBeNull();
    expect(getBokuhikaPresentation(f.session.getPlayerViewState(f.p2)!)).toMatchObject({
      scoreBonus: 3,
    });
    expect(f.score()).toBe(12);
    f.ack();
    const second = f.session.state!.entranceRuntime!.pending!;
    expect(second.id).not.toBe(first.id);
    expect(second.bokuhikaSuccess!.sourceCardId).toBe('song2');
    expect(f.score()).toBe(15);
    expect(f.ack(f.p1, first.id).success).toBe(false);
    // A disconnected viewer must also resume the rest of the ordered batch only once.
    f.advance(ENTRANCE_WAIT_LIMIT_MS);
    expect(f.session.expireCardEntrance()).toBe(true);
    expect(f.session.expireCardEntrance()).toBe(false);
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.session.state!.entranceRuntime!.resumePendingEffects).toBeUndefined();
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.score()).toBe(15);
  });
  it('retains the pending cue through serialization and expires without confirming or replaying it', () => {
    const f = prepare();
    f.start();
    const restored = createGameSession({ cardEntrance: 'LOCAL', now: f.now });
    restored.restoreRuntimeState({
      authorityState: rehydrateAuthorityGameState(
        serializeReplayPayload(f.session.state!, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
      ),
      currentPublicSeq: 0,
    });
    expect(getBokuhikaPresentation(restored.getPlayerViewState(f.p1)!)).toMatchObject({
      scoreBonus: 3,
    });
    f.advance(ENTRANCE_WAIT_LIMIT_MS - 1);
    expect(restored.expireCardEntrance()).toBe(false);
    f.advance(1);
    expect(restored.expireCardEntrance()).toBe(true);
    expect(restored.expireCardEntrance()).toBe(false);
    expect(restored.state!.liveResolution.playerScores.get(f.p1)).toBe(9);
    expect(restored.state!.activeEffect!.stepId).toBe('CONFIRM_ONLY_EFFECT');
    restored.restoreRuntimeState({
      authorityState: restored.state!,
      currentPublicSeq: restored.getCurrentPublicEventSeq(),
    });
    expect(getBokuhikaPresentation(restored.getPlayerViewState(f.p1)!)).toBeNull();
    expect(
      restored.executeCommand(
        createConfirmEffectStepCommand(f.p1, restored.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(restored.state!.liveResolution.playerScores.get(f.p1)).toBe(12);
  });
  it('keeps the original confirmation and scoring when cinematics are not configured', () => {
    const f = prepare({ mode: 'OFF' });
    f.start();
    expect(f.session.state!.entranceRuntime).toBeUndefined();
    expect(getBokuhikaPresentation(f.session.getPlayerViewState(f.p1)!)).toBeNull();
    expect(f.confirm().success).toBe(true);
    expect(f.score()).toBe(12);
  });
  it('does not synthesize a cue when the source has left LIVE', () => {
    const f = prepare();
    f.commit(
      updatePlayer(f.session.state!, f.p1, (p) => ({
        ...p,
        liveZone: { ...p.liveZone, cardIds: [] },
        waitingRoom: { ...p.waitingRoom, cardIds: [...p.waitingRoom.cardIds, 'song'] },
      }))
    );
    f.start();
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.score()).toBe(9);
  });
  it('uses the server SOLITAIRE snapshot and authenticated ACK route with one viewer', async () => {
    const service = new OnlineMatchService({ recorder: null, now: () => 1000 });
    const deck: DeckConfig = {
      mainDeck: [
        ...Array.from({ length: 48 }, (_, i) => member(`deck-member-${i}`).data as AnyCardData),
        ...Array.from({ length: 12 }, (_, i) => live(`deck-live-${i}`).data as AnyCardData),
      ],
      energyDeck: Array.from({ length: 12 }, (_, i) => ({
        cardType: CardType.ENERGY,
        cardCode: `energy-${i}`,
        name: '能量',
      })),
    };
    const pointValidation = { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 };
    const match = await service.createMatch({
      roomCode: 'bokuhika-solitaire',
      matchMode: 'SOLITAIRE',
      automationGameMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
      first: { userId: 'first', displayName: '先攻', deck, pointValidation },
      second: { userId: 'second', displayName: '后攻', deck, pointValidation },
    });
    const f = prepare({}, match.session);
    f.start();
    const snapshot = await service.getMatchSnapshot(match.matchId, 'first');
    expect(snapshot).toHaveProperty('playerViewState');
    if (!snapshot || !('playerViewState' in snapshot)) throw new Error('No view');
    expect(getBokuhikaPresentation(snapshot.playerViewState)).toMatchObject({ scoreBonus: 3 });
    expect(match.session.state!.entranceRuntime!.singleViewer).toBe(true);
    const ack = await service.executeCommand(match.matchId, 'first', {
      type: GameCommandType.ACK_CARD_ENTRANCE,
      playerId: 'ignored',
      entranceId: snapshot.playerViewState.match.entrance!.id,
      timestamp: 1000,
    });
    expect(ack?.success).toBe(true);
    expect(match.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.score()).toBe(9);
    const result = await service.executeCommand(
      match.matchId,
      'first',
      createConfirmEffectStepCommand('ignored', match.session.state!.activeEffect!.id)
    );
    expect(result?.success).toBe(true);
    expect(f.score()).toBe(12);
  });
});
