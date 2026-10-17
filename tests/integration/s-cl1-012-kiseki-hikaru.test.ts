import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_CL1_012_LIVE_START_STACK_SAME_NAME_SUCCESS_AQOURS_LIVES_ABILITY_ID as ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  choose,
  expire,
  live,
  member,
  movementEvents,
  P1,
  selectOnce,
  selectSession,
  setup,
} from '../helpers/s-cl1-ordered-live-return';

const TEXT =
  '【LIVE开始时】对于存在于自己的成功LIVE卡区的『Aqours』的每张LIVE卡，从自己的休息室，分别选择至多１张与该卡持有相同卡名的LIVE卡，将它们按任意顺序放置于自己的卡组顶。';
const same = (id: string, name = '歌A', groups = ['Aqours']) => live(id, [], { name, groups });
const scenario = (success = [same('success-a'), same('success-b')]) =>
  setup(
    'PL!S-cl1-012-CL',
    ABILITY_ID,
    [
      same('a1'),
      same('a2', '歌A', ['Liella!']),
      same('a3'),
      same('b', '歌B'),
      same('substring', '歌A remix'),
      member('member'),
    ],
    { success }
  );

describe('PL!S-cl1-012 分数5「奇迹闪耀」', () => {
  it('registers exact approved Chinese text and the base-card LIVE-start family', () => {
    for (const rarity of ['CL', 'L', 'SEC', 'P+'])
      expect(getCardAbilityDefinitionsForCardCode(`PL!S-cl1-012-${rarity}`)).toEqual([
        expect.objectContaining({
          abilityId: ABILITY_ID,
          category: 'LIVE_START',
          sourceZone: 'LIVE_CARD',
          queued: true,
          implemented: true,
          effectText: TEXT,
        }),
      ]);
    expect(scenario().game.activeEffect?.effectText).toBe(TEXT);
  });

  it('grants a separate quota for every successful LIVE instance, including the same name twice', () => {
    const opened = scenario().game;
    expect(opened.activeEffect?.selectableCardIds).toEqual(['a1', 'a2', 'a3']);
    expect(opened.activeEffect?.maxSelectableCards).toBe(2);
    const moved = choose(opened, ['a2', 'a1']);
    expect(moved.players[0].mainDeck.cardIds).toEqual(['a2', 'a1', 'deck']);
    expect(moved.players[0].waitingRoom.cardIds).toEqual(['a3', 'b', 'substring', 'member']);
    expect(movementEvents(moved)).toEqual([
      expect.objectContaining({ movedCardIds: ['a2', 'a1'], destination: { kind: 'TOP' } }),
    ]);
    expect(selectOnce(opened, ['a1', 'a2', 'a3'])).toBe(opened);
    expect(selectOnce(opened, ['a1', 'a1'])).toBe(opened);
    expect(selectOnce(opened, ['substring'])).toBe(opened);
  });

  it('requires exact names and each successful source to be Aqours, without requiring the returned card to be Aqours', () => {
    const opened = scenario([same('success-a'), same('success-b', '歌B', ['Liella!'])]).game;
    expect(opened.activeEffect?.selectableCardIds).toEqual(['a1', 'a2', 'a3']);
    expect(opened.activeEffect?.maxSelectableCards).toBe(1);
    expect(selectOnce(opened, ['b'])).toBe(opened);
    expect(choose(opened, ['a2']).players[0].mainDeck.cardIds).toEqual(['a2', 'deck']);
    const different = scenario([same('success-a'), same('success-b', '歌B')]).game;
    expect(selectOnce(different, ['a1', 'a2'])).toBe(different);
    expect(choose(different, ['b', 'a1']).players[0].mainDeck.cardIds).toEqual(['b', 'a1', 'deck']);
  });

  it('skips zero and empty success-zone cases without a public display or movement event', () => {
    const skipped = choose(scenario().game, []);
    expect(skipped.activeEffect).toBeNull();
    expect(movementEvents(skipped)).toEqual([]);
    const noTarget = scenario([]).game;
    expect(noTarget.activeEffect).toMatchObject({
      stepId: 'CONFIRM_ONLY_EFFECT',
      effectText: `${TEXT}（当前成功LIVE卡区有0张『Aqours』LIVE卡，自己休息室没有符合配额的同名LIVE卡，不放置卡片。）`,
    });
    expect(choose(noTarget, []).activeEffect).toBeNull();
  });

  it('rejects unrelated choices and conflicting card forms before creating a public display', () => {
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
      confirmActiveEffectStep(game, P1, id, 'a1', undefined, undefined, undefined, ['a2'])
    ).toBe(game);
    expect(
      confirmActiveEffectStep(game, P1, id, undefined, undefined, undefined, undefined, ['a1'], 0)
    ).toBe(game);
  });

  it('uses confirm-only for a manual no-target pending and skips confirmations in an ordered batch', () => {
    const noTarget = scenario([]).game;
    const first = noTarget.pendingAbilities[0]!;
    const pool = resolvePendingCardEffects({
      ...noTarget,
      activeEffect: null,
      pendingAbilities: [first, { ...first, id: 'second' }],
    }).gameState;
    expect(
      confirmActiveEffectStep(
        pool,
        P1,
        pool.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        first.id
      ).activeEffect?.stepId
    ).toBe('CONFIRM_ONLY_EFFECT');
    const ordered = confirmActiveEffectStep(
      pool,
      P1,
      pool.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(movementEvents(ordered)).toEqual([]);
  });

  it('shows the exact top order before moving once and preserves the deck behind it', () => {
    const s = scenario();
    expect(selectSession(s, ['a2', 'a1']).success).toBe(true);
    expect(s.session.state!.activeEffect).toMatchObject({
      stepId: 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION',
      revealedCardIds: ['a2', 'a1'],
      publicCardSelectionOrdered: true,
    });
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(movementEvents(s.session.state!)).toEqual([]);
    expect(expire(s).success).toBe(true);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(['a2', 'a1', 'deck']);
    expect(movementEvents(s.session.state!)).toHaveLength(1);
  });

  it('rechecks the entire selected set after public display, including current successful-card quotas', () => {
    for (const stalePart of ['target', 'success']) {
      const s = scenario();
      selectSession(s, ['a2', 'a1']);
      (s.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
        s.session.state!,
        P1,
        (p) =>
          stalePart === 'target'
            ? {
                ...p,
                waitingRoom: {
                  ...p.waitingRoom,
                  cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'a2'),
                },
              }
            : { ...p, successZone: { ...p.successZone, cardIds: ['success-a'] } }
      );
      expect(expire(s, P1).success).toBe(true);
      expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(['deck']);
      expect(s.session.state!.players[0].waitingRoom.cardIds).toContain('a1');
      expect(movementEvents(s.session.state!)).toEqual([]);
      expect(s.session.state!.activeEffect).toBeNull();
      expect(s.session.state!.pendingAbilities).toEqual([]);
    }
  });
});
