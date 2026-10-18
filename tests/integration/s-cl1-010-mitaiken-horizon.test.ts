import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { S_CL1_010_LIVE_START_BOTTOM_GROUPED_AQOURS_LIVES_GAIN_CENTER_BLADE_ABILITY_ID as ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  getMemberEffectiveBladeCount,
  removeStageMemberBoundLiveModifiers,
} from '../../src/domain/rules/live-modifiers';
import { updatePlayer, type GameState } from '../../src/domain/entities/game';
import { BladeHeartEffect, HeartColor } from '../../src/shared/types/enums';
import {
  choose,
  expire,
  live,
  member,
  movementEvents,
  P1,
  P2,
  selectOnce,
  selectSession,
  setup,
} from '../helpers/s-cl1-ordered-live-return';

const TEXT =
  '【LIVE开始时】选择存在于自己休息室的至多１张持有[スコア]的『Aqours』的LIVE卡，和至多１张持有[ALLハート]的『Aqours』的LIVE卡，和至多１张持有[ダブル無色ブレード]的『Aqours』的LIVE卡，按任意顺序放置于卡组底。此后，LIVE结束时为止，每有１张因此放置于卡组底的卡片，存在于自己的中央区域的『Aqours』的成员，获得[ブレード]。';
const SCORE = { effect: BladeHeartEffect.SCORE };
const ALL = { effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW };
const GRAY = { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY };
const cards = () => [
  live('both', [SCORE, ALL]),
  live('score', [SCORE]),
  live('double', [GRAY, GRAY]),
];
const scenario = (waiting = cards(), options: Parameters<typeof setup>[3] = {}) =>
  setup('PL!S-cl1-010-CL', ABILITY_ID, waiting, options);

describe('PL!S-cl1-010 分数2「未体验地平线」', () => {
  it('registers the full exported paragraph as a queued LIVE-start ability for every rarity', () => {
    for (const rarity of ['CL', 'L', 'SEC', 'P+']) {
      expect(getCardAbilityDefinitionsForCardCode(`PL!S-cl1-010-${rarity}`)).toEqual([
        expect.objectContaining({
          abilityId: ABILITY_ID,
          category: 'LIVE_START',
          sourceZone: 'LIVE_CARD',
          queued: true,
          implemented: true,
          effectText: TEXT,
        }),
      ]);
    }
    expect(scenario().game.activeEffect?.effectText).toBe(TEXT);
  });

  it('selects printed SCORE/ALL/double-gray LIVE hearts, excluding numeric score and illegal owners/types', () => {
    const game = scenario([
      ...cards(),
      live('numeric-score'),
      live('single-gray', [GRAY]),
      live('other-group', [ALL], { groups: ['Liella!'] }),
      live('foreign', [SCORE], { owner: P2 }),
      member('member'),
    ]).game;
    expect(game.activeEffect?.selectableCardIds).toEqual(['both', 'score', 'double']);
    expect(game.activeEffect).toMatchObject({
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 3,
      canSkipSelection: true,
    });
    expect(selectOnce(game, ['numeric-score'])).toBe(game);
    expect(selectOnce(game, ['both', 'both'])).toBe(game);
    expect(selectOnce(game, ['both', 'score', 'double', 'foreign'])).toBe(game);
  });

  it('assigns overlapping cards once each, preserves bottom order, then grants only the center instance BLADE', () => {
    const game = choose(scenario().game, ['both', 'score', 'double']);
    expect(game.players[0].mainDeck.cardIds).toEqual(['deck', 'both', 'score', 'double']);
    expect(game.players[0].waitingRoom.cardIds).toEqual([]);
    expect(getMemberEffectiveBladeCount(game, P1, 'center')).toBe(4);
    expect(getMemberEffectiveBladeCount(game, P1, 'side')).toBe(1);
    expect(game.liveResolution.liveModifiers).toEqual([
      expect.objectContaining({
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        sourceCardId: 'source',
        targetMemberCardId: 'center',
        countDelta: 3,
      }),
    ]);
    expect(movementEvents(game)).toEqual([
      expect.objectContaining({
        movedCardIds: ['both', 'score', 'double'],
        destination: { kind: 'BOTTOM' },
      }),
    ]);
    expect(
      removeStageMemberBoundLiveModifiers(game, ['center']).liveResolution.liveModifiers
    ).toEqual([]);
  });

  it('allows missing groups and rejects several cards that can only fill one group', () => {
    const game = scenario([live('score-a', [SCORE]), live('score-b', [SCORE])]).game;
    expect(selectOnce(game, ['score-a', 'score-b'])).toBe(game);
    const moved = choose(game, ['score-b']);
    expect(moved.players[0].mainDeck.cardIds).toEqual(['deck', 'score-b']);
    expect(getMemberEffectiveBladeCount(moved, P1, 'center')).toBe(2);
    const otherCenter = choose(scenario(cards(), { centerGroups: ['Liella!'] }).game, ['double']);
    expect(otherCenter.players[0].mainDeck.cardIds).toEqual(['deck', 'double']);
    expect(otherCenter.liveResolution.liveModifiers).toEqual([]);
  });

  it('skips zero and no-target cases without a public window, event, or reward', () => {
    const empty = choose(scenario().game, []);
    expect(empty.activeEffect).toBeNull();
    expect(empty.pendingAbilities).toEqual([]);
    expect(movementEvents(empty)).toEqual([]);
    expect(empty.liveResolution.liveModifiers).toEqual([]);
    const noTarget = scenario([live('no-symbol')]).game;
    expect(noTarget.activeEffect).toMatchObject({
      stepId: 'CONFIRM_ONLY_EFFECT',
      effectText: `${TEXT}（当前自己休息室中符合这三类条件的『Aqours』LIVE卡为0张，不放置卡片且不增加[BLADE]。）`,
    });
    expect(choose(noTarget, []).activeEffect).toBeNull();
  });

  it('rejects unrelated or conflicting inputs before public display without consuming the selection', () => {
    const game = scenario().game;
    const id = game.activeEffect!.id;
    expect(
      confirmActiveEffectStep(game, P1, id, undefined, undefined, undefined, 'bad-option')
    ).toBe(game);
    expect(
      confirmActiveEffectStep(
        game,
        P1,
        id,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        0
      )
    ).toBe(game);
    expect(
      confirmActiveEffectStep(game, P1, id, 'both', undefined, undefined, undefined, ['score'])
    ).toBe(game);
    expect(
      confirmActiveEffectStep(game, P1, id, undefined, undefined, undefined, 'bad-option', ['both'])
    ).toBe(game);
  });

  it('confirms a manually chosen no-target pending but automatically consumes a no-target ordered batch', () => {
    const noTarget = scenario([live('no-symbol')]).game;
    const first = noTarget.pendingAbilities[0]!;
    const pool = resolvePendingCardEffects({
      ...noTarget,
      activeEffect: null,
      pendingAbilities: [first, { ...first, id: 'second' }],
    }).gameState;
    const manual = confirmActiveEffectStep(
      pool,
      P1,
      pool.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      first.id
    );
    expect(manual.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    const ordered = confirmActiveEffectStep(
      pool,
      P1,
      pool.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.pendingAbilities).toEqual([]);
    expect(ordered.activeEffect).toBeNull();
    expect(movementEvents(ordered)).toEqual([]);
  });

  it('reveals the ordered set to both players, keeps movement/reward pending until the deadline, and continues once', () => {
    const s = scenario(cards(), { laterPending: true });
    expect(selectSession(s, ['double', 'both', 'score']).success).toBe(true);
    const reveal = s.session.state!.activeEffect!;
    expect(reveal.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
    const advance = createAutoAdvancePublicCardSelectionCommand(
      P2,
      reveal.id,
      reveal.publicCardSelectionAutoAdvanceAt!
    );
    expect(s.session.executeCommand(advance).success).toBe(false);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(['both', 'score', 'double']);
    expect(s.session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(s.session.state!.pendingAbilities.map((ability) => ability.id)).toEqual([
      'later-pending',
    ]);
    for (const player of [P1, P2])
      expect(s.session.getPlayerViewState(player)?.activeEffect).toMatchObject({
        revealedObjectIds: ['obj_double', 'obj_both', 'obj_score'],
        publicCardSelectionAutoAdvanceAt: reveal.publicCardSelectionAutoAdvanceAt,
      });
    expect(expire(s).success).toBe(true);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual([
      'deck',
      'double',
      'both',
      'score',
    ]);
    expect(s.session.state!.activeEffect).toMatchObject({
      id: 'later-pending',
      stepId: 'CONFIRM_ONLY_EFFECT',
    });
    expect(
      s.session.executeCommand(createConfirmEffectStepCommand(P1, 'later-pending')).success
    ).toBe(true);
    expect(s.session.state!.pendingAbilities).toEqual([]);
    expect(movementEvents(s.session.state!)).toHaveLength(1);
    expect(s.session.executeCommand(advance).success).toBe(false);
    expect(movementEvents(s.session.state!)).toHaveLength(1);
    expect(getMemberEffectiveBladeCount(s.session.state!, P1, 'center')).toBe(4);
  });

  it('cancels the entire revealed selection when one card becomes stale, without partial movement or BLADE', () => {
    const s = scenario();
    selectSession(s, ['both', 'score', 'double']);
    (s.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      s.session.state!,
      P1,
      (p) => ({ ...p, waitingRoom: { ...p.waitingRoom, cardIds: ['both', 'double'] } })
    );
    expect(expire(s, P1).success).toBe(true);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(['both', 'double']);
    expect(s.session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(movementEvents(s.session.state!)).toEqual([]);
    expect(s.session.state!.activeEffect).toBeNull();
  });
});
