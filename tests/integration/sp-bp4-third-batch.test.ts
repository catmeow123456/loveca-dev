import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP4_006_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_LIVE_TO_HAND_ABILITY_ID,
  SP_BP4_026_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_SCORE_ABILITY_ID,
  SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMember(
  cardCode: string,
  name: string,
  groupNames: readonly string[] = ['Liella!']
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    unitName: 'Liella!',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, name = cardCode, groupNames: readonly string[] = ['Liella!']): LiveCardData {
  return {
    cardCode,
    name,
    groupNames,
    unitName: 'Liella!',
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: 'Energy',
    cardType: CardType.ENERGY,
  };
}

function pendingAbility(
  abilityId: string,
  sourceCardId: string,
  id = abilityId
): PendingAbilityState {
  return {
    id: `${id}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`${id}:event`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function baseGame(gameId = 'sp-bp4-third-batch'): GameState {
  return createGameState(gameId, PLAYER1, 'P1', PLAYER2, 'P2');
}

function withCheerState(
  game: GameState,
  cheerCards: readonly ReturnType<typeof createCardInstance>[],
  resolutionCards: readonly ReturnType<typeof createCardInstance>[] = cheerCards
): GameState {
  const cheerCardIds = cheerCards.map((card) => card.instanceId);
  const resolutionCardIds = resolutionCards.map((card) => card.instanceId);
  const state = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: resolutionCardIds,
      revealedCardIds: resolutionCardIds,
    },
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: cheerCardIds,
    },
  };
  return emitGameEvent(
    state,
    createCheerEvent(PLAYER1, cheerCardIds, cheerCardIds.length, { automated: true })
  );
}

function resolvePending(game: GameState, pendingAbilities: readonly PendingAbilityState[]): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities,
  }).gameState;
}

describe('PL!SP-bp4 third batch effects', () => {
  it('PL!SP-bp4-006 counts current cheer facts even when one Liella member already left resolutionZone, then moves only a current revealed Liella! LIVE to hand', () => {
    const source = createCardInstance(
      createMember('PL!SP-bp4-006-R', '桜小路きな子'),
      PLAYER1,
      'bp4-006-source'
    );
    const kanon = createCardInstance(createMember('LIELLA-KANON', '澁谷かのん'), PLAYER1, 'kanon');
    const keke = createCardInstance(createMember('LIELLA-KEKE', '唐 可可'), PLAYER1, 'keke');
    const chisato = createCardInstance(
      createMember('LIELLA-CHISATO', '嵐 千砂都'),
      PLAYER1,
      'chisato'
    );
    const targetLive = createCardInstance(
      createLive('PL!SP-bp4-target-live', 'Liella! LIVE'),
      PLAYER1,
      'target-live'
    );
    let game = registerCards(baseGame(), [source, kanon, keke, chisato, targetLive]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: addCardToStatefulZone(player.hand, chisato.instanceId),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = withCheerState(game, [kanon, keke, chisato, targetLive], [kanon, keke, targetLive]);

    const started = resolvePending(game, [
      pendingAbility(
        SP_BP4_006_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_LIVE_TO_HAND_ABILITY_ID,
        source.instanceId,
        'bp4-006'
      ),
    ]);

    expect(started.activeEffect).toMatchObject({
      abilityId: SP_BP4_006_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_LIVE_TO_HAND_ABILITY_ID,
      selectableCardIds: [targetLive.instanceId],
    });

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      targetLive.instanceId
    );

    expect(resolved.players[0].hand.cardIds).toContain(targetLive.instanceId);
    expect(resolved.players[0].waitingRoom.cardIds).not.toContain(targetLive.instanceId);
    expect(resolved.resolutionZone.cardIds).not.toContain(targetLive.instanceId);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'MOVE_REVEALED_CHEER_LIELLA_LIVE_TO_HAND',
      differentNameLiellaMemberCount: 3,
    });
  });

  it('PL!SP-bp4-006 does not double-count same-name, non-Liella, or non-member cheer cards', () => {
    const source = createCardInstance(
      createMember('PL!SP-bp4-006-P', '桜小路きな子'),
      PLAYER1,
      'bp4-006-source-2'
    );
    const kanonA = createCardInstance(createMember('LIELLA-KANON-A', '澁谷かのん'), PLAYER1, 'kanon-a');
    const kanonB = createCardInstance(createMember('LIELLA-KANON-B', '澁谷かのん'), PLAYER1, 'kanon-b');
    const aqours = createCardInstance(
      createMember('AQOURS-CHIKA', '高海千歌', ['Aqours']),
      PLAYER1,
      'aqours'
    );
    const targetLive = createCardInstance(
      createLive('PL!SP-bp4-target-live-2', 'Liella! LIVE'),
      PLAYER1,
      'target-live-2'
    );
    let game = registerCards(baseGame('sp-bp4-006-counting'), [
      source,
      kanonA,
      kanonB,
      aqours,
      targetLive,
    ]);
    game = withCheerState(game, [kanonA, kanonB, aqours, targetLive]);

    const started = resolvePending(game, [
      pendingAbility(
        SP_BP4_006_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_LIVE_TO_HAND_ABILITY_ID,
        source.instanceId,
        'bp4-006-counting'
      ),
    ]);
    expect(started.activeEffect?.effectText).toContain('当前不同名Liella!成员 1名');
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.players[0].hand.cardIds).not.toContain(targetLive.instanceId);
    expect(resolved.resolutionZone.cardIds).toContain(targetLive.instanceId);
  });

  it('PL!SP-bp4-006 consumes as no-op when condition is met but no movable Liella! LIVE target remains', () => {
    const source = createCardInstance(
      createMember('PL!SP-bp4-006-R', '桜小路きな子'),
      PLAYER1,
      'bp4-006-source-3'
    );
    const members = ['澁谷かのん', '唐 可可', '嵐 千砂都'].map((name, index) =>
      createCardInstance(createMember(`LIELLA-MEMBER-${index}`, name), PLAYER1, `member-${index}`)
    );
    let game = registerCards(baseGame('sp-bp4-006-no-target'), [source, ...members]);
    game = withCheerState(game, members, members);

    const started = resolvePending(game, [
      pendingAbility(
        SP_BP4_006_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_LIVE_TO_HAND_ABILITY_ID,
        source.instanceId,
        'bp4-006-no-target'
      ),
    ]);
    expect(started.activeEffect?.effectText).toContain('满足条件但无可移动目标');
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'NO_REVEALED_CHEER_LIELLA_LIVE_TARGET',
      conditionMet: true,
      movedCardIds: [],
    });
  });

  it('PL!SP-bp4-026 adds SCORE +1 and refreshes playerScores with five different named Liella! cheer members', () => {
    const live = createCardInstance(createLive('PL!SP-bp4-026-L', 'Wish Song'), PLAYER1, 'wish-song');
    const members = ['澁谷かのん', '唐 可可', '嵐 千砂都', '平安名すみれ', '葉月恋'].map((name, index) =>
      createCardInstance(createMember(`WISH-SONG-MEMBER-${index}`, name), PLAYER1, `wish-member-${index}`)
    );
    let game = registerCards(baseGame('sp-bp4-026-score'), [live, ...members]);
    game = withCheerState(game, members);
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[PLAYER1, 4]]),
      },
    };

    const started = resolvePending(game, [
      pendingAbility(
        SP_BP4_026_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_SCORE_ABILITY_ID,
        live.instanceId,
        'bp4-026-score'
      ),
    ]);
    expect(started.activeEffect?.effectText).toContain('当前不同名Liella!成员 5名');
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: live.instanceId,
      sourceCardId: live.instanceId,
      abilityId: SP_BP4_026_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_SCORE_ABILITY_ID,
    });
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('PL!SP-bp4-026 score segment is no-op below five different named Liella! cheer members', () => {
    const live = createCardInstance(createLive('PL!SP-bp4-026-SRL', 'Wish Song'), PLAYER1, 'wish-song-low');
    const members = ['澁谷かのん', '唐 可可', '嵐 千砂都', '平安名すみれ'].map((name, index) =>
      createCardInstance(createMember(`WISH-SONG-LOW-${index}`, name), PLAYER1, `wish-low-${index}`)
    );
    let game = registerCards(baseGame('sp-bp4-026-score-low'), [live, ...members]);
    game = withCheerState(game, members);

    const started = resolvePending(game, [
      pendingAbility(
        SP_BP4_026_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_SCORE_ABILITY_ID,
        live.instanceId,
        'bp4-026-score-low'
      ),
    ]);
    expect(started.activeEffect?.effectText).toContain('未满足条件，不增加[スコア]');
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
  });

  it('PL!SP-bp4-026 draws two then lets the player discard one hand card with eleven energy', () => {
    const live = createCardInstance(createLive('PL!SP-bp4-026-L', 'Wish Song'), PLAYER1, 'wish-song-draw');
    const hand = createCardInstance(createMember('WISH-HAND', '澁谷かのん'), PLAYER1, 'wish-hand');
    const drawA = createCardInstance(createMember('WISH-DRAW-A', '唐 可可'), PLAYER1, 'wish-draw-a');
    const drawB = createCardInstance(createMember('WISH-DRAW-B', '嵐 千砂都'), PLAYER1, 'wish-draw-b');
    const energies = Array.from({ length: 11 }, (_, index) =>
      createCardInstance(createEnergy(`WISH-ENERGY-${index}`), PLAYER1, `wish-energy-${index}`)
    );
    let game = registerCards(baseGame('sp-bp4-026-draw-discard'), [
      live,
      hand,
      drawA,
      drawB,
      ...energies,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: addCardToStatefulZone(player.hand, hand.instanceId),
      mainDeck: [drawA, drawB].reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.mainDeck
      ),
      energyZone: energies.reduce(
        (zone, card) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    }));

    const started = resolvePending(game, [
      pendingAbility(
        SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
        live.instanceId,
        'bp4-026-draw-discard'
      ),
    ]);

    expect(started.activeEffect).toMatchObject({
      abilityId: SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      stepId: 'SP_BP4_026_SELECT_DISCARD_AFTER_DRAW',
    });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(started.activeEffect?.selectableCardIds).toEqual([
      hand.instanceId,
      drawA.instanceId,
      drawB.instanceId,
    ]);

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      drawA.instanceId
    );
    expect(resolved.players[0].waitingRoom.cardIds).toContain(drawA.instanceId);
    expect(resolved.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)).toBe(
      true
    );
  });

  it('PL!SP-bp4-026 draw-discard segment is confirm-only no-op below eleven energy', () => {
    const live = createCardInstance(createLive('PL!SP-bp4-026-L', 'Wish Song'), PLAYER1, 'wish-song-low-energy');
    const energies = Array.from({ length: 10 }, (_, index) =>
      createCardInstance(createEnergy(`WISH-LOW-ENERGY-${index}`), PLAYER1, `wish-low-energy-${index}`)
    );
    let game = registerCards(baseGame('sp-bp4-026-low-energy'), [live, ...energies]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: energies.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.energyZone
      ),
    }));

    const started = resolvePending(game, [
      pendingAbility(
        SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
        live.instanceId,
        'bp4-026-low-energy'
      ),
    ]);
    expect(started.activeEffect?.effectText).toContain('当前能量 10张');
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'ENERGY_ELEVEN_CONDITION_NOT_MET',
      energyCount: 10,
      conditionMet: false,
    });
  });

  it('PL!SP-bp4-026 same-source LIVE_SUCCESS pending can be manually selected before the draw-discard segment', () => {
    const live = createCardInstance(createLive('PL!SP-bp4-026-L', 'Wish Song'), PLAYER1, 'wish-song-manual');
    const members = ['澁谷かのん', '唐 可可', '嵐 千砂都', '平安名すみれ', '葉月恋'].map((name, index) =>
      createCardInstance(createMember(`WISH-MANUAL-${index}`, name), PLAYER1, `wish-manual-${index}`)
    );
    const hand = createCardInstance(createMember('WISH-MANUAL-HAND', '桜小路きな子'), PLAYER1, 'wish-manual-hand');
    const drawA = createCardInstance(createMember('WISH-MANUAL-DRAW-A', '米女メイ'), PLAYER1, 'wish-manual-draw-a');
    const drawB = createCardInstance(createMember('WISH-MANUAL-DRAW-B', '若菜四季'), PLAYER1, 'wish-manual-draw-b');
    const energies = Array.from({ length: 11 }, (_, index) =>
      createCardInstance(createEnergy(`WISH-MANUAL-ENERGY-${index}`), PLAYER1, `wish-manual-energy-${index}`)
    );
    let game = registerCards(baseGame('sp-bp4-026-manual'), [
      live,
      ...members,
      hand,
      drawA,
      drawB,
      ...energies,
    ]);
    game = withCheerState(game, members);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: addCardToStatefulZone(player.hand, hand.instanceId),
      mainDeck: [drawA, drawB].reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.mainDeck
      ),
      energyZone: energies.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.energyZone
      ),
    }));
    const scorePending = pendingAbility(
      SP_BP4_026_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_SCORE_ABILITY_ID,
      live.instanceId,
      'bp4-026-manual-score'
    );
    const drawPending = pendingAbility(
      SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      live.instanceId,
      'bp4-026-manual-draw'
    );

    const orderSelection = resolvePending(game, [scorePending, drawPending]);
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    expect(orderSelection.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      scorePending.id,
      drawPending.id,
    ]);

    const confirmScore = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      scorePending.id
    );
    expect(confirmScore.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    const afterScore = confirmActiveEffectStep(confirmScore, PLAYER1, confirmScore.activeEffect!.id);
    expect(afterScore.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(afterScore.pendingAbilities).toEqual([]);
    expect(afterScore.activeEffect).toMatchObject({
      abilityId: SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      stepId: 'SP_BP4_026_SELECT_DISCARD_AFTER_DRAW',
    });
  });

  it('PL!SP-bp4-026 ordered resolution auto-resolves score then stops at the real draw-discard interaction', () => {
    const live = createCardInstance(createLive('PL!SP-bp4-026-L', 'Wish Song'), PLAYER1, 'wish-song-order');
    const members = ['澁谷かのん', '唐 可可', '嵐 千砂都', '平安名すみれ', '葉月恋'].map((name, index) =>
      createCardInstance(createMember(`WISH-ORDER-${index}`, name), PLAYER1, `wish-order-${index}`)
    );
    const hand = createCardInstance(createMember('WISH-ORDER-HAND', '桜小路きな子'), PLAYER1, 'wish-order-hand');
    const drawA = createCardInstance(createMember('WISH-ORDER-DRAW-A', '米女メイ'), PLAYER1, 'wish-order-draw-a');
    const drawB = createCardInstance(createMember('WISH-ORDER-DRAW-B', '若菜四季'), PLAYER1, 'wish-order-draw-b');
    const energies = Array.from({ length: 11 }, (_, index) =>
      createCardInstance(createEnergy(`WISH-ORDER-ENERGY-${index}`), PLAYER1, `wish-order-energy-${index}`)
    );
    let game = registerCards(baseGame('sp-bp4-026-order'), [
      live,
      ...members,
      hand,
      drawA,
      drawB,
      ...energies,
    ]);
    game = withCheerState(game, members);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: addCardToStatefulZone(player.hand, hand.instanceId),
      mainDeck: [drawA, drawB].reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.mainDeck
      ),
      energyZone: energies.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.energyZone
      ),
    }));
    const pending = [
      pendingAbility(
        SP_BP4_026_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_SCORE_ABILITY_ID,
        live.instanceId,
        'bp4-026-order-score'
      ),
      pendingAbility(
        SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
        live.instanceId,
        'bp4-026-order-draw'
      ),
    ];
    const orderSelection = resolvePending(game, pending);

    const ordered = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(ordered.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(ordered.activeEffect).toMatchObject({
      abilityId: SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      stepId: 'SP_BP4_026_SELECT_DISCARD_AFTER_DRAW',
    });
    expect(ordered.activeEffect?.metadata?.orderedResolution).toBe(true);
  });
});
