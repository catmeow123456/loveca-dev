import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID,
  PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
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

function createMia(): MemberCardData {
  return {
    cardCode: 'PL!N-bp4-011-P',
    name: 'ミア・テイラー',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(
  name: string,
  options: { readonly groupNames?: readonly string[]; readonly cardCode?: string } = {}
): LiveCardData {
  return {
    cardCode: options.cardCode ?? `LIVE-${name}`,
    name,
    groupNames: options.groupNames ?? ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function baseGame(sourceId = 'n-bp4-011-source'): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(createMia(), PLAYER1, sourceId);
  let game = createGameState('n-bp4-011-mia-taylor', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { game, source };
}

function addCards(game: GameState, cards: readonly ReturnType<typeof createCardInstance>[]) {
  return registerCards(game, cards);
}

function withPlayerZones(
  game: GameState,
  options: {
    readonly hand?: readonly string[];
    readonly mainDeck?: readonly string[];
    readonly waitingRoom?: readonly string[];
  }
): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [...(options.hand ?? player.hand.cardIds)] },
    mainDeck: { ...player.mainDeck, cardIds: [...(options.mainDeck ?? player.mainDeck.cardIds)] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [...(options.waitingRoom ?? player.waitingRoom.cardIds)],
    },
  }));
}

function withPending(game: GameState, pending: PendingAbilityState): GameState {
  return { ...game, pendingAbilities: [pending] };
}

function pendingAbility(abilityId: string, sourceCardId: string): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:test`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId:
      abilityId === PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID
        ? TriggerCondition.ON_LIVE_START
        : TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function chooseCard(game: GameState, selectedCardId: string | null): GameState {
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    PLAYER1,
    game.activeEffect!.id,
    selectedCardId
  );
}

function chooseHeart(game: GameState, color: HeartColor): GameState {
  const disclosed = confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    color
  );
  expect(disclosed.activeEffect).toMatchObject({
    stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
    effectChoice: { selectedOptionIds: [color] },
  });
  return confirmActiveEffectStep(disclosed, PLAYER1, disclosed.activeEffect!.id);
}

describe('PL!N-bp4-011 Mia Taylor live-start and live-success workflow', () => {
  it('discards one hand LIVE, enqueues its waiting-room event, then grants the selected Heart', () => {
    const scenario = baseGame();
    const handLive = createCardInstance(createLive('Discarded Live'), PLAYER1, 'hand-live');
    const handMember = createCardInstance(createMember('hand-member'), PLAYER1, 'hand-member');
    let game = addCards(scenario.game, [handLive, handMember]);
    game = withPlayerZones(game, {
      hand: [handLive.instanceId, handMember.instanceId],
    });
    game = withPending(
      game,
      pendingAbility(
        PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID,
        scenario.source.instanceId
      )
    );

    let state = resolve(game);
    expect(state.activeEffect?.selectableCardIds).toEqual([handLive.instanceId]);

    state = chooseCard(state, handLive.instanceId);
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === handLive.instanceId &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.toZone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
    expect(state.activeEffect?.effectChoice?.options.map((option) => option.id)).toEqual([
      HeartColor.PINK,
      HeartColor.RED,
      HeartColor.YELLOW,
      HeartColor.GREEN,
      HeartColor.BLUE,
      HeartColor.PURPLE,
    ]);
    expect(state.activeEffect?.selectableOptions).toBeUndefined();

    state = chooseHeart(state, HeartColor.GREEN);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0]!.hand.cardIds).toEqual([handMember.instanceId]);
    expect(state.players[0]!.waitingRoom.cardIds).toContain(handLive.instanceId);
    expect(state.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
      sourceCardId: scenario.source.instanceId,
      abilityId: PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID,
    });
  });

  it('does not discard or write Heart when there is no hand LIVE or the controller declines', () => {
    const noLiveScenario = baseGame('no-live-source');
    const handMember = createCardInstance(createMember('hand-member'), PLAYER1, 'only-member');
    let noLiveGame = addCards(noLiveScenario.game, [handMember]);
    noLiveGame = withPlayerZones(noLiveGame, { hand: [handMember.instanceId] });
    noLiveGame = withPending(
      noLiveGame,
      pendingAbility(
        PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID,
        noLiveScenario.source.instanceId
      )
    );
    const noLiveResolved = resolve(noLiveGame);
    expect(noLiveResolved.activeEffect).toBeNull();
    expect(noLiveResolved.players[0]!.hand.cardIds).toEqual([handMember.instanceId]);
    expect(noLiveResolved.liveResolution.liveModifiers).toEqual([]);

    const skipScenario = baseGame('skip-source');
    const handLive = createCardInstance(createLive('Skipped Live'), PLAYER1, 'skipped-live');
    let skipGame = addCards(skipScenario.game, [handLive]);
    skipGame = withPlayerZones(skipGame, { hand: [handLive.instanceId] });
    skipGame = withPending(
      skipGame,
      pendingAbility(
        PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID,
        skipScenario.source.instanceId
      )
    );

    const skipped = chooseCard(resolve(skipGame), null);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0]!.hand.cardIds).toEqual([handLive.instanceId]);
    expect(skipped.players[0]!.waitingRoom.cardIds).toEqual([]);
    expect(skipped.liveResolution.liveModifiers).toEqual([]);
  });

  it('mills five, lets newly milled Nijigasaki LIVE satisfy the distinct-name condition, and recovers one', () => {
    const scenario = baseGame('success-source');
    const waitingA = createCardInstance(createLive('Niji A'), PLAYER1, 'waiting-a');
    const waitingB = createCardInstance(createLive('Niji B'), PLAYER1, 'waiting-b');
    const milledNiji = createCardInstance(createLive('Niji C'), PLAYER1, 'milled-niji');
    const milledOther = createCardInstance(
      createLive('Other Live', { groupNames: ['Liella!'] }),
      PLAYER1,
      'milled-other-live'
    );
    const milledMember1 = createCardInstance(createMember('milled-member-1'), PLAYER1, 'milled-1');
    const milledMember2 = createCardInstance(createMember('milled-member-2'), PLAYER1, 'milled-2');
    const milledMember3 = createCardInstance(createMember('milled-member-3'), PLAYER1, 'milled-3');
    const deckRest = createCardInstance(createMember('deck-rest'), PLAYER1, 'deck-rest');
    let game = addCards(scenario.game, [
      waitingA,
      waitingB,
      milledNiji,
      milledOther,
      milledMember1,
      milledMember2,
      milledMember3,
      deckRest,
    ]);
    const milledCardIds = [
      milledNiji.instanceId,
      milledOther.instanceId,
      milledMember1.instanceId,
      milledMember2.instanceId,
      milledMember3.instanceId,
    ];
    game = withPlayerZones(game, {
      waitingRoom: [waitingA.instanceId, waitingB.instanceId],
      mainDeck: [...milledCardIds, deckRest.instanceId],
    });
    game = withPending(
      game,
      pendingAbility(
        PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
        scenario.source.instanceId
      )
    );

    let state = resolve(game);
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.MAIN_DECK &&
          entry.event.toZone === ZoneType.WAITING_ROOM &&
          'cardInstanceIds' in entry.event &&
          entry.event.cardInstanceIds.length === 5 &&
          entry.event.cardInstanceIds.every((cardId, index) => cardId === milledCardIds[index])
      )
    ).toBe(true);
    expect(state.activeEffect?.selectableCardIds).toEqual([
      waitingA.instanceId,
      waitingB.instanceId,
      milledNiji.instanceId,
    ]);

    state = chooseCard(state, milledNiji.instanceId);
    expect(state.activeEffect).toBeNull();
    expect(state.players[0]!.hand.cardIds).toEqual([milledNiji.instanceId]);
    expect(state.players[0]!.waitingRoom.cardIds).not.toContain(milledNiji.instanceId);
  });

  it('mills five but no-ops when fewer than three different-name Nijigasaki LIVE are present', () => {
    const scenario = baseGame('insufficient-source');
    const waitingA = createCardInstance(createLive('Same Niji'), PLAYER1, 'waiting-same');
    const milledSame = createCardInstance(createLive('Same Niji'), PLAYER1, 'milled-same');
    const milledOther = createCardInstance(
      createLive('Other Live', { groupNames: ['Liella!'] }),
      PLAYER1,
      'milled-other'
    );
    const filler1 = createCardInstance(createMember('filler-1'), PLAYER1, 'filler-1');
    const filler2 = createCardInstance(createMember('filler-2'), PLAYER1, 'filler-2');
    const filler3 = createCardInstance(createMember('filler-3'), PLAYER1, 'filler-3');
    const deckRest = createCardInstance(
      createMember('insufficient-rest'),
      PLAYER1,
      'insufficient-rest'
    );
    let game = addCards(scenario.game, [
      waitingA,
      milledSame,
      milledOther,
      filler1,
      filler2,
      filler3,
      deckRest,
    ]);
    game = withPlayerZones(game, {
      waitingRoom: [waitingA.instanceId],
      mainDeck: [
        milledSame.instanceId,
        milledOther.instanceId,
        filler1.instanceId,
        filler2.instanceId,
        filler3.instanceId,
        deckRest.instanceId,
      ],
    });
    game = withPending(
      game,
      pendingAbility(
        PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
        scenario.source.instanceId
      )
    );

    const state = resolve(game);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0]!.hand.cardIds).toEqual([]);
    expect(state.players[0]!.waitingRoom.cardIds).toContain(milledSame.instanceId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID &&
          action.payload.step === 'MILL_FIVE_DISTINCT_NIJIGASAKI_LIVE_NOT_MET'
      )
    ).toBe(true);
  });

  it('keeps the recovery window open for illegal or stale recovery targets', () => {
    const scenario = baseGame('stale-source');
    const waitingA = createCardInstance(createLive('Niji A'), PLAYER1, 'stale-a');
    const waitingB = createCardInstance(createLive('Niji B'), PLAYER1, 'stale-b');
    const waitingC = createCardInstance(createLive('Niji C'), PLAYER1, 'stale-c');
    const illegalLive = createCardInstance(
      createLive('Illegal', { groupNames: ['Liella!'] }),
      PLAYER1,
      'illegal-live'
    );
    const fillerCards = [0, 1, 2, 3, 4].map((index) =>
      createCardInstance(createMember(`filler-${index}`), PLAYER1, `stale-filler-${index}`)
    );
    const deckRest = createCardInstance(createMember('stale-rest'), PLAYER1, 'stale-rest');
    let game = addCards(scenario.game, [
      waitingA,
      waitingB,
      waitingC,
      illegalLive,
      ...fillerCards,
      deckRest,
    ]);
    game = withPlayerZones(game, {
      waitingRoom: [waitingA.instanceId, waitingB.instanceId, waitingC.instanceId],
      mainDeck: [...fillerCards.map((card) => card.instanceId), deckRest.instanceId],
    });
    game = withPending(
      game,
      pendingAbility(
        PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
        scenario.source.instanceId
      )
    );

    const started = resolve(game);
    const illegalResult = chooseCard(started, illegalLive.instanceId);
    expect(illegalResult.activeEffect?.id).toBe(started.activeEffect?.id);
    expect(illegalResult.players[0]!.hand.cardIds).toEqual([]);

    const staleState = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== waitingA.instanceId),
      },
    }));
    const staleResult = chooseCard(staleState, waitingA.instanceId);
    expect(staleResult.activeEffect?.id).toBe(started.activeEffect?.id);
    expect(staleResult.players[0]!.hand.cardIds).toEqual([]);
  });
});
