import { describe, expect, it } from 'vitest';
import {
  S_PB2_038_LIVE_SUCCESS_AQOURS_CHEER_DRAW_AND_SCORE_ABILITY_ID as HEROES,
  S_PB2_039_LIVE_SUCCESS_SAME_AQOURS_UNIT_DRAW_AND_RECOVER_ABILITY_ID as HOP,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
} from '../../src/application/game-commands';
import { createCardInstance, type CardInstance } from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createCheerEvent,
  createEnterLiveZoneEvent,
  createEnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  getLiveCardScoreModifier,
  getPlayerLiveScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import {
  FaceState,
  GamePhase,
  HeartColor,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  P1,
  P2,
  confirm,
  gameWith,
  live,
  liveZone,
  member,
  sessionFor,
  setState,
  stage,
} from '../helpers/modifier-workflow-fixtures';
import {
  getNovember27LiveData,
  getNovember27MemberData,
} from '../helpers/november-27-draft-effects';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

const HEROES_BASE = 'PL!S-pb2-038';
const HOP_BASE = 'PL!S-pb2-039';

function prepareLiveResult(
  base: string,
  others: readonly CardInstance[],
  onlyOneInDeck = false
): GameState {
  const source = createCardInstance(getNovember27LiveData(base), P1, 'source');
  const second = live('TEST-SECOND-SONG', 'second', { score: 2 });
  const opponent = createCardInstance(live('TEST-OPP-SONG', 'opponent').data, P2, 'opponent');
  const deck = [member('TEST-DRAW', 'draw'), member('TEST-DECK-END', 'deck-end')];
  let game = gameWith([source, second, opponent, ...deck, ...others]);
  for (const song of [source, second, opponent]) game = liveZone(game, song);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: onlyOneInDeck ? ['draw'] : ['draw', 'deck-end'] },
  }));
  game = emitGameEvent(
    game,
    createEnterLiveZoneEvent('source', ZoneType.HAND, P1, P1, FaceState.FACE_UP)
  );
  return {
    ...game,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    currentTurnType: TurnType.SECOND_PLAYER_TURN,
    activePlayerIndex: 1,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: P2,
      liveResults: new Map([
        ['source', true],
        ['second', true],
        ['opponent', false],
      ]),
      playerScores: new Map([
        [P1, getNovember27LiveData(base).score + 2],
        [P2, 0],
      ]),
    },
  };
}

function enterLiveResult(game: GameState) {
  const session = sessionFor(game);
  const result = session.executeCommand(
    createConfirmStepCommand(P2, SubPhase.PERFORMANCE_JUDGMENT)
  );
  expect(result.success, result.error).toBe(true);
  expect(session.state!.eventLog.map(({ event }) => event)).toContainEqual(
    expect.objectContaining({
      eventType: TriggerCondition.ON_LIVE_SUCCESS,
      playerId: P1,
      successfulLiveCardIds: ['source', 'second'],
    })
  );
  return session;
}

function choose(session: ReturnType<typeof sessionFor>, id: string | null) {
  return session.executeCommand(
    createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, id)
  );
}

function aqoursMember(id: string, name = id, unitName = 'Guilty Kiss') {
  return member(`TEST-${id}`, id, P1, { name, groupNames: ['Aqours'], unitName, bladeHearts: [] });
}

function setupHeroes(liveCondition: boolean, noBladeCount: number) {
  const aqoursLive = createCardInstance(getNovember27LiveData(HOP_BASE), P1, 'cheer-live');
  const unrelatedLive = live('TEST-NON-AQOURS-LIVE', 'other-live');
  const unrelated = member('TEST-NON-AQOURS-MEMBER', 'other-member');
  const ownCheer = [
    liveCondition ? aqoursLive : unrelatedLive,
    unrelated,
    ...Array.from({ length: noBladeCount }, (_, index) => aqoursMember(`plain-member-${index}`)),
    member('TEST-PRINTED-DRAW-MARKER', 'marked', P1, {
      groupNames: ['Aqours'],
      bladeHearts: getNovember27MemberData('PL!S-pb2-004').bladeHearts,
    }),
  ];
  const opponentCheer = createCardInstance(getNovember27LiveData(HOP_BASE), P2, 'opp-cheer');
  const priorCheer = aqoursMember('prior-cheer');
  let game = prepareLiveResult(HEROES_BASE, [...ownCheer, opponentCheer, priorCheer]);
  const ids = ownCheer.map(({ instanceId }) => instanceId);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom: { ...player.waitingRoom, cardIds: [...ids, 'prior-cheer'] },
  }));
  game = emitGameEvent(game, createCheerEvent(P1, ['prior-cheer'], 1));
  game = emitGameEvent(game, createCheerEvent(P1, ids.slice(0, 1), 1));
  game = emitGameEvent(
    game,
    createCheerEvent(P1, ids.slice(1), ids.length - 1, { additional: true })
  );
  game = emitGameEvent(game, createCheerEvent(P2, ['opp-cheer'], 1));
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: ids,
      secondPlayerCheerCardIds: ['opp-cheer'],
    },
  };
}

describe('PL!S-pb2-038 分数3「Aqours☆HEROES」', () => {
  it.each([
    [false, 1],
    [false, 2],
    [true, 1],
    [true, 2],
  ])('uses independent historical cheer conditions (%s / %i)', (liveCondition, plainCardCount) => {
    const session = enterLiveResult(setupHeroes(liveCondition, plainCardCount));
    const score = Number(plainCardCount >= 2);
    expect(getCardAbilityDefinitionsForCardCode(`${HEROES_BASE}-UNSEEN`)).toEqual([
      expect.objectContaining({
        abilityId: HEROES,
        baseCardCodes: [HEROES_BASE],
        sourceZone: 'LIVE_CARD',
        effectText: getNovember27LiveData(HEROES_BASE).cardTextCn,
      }),
    ]);
    expect(session.state!.resolutionZone.cardIds).toEqual([]);
    expect(session.state!.activeEffect?.abilityId).toBe(HEROES);
    expect(session.state!.activeEffect?.effectText).toContain(
      `实际抽${Number(liveCondition)}张，此卡分数＋${score}`
    );
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(confirm(session, P1).success).toBe(true);
    const after = session.state!.liveResolution;
    expect(session.state!.players[0].hand.cardIds).toEqual(liveCondition ? ['draw'] : []);
    expect(getLiveCardScoreModifier(after, 'source')).toBe(score);
    expect(getLiveCardScoreModifier(after, 'second')).toBe(0);
    expect(getPlayerLiveScoreModifier(after, P1)).toBe(0);
    expect(after.playerScores.get(P1)).toBe(5 + score);
    expect(session.state!.activeEffect).toBeNull();
  });

  it('rechecks effective Blade Heart grants during confirmation', () => {
    const session = enterLiveResult(setupHeroes(true, 2));
    setState(
      session,
      addLiveModifier(session.state!, {
        kind: 'CHEER_CARD_BLADE_HEART_GRANT',
        playerId: P1,
        maxMemberCost: 9,
        heartColor: HeartColor.ORANGE,
      })
    );
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['draw']);
    expect(getLiveCardScoreModifier(session.state!.liveResolution, 'source')).toBe(0);
  });

  it('keeps the independent draw but does not give a reentered source the old score', () => {
    const session = enterLiveResult(setupHeroes(true, 2));
    setState(
      session,
      emitGameEvent(
        session.state!,
        createEnterLiveZoneEvent('source', ZoneType.WAITING_ROOM, P1, P1, FaceState.FACE_UP)
      )
    );
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['draw']);
    expect(getLiveCardScoreModifier(session.state!.liveResolution, 'source')).toBe(0);
  });
});

function setupHop(names: 'different' | 'repeat' | 'multi' | 'different-units', shortDeck = false) {
  const riko = createCardInstance(getNovember27MemberData('PL!S-pb2-002'), P1, 'riko');
  const mari = createCardInstance(getNovember27MemberData('PL!S-pb2-026'), P1, 'mari');
  const third =
    names === 'repeat'
      ? createCardInstance(getNovember27MemberData('PL!S-pb2-002'), P1, 'repeat')
      : names === 'multi'
        ? member('TEST-DUO', 'duo', P1, {
            name: '桜内梨子&鬼塚夏美',
            groupNames: ['Aqours', 'Liella!'],
            unitName: 'Guilty Kiss',
          })
        : names === 'different-units'
          ? aqoursMember('different-unit', '渡辺曜', 'CYaRon！')
          : createCardInstance(getNovember27MemberData('PL!S-pb2-015'), P1, 'yoshiko');
  const recoverLive = createCardInstance(getNovember27LiveData(HEROES_BASE), P1, 'recover-live');
  const recoverMember = aqoursMember('recover-member');
  const other = member('TEST-NON-AQOURS-RECOVERY', 'not-aqours');
  let game = prepareLiveResult(
    HOP_BASE,
    [riko, mari, third, recoverLive, recoverMember, other],
    shortDeck
  );
  game = stage(game, [riko, mari, third]);
  return updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: ['recover-live', 'recover-member', 'not-aqours'],
    },
  }));
}

describe('PL!S-pb2-039 分数4「跳·跃·欢呼！」', () => {
  it.each(['different', 'multi'] as const)(
    'draws and forces one public recovery with distinct names (%s)',
    (names) => {
      const session = enterLiveResult(setupHop(names));
      expect(getCardAbilityDefinitionsForCardCode(`${HOP_BASE}-UNSEEN`)).toEqual([
        expect.objectContaining({
          abilityId: HOP,
          baseCardCodes: [HOP_BASE],
          sourceZone: 'LIVE_CARD',
          effectText: getNovember27LiveData(HOP_BASE).cardTextCn,
        }),
      ]);
      expect(session.state!.players[0].hand.cardIds).toEqual(['draw']);
      expect(session.state!.activeEffect).toMatchObject({
        abilityId: HOP,
        selectableCardIds: ['recover-live', 'recover-member'],
        canSkipSelection: false,
      });
      expect(choose(session, null).success).toBe(false);
      expect(choose(session, 'not-aqours').success).toBe(false);
      expect(choose(session, 'recover-live').success).toBe(true);
      expect(session.state!.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
      expect(session.state!.players[0].hand.cardIds).toEqual(['draw']);
      confirmPublicSelectionIfNeeded(session);
      expect(session.state!.players[0].hand.cardIds).toEqual(['draw', 'recover-live']);
      expect(session.state!.activeEffect).toBeNull();
    }
  );

  it.each(['repeat', 'different-units'] as const)(
    'handles draw without recovery for duplicate names and no draw for mixed units (%s)',
    (names) => {
      const session = enterLiveResult(setupHop(names));
      expect(session.state!.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
      expect(confirm(session, P1).success).toBe(true);
      expect(session.state!.players[0].hand.cardIds).toEqual(names === 'repeat' ? ['draw'] : []);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual([
        'recover-live',
        'recover-member',
        'not-aqours',
      ]);
      expect(session.state!.activeEffect).toBeNull();
    }
  );

  it('does not offer a recovery target removed by the draw refresh', () => {
    const session = enterLiveResult(setupHop('different', true));
    expect(session.state!.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['draw']);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
  });

  it('retains the draw after a publicly selected recovery card leaves and reenters', () => {
    const session = enterLiveResult(setupHop('different'));
    expect(choose(session, 'recover-live').success).toBe(true);
    setState(
      session,
      emitGameEvent(
        session.state!,
        createEnterWaitingRoomEvent(['recover-live'], ZoneType.HAND, P1, P1)
      )
    );
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toEqual(['draw']);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('recover-live');
    expect(session.state!.activeEffect).toBeNull();
  });
});
