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
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP6_004_LIVE_START_RETURN_NO_LIVE_START_AQOURS_LIVE_GAIN_RED_GREEN_HEART_ABILITY_ID,
  S_BP6_019_LIVE_START_ALL_AQOURS_SCORE_DRAW_HAND_TOP_BOTTOM_ABILITY_ID,
  S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID,
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

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupName?: string;
    readonly blade?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupName: options.groupName ?? 'Aqours',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLiveCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupName?: string;
    readonly score?: number;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupName: options.groupName ?? 'Aqours',
    cardType: CardType.LIVE,
    score: options.score ?? 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    bladeHearts: [],
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`${abilityId}:event`],
    sourceSlot,
  };
}

function createSessionFromGame(game: GameState, gameId = 's-future-water-batch2') {
  const session = createGameSession();
  session.createGame(gameId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function placeCenterMember(game: GameState, cardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function placeStageMembers(
  game: GameState,
  members: readonly { readonly cardId: string; readonly slot: SlotPosition }[]
): GameState {
  return updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const member of members) {
      memberSlots = placeCardInSlot(memberSlots, member.slot, member.cardId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
}

function placeLiveZone(
  game: GameState,
  liveCardIds: readonly string[],
  extra: Partial<GameState['players'][number]> = {}
): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    ...extra,
    liveZone: {
      ...player.liveZone,
      cardIds: [...liveCardIds],
      cardStates: new Map(
        liveCardIds.map((cardId) => [
          cardId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
        ])
      ),
    },
  }));
}

describe('未来水卡组 执行批次2 focused workflows', () => {
  it('PL!S-sd1-009 reveals an Aqours hand card, moves it to deck top, and gains BLADE', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-sd1-009-SD', { name: '黒澤ルビィ', cost: 9, blade: 3 }),
      PLAYER1,
      'sd1-009-source'
    );
    const aqoursHand = createCardInstance(createMemberCard('PL!S-hand-aqours'), PLAYER1, 'aqours-hand');
    const nonAqoursHand = createCardInstance(
      createMemberCard('PL!SP-hand-liella', { groupName: 'Liella!' }),
      PLAYER1,
      'liella-hand'
    );
    const deckCard = createCardInstance(createMemberCard('PL!S-deck-card'), PLAYER1, 'deck-card');
    let game = registerCards(createGameState('sd1-009', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      aqoursHand,
      nonAqoursHand,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [aqoursHand.instanceId, nonAqoursHand.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID,
          source.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'sd1-009');

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([aqoursHand.instanceId]);

    const reveal = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, aqoursHand.instanceId)
    );
    expect(reveal.success, reveal.error).toBe(true);
    expect(session.state?.activeEffect?.revealedCardIds).toEqual([aqoursHand.instanceId]);

    const move = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'top'
      )
    );
    expect(move.success, move.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([nonAqoursHand.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      aqoursHand.instanceId,
      deckCard.instanceId,
    ]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: source.instanceId,
      abilityId: S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID,
    });
  });

  it('PL!S-sd1-009 decline does not move hand cards or gain BLADE', () => {
    const source = createCardInstance(createMemberCard('PL!S-sd1-009-SD'), PLAYER1, 'sd1-009-decline');
    const hand = createCardInstance(createMemberCard('PL!S-hand-aqours'), PLAYER1, 'decline-hand');
    let game = registerCards(createGameState('sd1-009-decline', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      hand,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [hand.instanceId] },
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID,
          source.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'sd1-009-decline');

    const decline = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );
    expect(decline.success, decline.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([hand.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toHaveLength(0);
  });

  it('PL!S-bp3-025 scores only when the selected Aqours member has at least 6 effective BLADE', () => {
    const live = createCardInstance(
      createLiveCard('PL!S-bp3-025-L', { name: 'SUKI for you, DREAM for you!', score: 5 }),
      PLAYER1,
      'bp3-025-live'
    );
    const highBlade = createCardInstance(
      createMemberCard('PL!S-high-blade', { blade: 6 }),
      PLAYER1,
      'high-blade'
    );
    const lowBlade = createCardInstance(
      createMemberCard('PL!S-low-blade', { blade: 5 }),
      PLAYER1,
      'low-blade'
    );
    const nonAqours = createCardInstance(
      createMemberCard('PL!SP-liella-member', { groupName: 'Liella!', blade: 9 }),
      PLAYER1,
      'liella-member'
    );
    let game = registerCards(createGameState('bp3-025', PLAYER1, 'P1', PLAYER2, 'P2'), [
      live,
      highBlade,
      lowBlade,
      nonAqours,
    ]);
    game = placeLiveZone(game, [live.instanceId]);
    game = placeStageMembers(game, [
      { cardId: highBlade.instanceId, slot: SlotPosition.LEFT },
      { cardId: lowBlade.instanceId, slot: SlotPosition.CENTER },
      { cardId: nonAqours.instanceId, slot: SlotPosition.RIGHT },
    ]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID,
          live.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp3-025');

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      highBlade.instanceId,
      lowBlade.instanceId,
    ]);

    const score = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, highBlade.instanceId)
    );
    expect(score.success, score.error).toBe(true);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: live.instanceId,
      sourceCardId: live.instanceId,
      abilityId: S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID,
    });
  });

  it('PL!S-bp3-025 selected Aqours member below 6 BLADE does not add score', () => {
    const live = createCardInstance(createLiveCard('PL!S-bp3-025-L'), PLAYER1, 'bp3-025-low-live');
    const lowBlade = createCardInstance(
      createMemberCard('PL!S-low-blade', { blade: 5 }),
      PLAYER1,
      'bp3-025-low-member'
    );
    let game = registerCards(createGameState('bp3-025-low', PLAYER1, 'P1', PLAYER2, 'P2'), [
      live,
      lowBlade,
    ]);
    game = placeLiveZone(game, [live.instanceId]);
    game = placeStageMembers(game, [{ cardId: lowBlade.instanceId, slot: SlotPosition.CENTER }]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID,
          live.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp3-025-low');

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, lowBlade.instanceId)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    expect(session.state?.liveResolution.liveModifiers).toHaveLength(0);
  });

  it('PL!S-bp6-004 returns a no-LIVE_START Aqours LIVE to deck top and gives source red and green Heart', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-004-P', { name: '黒澤ダイヤ', cost: 11 }),
      PLAYER1,
      'bp6-004-source'
    );
    const targetLive = createCardInstance(createLiveCard('PL!S-no-live-start-live'), PLAYER1, 'target-live');
    const liveStartLive = createCardInstance(
      createLiveCard('PL!S-bp6-019-L', { name: 'Step! ZERO to ONE' }),
      PLAYER1,
      'has-live-start-live'
    );
    const deckCard = createCardInstance(createMemberCard('PL!S-deck-card'), PLAYER1, 'bp6-004-deck');
    let game = registerCards(createGameState('bp6-004', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      targetLive,
      liveStartLive,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [targetLive.instanceId, liveStartLive.instanceId], {
      mainDeck: { ...game.players[0].mainDeck, cardIds: [deckCard.instanceId] },
    });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_004_LIVE_START_RETURN_NO_LIVE_START_AQOURS_LIVE_GAIN_RED_GREEN_HEART_ABILITY_ID,
          source.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-004');

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLive.instanceId]);

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLive.instanceId)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).toEqual([liveStartLive.instanceId]);
    expect(session.state?.players[0].liveZone.cardStates.has(targetLive.instanceId)).toBe(false);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      targetLive.instanceId,
      deckCard.instanceId,
    ]);
    expect(session.state?.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [createHeartIcon(HeartColor.RED, 1), createHeartIcon(HeartColor.GREEN, 1)],
      sourceCardId: source.instanceId,
      abilityId:
        S_BP6_004_LIVE_START_RETURN_NO_LIVE_START_AQOURS_LIVE_GAIN_RED_GREEN_HEART_ABILITY_ID,
    });
  });

  it('PL!S-bp6-004 decline does not return a LIVE or gain Heart', () => {
    const source = createCardInstance(createMemberCard('PL!S-bp6-004-P'), PLAYER1, 'bp6-004-decline-source');
    const targetLive = createCardInstance(createLiveCard('PL!S-no-live-start-live'), PLAYER1, 'decline-target-live');
    const secondLive = createCardInstance(createLiveCard('PL!S-other-live'), PLAYER1, 'decline-second-live');
    let game = registerCards(createGameState('bp6-004-decline', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      targetLive,
      secondLive,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [targetLive.instanceId, secondLive.instanceId]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_004_LIVE_START_RETURN_NO_LIVE_START_AQOURS_LIVE_GAIN_RED_GREEN_HEART_ABILITY_ID,
          source.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-004-decline');

    const decline = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );
    expect(decline.success, decline.error).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).toEqual([
      targetLive.instanceId,
      secondLive.instanceId,
    ]);
    expect(session.state?.liveResolution.liveModifiers).toHaveLength(0);
  });

  it('PL!S-bp6-019 all Aqours stage scores, draws one, and places a hand card on deck bottom', () => {
    const live = createCardInstance(
      createLiveCard('PL!S-bp6-019-L', { name: 'Step! ZERO to ONE', score: 0 }),
      PLAYER1,
      'bp6-019-live'
    );
    const memberA = createCardInstance(createMemberCard('PL!S-stage-a'), PLAYER1, 'stage-a');
    const memberB = createCardInstance(createMemberCard('PL!S-stage-b'), PLAYER1, 'stage-b');
    const hand = createCardInstance(createMemberCard('PL!S-hand'), PLAYER1, 'bp6-019-hand');
    const drawn = createCardInstance(createMemberCard('PL!S-drawn'), PLAYER1, 'bp6-019-drawn');
    let game = registerCards(createGameState('bp6-019', PLAYER1, 'P1', PLAYER2, 'P2'), [
      live,
      memberA,
      memberB,
      hand,
      drawn,
    ]);
    game = placeLiveZone(game, [live.instanceId]);
    game = placeStageMembers(game, [
      { cardId: memberA.instanceId, slot: SlotPosition.LEFT },
      { cardId: memberB.instanceId, slot: SlotPosition.CENTER },
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [hand.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [drawn.instanceId] },
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_019_LIVE_START_ALL_AQOURS_SCORE_DRAW_HAND_TOP_BOTTOM_ABILITY_ID,
          live.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-019');

    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(session.state?.players[0].hand.cardIds).toEqual([hand.instanceId, drawn.instanceId]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      hand.instanceId,
      drawn.instanceId,
    ]);

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        hand.instanceId,
        undefined,
        undefined,
        'bottom'
      )
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([drawn.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([hand.instanceId]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: live.instanceId,
      sourceCardId: live.instanceId,
      abilityId: S_BP6_019_LIVE_START_ALL_AQOURS_SCORE_DRAW_HAND_TOP_BOTTOM_ABILITY_ID,
    });
  });

  it('PL!S-bp6-019 does nothing when own stage includes a non-Aqours member', () => {
    const live = createCardInstance(createLiveCard('PL!S-bp6-019-L'), PLAYER1, 'bp6-019-miss-live');
    const aqours = createCardInstance(createMemberCard('PL!S-stage-a'), PLAYER1, 'bp6-019-aqours');
    const nonAqours = createCardInstance(
      createMemberCard('PL!SP-stage-liella', { groupName: 'Liella!' }),
      PLAYER1,
      'bp6-019-liella'
    );
    const deckCard = createCardInstance(createMemberCard('PL!S-drawn'), PLAYER1, 'bp6-019-miss-deck');
    let game = registerCards(createGameState('bp6-019-miss', PLAYER1, 'P1', PLAYER2, 'P2'), [
      live,
      aqours,
      nonAqours,
      deckCard,
    ]);
    game = placeLiveZone(game, [live.instanceId]);
    game = placeStageMembers(game, [
      { cardId: aqours.instanceId, slot: SlotPosition.LEFT },
      { cardId: nonAqours.instanceId, slot: SlotPosition.CENTER },
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_019_LIVE_START_ALL_AQOURS_SCORE_DRAW_HAND_TOP_BOTTOM_ABILITY_ID,
          live.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-019-miss');

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckCard.instanceId]);
    expect(session.state?.liveResolution.liveModifiers).toHaveLength(0);
  });
});
