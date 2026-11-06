import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  createConfirmEffectStepCommand,
  createEndPhaseCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { N_BP8_026_LIVE_START_CONVERT_TARGET_RED_BLUE_TO_PURPLE_SCORE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  addHeartLiveModifierForSourceMember,
  getLiveCardScoreModifier,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  GamePhase,
  HeartColor as H,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  CardType,
} from '../../src/shared/types/enums';
import { ENTRANCE_WAIT_LIMIT_MS } from '../../src/shared/card-entrance';
import { getSolitudeRain, solitudeRainPreloadUrls } from '../../client/src/lib/solitudeRain';
import { live, member, stage, liveZone, P1, P2 } from '../helpers/modifier-workflow-fixtures';
import {
  serializeReplayPayload,
  rehydrateAuthorityGameState,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import type { DeckConfig } from '../../src/application/game-service';
import type { AnyCardData } from '../../src/domain/entities/card';

function prepare(
  {
    count = 5,
    mode = 'LOCAL',
    multiple = false,
    print = 'SECL',
  }: {
    count?: number;
    mode?: 'LOCAL' | 'REMOTE' | 'OFF';
    multiple?: boolean;
    print?: string;
  } = {},
  existing?: ReturnType<typeof createGameSession>
) {
  let now = 1000;
  const session =
    existing ??
    createGameSession({ ...(mode === 'OFF' ? {} : { cardEntrance: mode }), now: () => now });
  const initial = session.state ?? session.createGame('solitude-test', P1, '先攻', P2, '后攻');
  const [p1, p2] = initial.players.map((p) => p.id);
  const song = { ...live(`PL!N-bp8-026${print ? `-${print}` : ''}`, 'song'), ownerId: p1 };
  const second = { ...song, instanceId: 'song2' };
  const hearts = [
    { color: H.RED, count: Math.ceil(count / 2) },
    { color: H.BLUE, count: Math.floor(count / 2) },
    { color: H.PURPLE, count: 7 },
  ].filter((h) => h.count > 0);
  const targets = [
    member('PL!N-sd1-003-SD', 'shizuku', p1, { hearts }),
    member('PL!N-sd1-006-SD', 'kanata', p1, { hearts }),
  ];
  let game = registerCards(initial, [
    song,
    second,
    ...targets,
    member('PRIVATE-HAND', 'secret', p1),
    member('PRIVATE-DECK', 'deck', p1),
  ]);
  game = stage(liveZone(game, song), targets, p1);
  if (multiple) game = liveZone(game, second);
  game = updatePlayer(game, p1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['secret'] },
    mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
  }));
  game = {
    ...game,
    isStarted: true,
    manualOperationMode: 'RULES',
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    currentTurnType: TurnType.LIVE_PHASE,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
    liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: p1 },
    pendingAbilities: (multiple ? ['song', 'song2'] : ['song']).map((id) => ({
      id: `pending:${id}`,
      sourceCardId: id,
      abilityId: ABILITY,
      controllerId: p1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
      eventIds: [],
    })),
  };
  session.restoreRuntimeState({
    authorityState: resolvePendingCardEffects(game).gameState,
    currentPublicSeq: 0,
  });
  return {
    session,
    p1,
    p2,
    confirm(id?: string, ordered?: boolean) {
      return session.executeCommand(
        createConfirmEffectStepCommand(p1, session.state!.activeEffect!.id, id, undefined, ordered)
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
    score: (id = 'song') => getLiveCardScoreModifier(session.state!.liveResolution, id),
    set(game: GameState) {
      session.restoreRuntimeState({
        authorityState: game,
        currentPublicSeq: session.getCurrentPublicEventSeq(),
      });
    },
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
  };
}
const heartCount = (state: GameState, p: string, id: string, color: H) =>
  getMemberEffectiveHeartIcons(state, p, id)
    .filter((h) => h.color === color)
    .reduce((n, h) => n + h.count, 0);

describe('Solitude Rain completed-conversion presentation', () => {
  it.each([0, 4, 5])(
    'presents authoritative conversion %i, excluding seven existing purple Hearts',
    (count) => {
      const f = prepare({ count });
      expect(getSolitudeRain(f.session.getPlayerViewState(f.p1)!)).toBeNull();
      expect(f.confirm('kanata').success).toBe(true);
      const wait = f.session.state!.entranceRuntime!.pending!;
      expect(wait.solitudeRain).toEqual({
        sourceCardId: 'song',
        targetCardId: 'kanata',
        convertedHeartCount: count,
        scoreBonus: Number(count >= 5),
      });
      expect(wait.deadlineAt).toBe(f.now() + ENTRANCE_WAIT_LIMIT_MS);
      expect(f.score()).toBe(Number(count >= 5));
      expect(heartCount(f.session.state!, f.p1, 'kanata', H.PURPLE)).toBe(7 + count);
      expect(heartCount(f.session.state!, f.p1, 'shizuku', H.RED)).toBe(Math.ceil(count / 2));
      expect(f.session.executeCommand(createEndPhaseCommand(f.p1)).success).toBe(false);
      expect(
        f.session.executeCommand(createConfirmEffectStepCommand(f.p1, 'pending:song', 'kanata'))
          .success
      ).toBe(false);
      expect(f.ack('outsider').success).toBe(false);
      expect(f.ack().success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      expect(f.ack(f.p1, wait.id).success).toBe(false);
      expect(f.score()).toBe(Number(count >= 5));
      expect(
        f.session.state!.actionHistory.filter(
          (a) =>
            a.type === 'RESOLVE_ABILITY' &&
            a.payload?.abilityId === ABILITY &&
            a.payload.step === 'SNAPSHOT_RED_BLUE_TO_PURPLE'
        )
      ).toHaveLength(1);
    }
  );
  it.each(['', 'L', 'L+', 'SECL'])('uses base-number coverage for %s', (print) => {
    const f = prepare({ print });
    f.confirm('shizuku');
    expect(getSolitudeRain(f.session.getPlayerViewState(f.p1)!)?.convertedHeartCount).toBe(5);
  });
  it('projects the same public target/results to both seats and waits for both remote ACKs', () => {
    const f = prepare({ mode: 'REMOTE' });
    f.confirm('kanata');
    const a = f.session.getPlayerViewState(f.p1)!,
      b = f.session.getPlayerViewState(f.p2)!;
    expect(a.match.entrance).toEqual(b.match.entrance);
    expect(getSolitudeRain(b)).toMatchObject({
      target: { objectId: 'obj_kanata', cardCode: 'PL!N-sd1-006-SD' },
      convertedHeartCount: 5,
      scoreBonus: 1,
    });
    expect(JSON.stringify(b)).not.toContain('PRIVATE-HAND');
    expect(JSON.stringify(b)).not.toContain('PRIVATE-DECK');
    expect(solitudeRainPreloadUrls(b).join(' ')).not.toContain('PRIVATE');
    const cue = f.session.state!.entranceRuntime!.pending!;
    f.ack();
    f.ack();
    expect(f.session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual([f.p2]);
    f.ack(f.p2);
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.ack(f.p1, cue.id).success).toBe(false);
  });
  it('does not start in the order queue; resumes ordered selections exactly once', () => {
    const f = prepare({ multiple: true });
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.confirm(undefined, true).success).toBe(true);
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    f.confirm('kanata');
    const first = f.session.state!.entranceRuntime!.pending!;
    expect(f.session.state!.activeEffect).toBeNull();
    f.ack();
    expect(f.session.state!.activeEffect!.sourceCardId).toBe('song2');
    f.confirm('kanata');
    expect(f.session.state!.entranceRuntime!.pending!.solitudeRain).toMatchObject({
      convertedHeartCount: 0,
      scoreBonus: 0,
    });
    expect(f.ack(f.p1, first.id).success).toBe(false);
    f.advance(ENTRANCE_WAIT_LIMIT_MS);
    expect(f.session.expireCardEntrance()).toBe(true);
    expect(f.session.expireCardEntrance()).toBe(false);
    expect(f.session.state!.entranceRuntime!.resumePendingEffects).toBeUndefined();
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.score()).toBe(1);
    expect(f.score('song2')).toBe(0);
  });
  it('does not convert later gains or re-award score, and loses expired contributions', () => {
    const f = prepare({ count: 3 });
    const gained = addHeartLiveModifierForSourceMember(f.session.state!, {
      playerId: f.p1,
      sourceCardId: 'kanata',
      abilityId: 'existing-gain',
      hearts: [{ color: H.BLUE, count: 2 }],
    })!.gameState;
    f.set(gained);
    f.confirm('kanata');
    f.ack();
    expect(f.score()).toBe(1);
    let after = addHeartLiveModifierForSourceMember(f.session.state!, {
      playerId: f.p1,
      sourceCardId: 'kanata',
      abilityId: 'later-gain',
      hearts: [
        { color: H.RED, count: 4 },
        { color: H.BLUE, count: 1 },
      ],
    })!.gameState;
    after = {
      ...after,
      liveResolution: {
        ...after.liveResolution,
        liveModifiers: after.liveResolution.liveModifiers.filter(
          (m) => m.abilityId !== 'existing-gain'
        ),
      },
    };
    expect(heartCount(after, f.p1, 'kanata', H.PURPLE)).toBe(10);
    expect(heartCount(after, f.p1, 'kanata', H.RED)).toBe(4);
    expect(heartCount(after, f.p1, 'kanata', H.BLUE)).toBe(1);
    f.set(after);
    expect(f.score()).toBe(1);
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
  });
  it('rejects invalid input and has no cinematic for a stale selection or source', () => {
    const f = prepare();
    expect(f.confirm('secret').success).toBe(false);
    f.set(
      updatePlayer(f.session.state!, f.p1, (p) => ({
        ...p,
        memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      }))
    );
    f.confirm('kanata');
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.score()).toBe(0);
    const g = prepare();
    g.set(
      updatePlayer(g.session.state!, g.p1, (p) => ({
        ...p,
        liveZone: { ...p.liveZone, cardIds: [] },
        waitingRoom: { ...p.waitingRoom, cardIds: ['song'] },
      }))
    );
    g.confirm('shizuku');
    expect(g.session.state!.entranceRuntime!.pending).toBeNull();
    expect(g.score()).toBe(0);
    expect(heartCount(g.session.state!, g.p1, 'shizuku', H.PURPLE)).toBe(12);
  });
  it('retains the original deadline on restore and never replays a finished cue', () => {
    const f = prepare();
    f.confirm('shizuku');
    const restored = createGameSession({ cardEntrance: 'LOCAL', now: f.now });
    restored.restoreRuntimeState({
      authorityState: rehydrateAuthorityGameState(
        serializeReplayPayload(f.session.state!, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
      ),
      currentPublicSeq: 0,
    });
    expect(restored.state!.entranceRuntime!.pending!.deadlineAt).toBe(
      1000 + ENTRANCE_WAIT_LIMIT_MS
    );
    f.advance(ENTRANCE_WAIT_LIMIT_MS);
    expect(restored.expireCardEntrance()).toBe(true);
    restored.restoreRuntimeState({
      authorityState: restored.state!,
      currentPublicSeq: restored.getCurrentPublicEventSeq(),
    });
    expect(getSolitudeRain(restored.getPlayerViewState(f.p1)!)).toBeNull();
    expect(getLiveCardScoreModifier(restored.state!.liveResolution, 'song')).toBe(1);
  });
  it('keeps immediate ordinary feedback when cinematics are off', () => {
    const f = prepare({ mode: 'OFF' });
    f.confirm('shizuku');
    expect(f.session.state!.entranceRuntime).toBeUndefined();
    expect(f.score()).toBe(1);
    const events = f.session.getPublicEventsSince(0).filter((e) => e.type === 'EffectFeedback');
    expect(events.flatMap((e) => e.targets.flatMap((t) => t.changes))).toEqual(
      expect.arrayContaining([
        { kind: 'HEART', color: H.PURPLE, delta: 5 },
        { kind: 'SCORE', delta: 1 },
      ])
    );
  });
  it.each(['SOLITAIRE', 'ONLINE'] as const)(
    'uses service commands and the existing %s wait policy',
    async (mode) => {
      const service = new OnlineMatchService({ recorder: null, now: () => 1000 });
      const deck: DeckConfig = {
        mainDeck: Array.from({ length: 60 }, () => member('TEST').data as AnyCardData),
        energyDeck: Array.from({ length: 12 }, () => ({
          cardType: CardType.ENERGY,
          cardCode: 'ENERGY',
          name: '能量',
        })),
      };
      const pointValidation = { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 };
      const match = await service.createMatch({
        roomCode: `solitude-${mode}`,
        ...(mode === 'SOLITAIRE'
          ? { matchMode: 'SOLITAIRE', automationGameMode: 'SOLITAIRE', originKind: 'SOLITAIRE' }
          : {}),
        first: { userId: 'first', displayName: '先攻', deck, pointValidation },
        second: { userId: 'second', displayName: '后攻', deck, pointValidation },
      });
      const f = prepare({}, match.session);
      const result = await service.executeCommand(
        match.matchId,
        'first',
        createConfirmEffectStepCommand('ignored', match.session.state!.activeEffect!.id, 'kanata')
      );
      expect(result?.success).toBe(true);
      const snapshot = await service.getMatchSnapshot(match.matchId, 'first');
      if (!snapshot || !('playerViewState' in snapshot)) throw new Error('No view');
      expect(getSolitudeRain(snapshot.playerViewState)?.scoreBonus).toBe(1);
      const id = snapshot.playerViewState.match.entrance!.id;
      const ack = await service.executeCommand(match.matchId, 'first', {
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId: 'ignored',
        entranceId: id,
        timestamp: 1000,
      });
      expect(ack?.success).toBe(true);
      expect(match.session.state!.entranceRuntime!.singleViewer).toBe(mode === 'SOLITAIRE');
      if (mode === 'ONLINE') {
        expect(match.session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual([f.p2]);
        await service.executeCommand(match.matchId, 'second', {
          type: GameCommandType.ACK_CARD_ENTRANCE,
          playerId: 'ignored',
          entranceId: id,
          timestamp: 1000,
        });
      }
      expect(match.session.state!.entranceRuntime!.pending).toBeNull();
      expect(f.score()).toBe(1);
    }
  );
});
