import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PL_N_BP3_011_ON_ENTER_COMPARE_OPPONENT_MEMBER_GAIN_BLADE_ABILITY_ID as ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { addLiveModifier, collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1', P2 = 'p2';
const member = (code: string, name: string, ownerId: string, id: string, cost: number, blade: number, color: HeartColor) =>
  createCardInstance<MemberCardData>({ cardCode: code, name, groupNames: ['虹ヶ咲'], cardType: CardType.MEMBER, cost, blade, hearts: [createHeartIcon(color, 1)] }, ownerId, id);

function setup(
  rarity: 'R' | 'P' = 'R',
  config: { sourceColor?: HeartColor; targetColor?: HeartColor; sourceBlade?: number; targetBlade?: number } = {}
) {
  const source = member(`PL!N-bp3-011-${rarity}`, 'ミア・テイラー', P1, 'source', 7, config.sourceBlade ?? 1, config.sourceColor ?? HeartColor.YELLOW);
  const target = member('OPP-TARGET', '上原歩夢', P2, 'target', 7, config.targetBlade ?? 1, config.targetColor ?? HeartColor.YELLOW);
  const opponentMia = member('OPP-MIA', '米娅·泰勒', P2, 'opponent-mia', 7, 1, HeartColor.YELLOW);
  const below = member('OPP-BELOW', '鐘嵐珠', P2, 'below', 7, 1, HeartColor.YELLOW);
  let game = registerCards(createGameState('n-bp3-011', P1, 'P1', P2, 'P2'), [source, target, opponentMia, below]);
  game = updatePlayer(game, P1, (p) => ({ ...p, memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId) }));
  game = updatePlayer(game, P2, (p) => ({ ...p, memberSlots: { ...placeCardInSlot(placeCardInSlot(p.memberSlots, SlotPosition.LEFT, target.instanceId), SlotPosition.CENTER, opponentMia.instanceId), memberBelow: new Map([[target.instanceId, [below.instanceId]]]) } }));
  game = { ...game, pendingAbilities: [{ id: 'pending', abilityId: ABILITY_ID, sourceCardId: source.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['enter'], sourceSlot: SlotPosition.CENTER }] };
  return { game, source, target, opponentMia, below };
}
const start = (game: GameState) => resolvePendingCardEffects(game).gameState;
const choose = (game: GameState, id: string) => confirmActiveEffectStep(game, P1, game.activeEffect!.id, id);
const bonus = (game: GameState) => collectLiveModifiers(game).filter((m) => m.kind === 'BLADE' && m.abilityId === ABILITY_ID);

describe('PL!N-bp3-011 ミア・テイラー', () => {
  it.each(['R', 'P'] as const)('R/P 共用 definition 并排除对方米娅与 memberBelow：%s', (rarity) => {
    const { game, target } = setup(rarity);
    const window = start(game);
    expect(window.activeEffect).toMatchObject({ selectableCardIds: [target.instanceId], canSkipSelection: false, confirmSelectionLabel: '进行比较' });
  });

  it('三项全部满足时来源获得 BLADE +3', () => {
    const { game, target, source } = setup();
    const done = choose(start(game), target.instanceId);
    expect(bonus(done)).toContainEqual({ kind: 'BLADE', playerId: P1, countDelta: 3, sourceCardId: source.instanceId, abilityId: ABILITY_ID });
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({ targetMemberCardId: target.instanceId, heartMatches: true, costMatches: true, originalBladeMatches: true, bladeBonus: 3 });
  });

  it.each([
    { label: '仅 Heart 同色', heart: true, cost: false, blade: false, expected: 1 },
    { label: '仅有效费用相同', heart: false, cost: true, blade: false, expected: 1 },
    { label: '仅原本 BLADE 相同', heart: false, cost: false, blade: true, expected: 1 },
    { label: '三项均不满足', heart: false, cost: false, blade: false, expected: 0 },
  ])('$label 时获得 BLADE +$expected', ({ heart, cost, blade, expected }) => {
    const { game: base, target } = setup();
    let game = base;
    if (!heart) game = addLiveModifier(game, { kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT', playerId: P2, memberCardId: target.instanceId, color: HeartColor.RED, sourceCardId: target.instanceId, abilityId: 'heart-mismatch' });
    if (!cost) game = addLiveModifier(game, { kind: 'MEMBER_COST', playerId: P2, memberCardId: target.instanceId, countDelta: -1, sourceCardId: target.instanceId, abilityId: 'cost-mismatch' });
    if (!blade) game = addLiveModifier(game, { kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT', playerId: P2, memberCardId: target.instanceId, count: 2, sourceCardId: target.instanceId, abilityId: 'blade-mismatch' });
    const done = choose(start(game), target.instanceId);
    expect(done.actionHistory.at(-1)?.payload.bladeBonus).toBe(expected);
    expect(bonus(done)).toHaveLength(expected > 0 ? 1 : 0);
  });

  it('Heart modifier 独立使原本不同色的双方变为同色', () => {
    const baselineScenario = setup('R', { sourceColor: HeartColor.YELLOW, targetColor: HeartColor.RED });
    const baseline = choose(start(baselineScenario.game), baselineScenario.target.instanceId);
    expect(baseline.actionHistory.at(-1)?.payload.heartMatches).toBe(false);

    const scenario = setup('R', { sourceColor: HeartColor.YELLOW, targetColor: HeartColor.RED });
    const window = start(scenario.game);
    const withHeartModifier = addLiveModifier(window, { kind: 'HEART', target: 'SOURCE_MEMBER', playerId: P2, hearts: [createHeartIcon(HeartColor.YELLOW, 1)], sourceCardId: scenario.target.instanceId, abilityId: 'target-yellow-heart' });
    const done = choose(withHeartModifier, scenario.target.instanceId);
    expect(done.actionHistory.at(-1)?.payload.heartMatches).toBe(true);
  });

  it('普通 BLADE modifier 不参与 original Blade 比较', () => {
    const scenario = setup('R', { sourceBlade: 1, targetBlade: 1 });
    const window = start(scenario.game);
    const withOrdinaryBlade = addLiveModifier(window, { kind: 'BLADE', playerId: P2, countDelta: 9, sourceCardId: scenario.target.instanceId, abilityId: 'ordinary-blade' });
    const done = choose(withOrdinaryBlade, scenario.target.instanceId);
    expect(done.actionHistory.at(-1)?.payload.originalBladeMatches).toBe(true);
  });

  it('original Blade replacement 独立参与比较', () => {
    const scenario = setup('R', { sourceBlade: 1, targetBlade: 2 });
    const baseline = choose(start(scenario.game), scenario.target.instanceId);
    expect(baseline.actionHistory.at(-1)?.payload.originalBladeMatches).toBe(false);

    const replacementScenario = setup('R', { sourceBlade: 1, targetBlade: 2 });
    const window = start(replacementScenario.game);
    const replaced = addLiveModifier(window, { kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT', playerId: P2, memberCardId: replacementScenario.target.instanceId, count: 1, sourceCardId: replacementScenario.target.instanceId, abilityId: 'replace-target-original-blade' });
    const done = choose(replaced, replacementScenario.target.instanceId);
    expect(done.actionHistory.at(-1)?.payload.originalBladeMatches).toBe(true);
  });

  it('确认时按实时状态重算 effective cost', () => {
    const scenario = setup();
    const window = start(scenario.game);
    const costChangedAfterWindowOpened = addLiveModifier(window, { kind: 'MEMBER_COST', playerId: P2, memberCardId: scenario.target.instanceId, countDelta: -1, sourceCardId: scenario.target.instanceId, abilityId: 'late-cost-change' });
    const done = choose(costChangedAfterWindowOpened, scenario.target.instanceId);
    expect(done.actionHistory.at(-1)?.payload.costMatches).toBe(false);
  });

  it('RAINBOW 不匹配普通颜色，但匹配 RAINBOW', () => {
    const ordinary = setup('R', { sourceColor: HeartColor.RAINBOW, targetColor: HeartColor.RED });
    expect(choose(start(ordinary.game), ordinary.target.instanceId).actionHistory.at(-1)?.payload.heartMatches).toBe(false);
    const rainbow = setup('R', { sourceColor: HeartColor.RAINBOW, targetColor: HeartColor.RAINBOW });
    expect(choose(start(rainbow.game), rainbow.target.instanceId).actionHistory.at(-1)?.payload.heartMatches).toBe(true);
  });

  it('非法目标保持窗口；来源或目标失效时最终状态安全消费且无加成', () => {
    const targetScenario = setup();
    const targetWindow = start(targetScenario.game);
    expect(choose(targetWindow, 'opponent-mia')).toBe(targetWindow);
    const targetGoneInput = updatePlayer(targetWindow, P2, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT) }));
    const targetGoneResult = choose(targetGoneInput, targetScenario.target.instanceId);
    expect(targetGoneResult.activeEffect).toBeNull();
    expect(targetGoneResult.pendingAbilities).toEqual([]);
    expect(bonus(targetGoneResult)).toEqual([]);

    const sourceScenario = setup();
    const sourceWindow = start(sourceScenario.game);
    const sourceGoneInput = updatePlayer(sourceWindow, P1, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER) }));
    const sourceGoneResult = choose(sourceGoneInput, sourceScenario.target.instanceId);
    expect(sourceGoneResult.activeEffect).toBeNull();
    expect(sourceGoneResult.pendingAbilities).toEqual([]);
    expect(bonus(sourceGoneResult)).toEqual([]);
  });

  it('无合法目标时消费 pending；重复确认不重复累计', () => {
    const { game, target } = setup();
    const noTarget = updatePlayer(game, P2, (p) => ({ ...p, memberSlots: removeCardFromSlot(removeCardFromSlot(p.memberSlots, SlotPosition.LEFT), SlotPosition.CENTER) }));
    const skipped = start(noTarget);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.pendingAbilities).toEqual([]);
    const window = start(game);
    const done = choose(window, target.instanceId);
    expect(confirmActiveEffectStep(done, P1, window.activeEffect!.id, target.instanceId)).toBe(done);
    expect(bonus(done)).toHaveLength(1);
  });
});
