import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot, removeCardFromStatefulZone } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { SP_PB1_023_LIVE_START_CATCHU_ACTIVATE_ENERGY_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function source(id: string, cardCode = 'PL!SP-pb1-023-L') {
  return createCardInstance({
    cardCode,
    name: 'ディストーション',
    groupNames: ['Liella!'],
    unitName: 'CatChu!',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  }, P1, id);
}

function member(id: string, name: string, unitName = 'CatChu!', ownerId = P1) {
  return createCardInstance({
    cardCode: `MEMBER-${id}`,
    name,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  }, ownerId, id);
}

function pending(cardId: string, id: string): PendingAbilityState {
  return {
    id,
    abilityId: SP_PB1_023_LIVE_START_CATCHU_ACTIVATE_ENERGY_SCORE_ABILITY_ID,
    sourceCardId: cardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
  };
}

function setup(options: {
  waitingCount: number;
  memberNames?: readonly string[];
  memberUnits?: readonly string[];
  sourceCount?: number;
  markedIndex?: number;
}) {
  const sources = Array.from({ length: options.sourceCount ?? 1 }, (_, index) =>
    source(`source-${index}`, index === 0 ? 'PL!SP-pb1-023-L' : 'PL!SP-pb1-023-SRL')
  );
  const members = (options.memberNames ?? ['澁谷かのん', '嵐千砂都']).map((name, index) =>
    member(`member-${index}`, name, options.memberUnits?.[index] ?? 'CatChu!')
  );
  const energies = Array.from({ length: options.waitingCount }, (_, index) =>
    createCardInstance({ cardCode: `ENERGY-${index}`, name: `Energy ${index}`, cardType: CardType.ENERGY }, P1, `energy-${index}`)
  );
  let game = registerCards(createGameState('sp-pb1-023', P1, 'P1', P2, 'P2'), [
    ...sources,
    ...members,
    ...energies,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: sources.reduce((zone, card) => addCardToStatefulZone(zone, card.instanceId), player.liveZone),
    energyZone: energies.reduce((zone, card) => addCardToStatefulZone(zone, card.instanceId, {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    }), player.energyZone),
    memberSlots: members.reduce((slots, card, index) => placeCardInSlot(
      slots,
      [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
      card.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ), player.memberSlots),
  }));
  game = {
    ...game,
    pendingAbilities: sources.map((card, index) => pending(card.instanceId, `pending-${index}`)),
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: P1,
      playerScores: new Map([[P1, 3]]),
    },
    energyActivePhaseSkips: options.markedIndex === undefined ? game.energyActivePhaseSkips : [{
      playerId: P1,
      energyCardId: energies[options.markedIndex]!.instanceId,
      sourceCardId: 'marker',
      abilityId: 'marker',
    }],
  };
  return { game, sources, members, energies };
}

function command(game: GameState, cardIds?: readonly string[], inOrder?: boolean) {
  const session = createGameSession();
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const result = session.executeCommand(createConfirmEffectStepCommand(
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    inOrder,
    undefined,
    cardIds
  ));
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function tryCommand(game: GameState, cardIds: readonly string[]) {
  const session = createGameSession();
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session.executeCommand(createConfirmEffectStepCommand(
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    cardIds
  ));
}

function startAndConfirm(game: GameState) {
  const preview = resolvePendingCardEffects(game).gameState;
  expect(preview.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return { preview, resolved: command(preview) };
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === SP_PB1_023_LIVE_START_CATCHU_ACTIVATE_ENERGY_SCORE_ABILITY_ID
  );
}

describe('PL!SP-pb1-023 Distortion', () => {
  it('confirms first, activates all waiting energy up to six, then gives the source LIVE SCORE +1', () => {
    const scenario = setup({ waitingCount: 4 });
    const { preview, resolved } = startAndConfirm(scenario.game);
    expect(preview.activeEffect?.effectText).toContain('当前不同名『CatChu!』成员2名');
    expect(preview.activeEffect?.effectText).toContain('本次将活跃4张');
    expect(preview.activeEffect?.effectText).toContain('实际[スコア]+1');
    expect(preview.activeEffect?.effectText).not.toMatch(/source|pending|stale|eventId/);
    expect(scenario.energies.every((card) => preview.players[0].energyZone.cardStates.get(card.instanceId)?.orientation === OrientationState.WAITING)).toBe(true);
    expect(scenario.energies.every((card) => resolved.players[0].energyZone.cardStates.get(card.instanceId)?.orientation === OrientationState.ACTIVE)).toBe(true);
    expect(scoreModifiers(resolved)).toContainEqual(expect.objectContaining({
      playerId: P1,
      liveCardId: scenario.sources[0]!.instanceId,
      sourceCardId: scenario.sources[0]!.instanceId,
      countDelta: 1,
    }));
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(4);
  });

  it('does not activate or score with one CatChu! name while waiting energy remains', () => {
    const scenario = setup({ waitingCount: 2, memberNames: ['澁谷かのん', '澁谷かのん'] });
    const { resolved } = startAndConfirm(scenario.game);
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(3);
    expect(resolved.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(OrientationState.WAITING);
  });

  it('implements Q97 and the explicit empty-energy rule: no CatChu! condition is needed when WAITING count is zero', () => {
    for (const memberNames of [['澁谷かのん'], []] as const) {
      const scenario = setup({ waitingCount: 0, memberNames });
      const { resolved } = startAndConfirm(scenario.game);
      expect(scoreModifiers(resolved)).toHaveLength(1);
      expect(resolved.liveResolution.playerScores.get(P1)).toBe(4);
    }
  });

  it('implements Q103: two abilities over seven WAITING energy add only one total SCORE', () => {
    const scenario = setup({ waitingCount: 7, sourceCount: 2 });
    let game = resolvePendingCardEffects(scenario.game).gameState;
    expect(game.activeEffect?.canResolveInOrder).toBe(true);
    game = command(game, undefined, true);
    expect(game.pendingAbilities).toEqual([]);
    expect(game.activeEffect).toBeNull();
    expect(scoreModifiers(game)).toHaveLength(1);
    expect(game.liveResolution.playerScores.get(P1)).toBe(4);
  });

  it('implements Q96: a resolved SCORE modifier remains after energy becomes WAITING again', () => {
    const scenario = setup({ waitingCount: 1 });
    const { resolved } = startAndConfirm(scenario.game);
    const changed = updatePlayer(resolved, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(player.energyZone.cardStates).set('energy-0', {
          ...player.energyZone.cardStates.get('energy-0')!,
          orientation: OrientationState.WAITING,
        }),
      },
    }));
    expect(scoreModifiers(changed)).toHaveLength(1);
    expect(changed.liveResolution.playerScores.get(P1)).toBe(4);
  });

  it('opens exact-six common energy selection for marked excess candidates and does not repeat confirm-only', () => {
    const scenario = setup({ waitingCount: 7, markedIndex: 6 });
    let game = command(resolvePendingCardEffects(scenario.game).gameState);
    expect(game.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      minSelectableCards: 6,
      maxSelectableCards: 6,
      confirmSelectionLabel: '变为活跃',
    });
    const duplicate = Array(6).fill(scenario.energies[0]!.instanceId);
    expect(tryCommand(game, duplicate).success).toBe(false);
    expect(tryCommand(game, [...scenario.energies.slice(0, 5).map((card) => card.instanceId), 'illegal']).success).toBe(false);
    const staleId = scenario.energies[0]!.instanceId;
    const stale = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: removeCardFromStatefulZone(player.energyZone, staleId),
    }));
    const staleResult = tryCommand(stale, scenario.energies.slice(0, 6).map((card) => card.instanceId));
    expect(staleResult.gameState.pendingAbilities).toHaveLength(1);
    expect(staleResult.gameState.actionHistory).toEqual(stale.actionHistory);
    const selected = scenario.energies.slice(0, 6).map((card) => card.instanceId);
    game = command(game, selected);
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(scoreModifiers(game)).toEqual([]);
  });

  it('does not write SCORE after the source leaves the controller LIVE zone', () => {
    const scenario = setup({ waitingCount: 0 });
    const preview = resolvePendingCardEffects(scenario.game).gameState;
    const departed = updatePlayer(preview, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.sources[0]!.instanceId),
    }));
    const resolved = command(departed);
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(3);
  });

  it('ignores non-CatChu! members and does not count memberBelow', () => {
    const scenario = setup({ waitingCount: 1, memberNames: ['澁谷かのん', '鬼塚夏美'], memberUnits: ['CatChu!', '5yncri5e!'] });
    const below = member('below', '嵐千砂都');
    const opponent = member('opponent', '平安名すみれ', 'CatChu!', P2);
    let game = registerCards(scenario.game, [below, opponent]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.LEFT]: [below.instanceId],
        },
      },
    }));
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, opponent.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const { resolved } = startAndConfirm(game);
    expect(resolved.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(OrientationState.WAITING);
    expect(scoreModifiers(resolved)).toEqual([]);
  });
});
