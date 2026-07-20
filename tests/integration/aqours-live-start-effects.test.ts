import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import {
  S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP6_004_LIVE_START_RETURN_NO_LIVE_START_AQOURS_LIVE_GAIN_RED_GREEN_HEART_ABILITY_ID,
  S_BP6_019_LIVE_START_ALL_AQOURS_SCORE_DRAW_HAND_TOP_BOTTOM_ABILITY_ID,
  S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
  S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
const BP6_020_GRANT_DRAW_OPTION_ID = 'grant-live-success-draw-one';
const BP6_020_GAIN_HEART_OPTION_ID = 'relay-entered-aqours-gain-red-heart';
const BP6_020_SCORE_OPTION_ID = 'success-live-two-this-live-score';
const BP6_020_SELECT_RELAY_ENTERED_AQOURS_MEMBER_STEP_ID =
  'S_BP6_020_SELECT_RELAY_ENTERED_AQOURS_MEMBER';

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly blade?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
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
    readonly groupNames?: readonly string[];
    readonly score?: number;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
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

function placeOpponentStageMember(game: GameState, cardId: string, slot: SlotPosition): GameState {
  return updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
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

function markEnteredThisTurn(
  game: GameState,
  playerId: string,
  cardIds: readonly string[]
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    movedToStageThisTurn: [...new Set([...player.movedToStageThisTurn, ...cardIds])],
  }));
}

function emitRelayEnterEvent(
  game: GameState,
  options: {
    readonly cardId: string;
    readonly playerId: string;
    readonly slot: SlotPosition;
    readonly replacedCardId: string;
  }
): GameState {
  return emitGameEvent(
    game,
    createEnterStageEvent(options.cardId, ZoneType.HAND, options.slot, options.playerId, options.playerId, {
      relayReplacements: [
        {
          cardId: options.replacedCardId,
          slot: options.slot,
          effectiveCost: 4,
        },
      ],
    })
  );
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
      createMemberCard('PL!SP-hand-liella', { groupNames: ['Liella!'] }),
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
    confirmPublicSelectionIfNeeded(session);
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
      createMemberCard('PL!SP-liella-member', { groupNames: ['Liella!'], blade: 9 }),
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
    confirmPublicSelectionIfNeeded(session);
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
    confirmPublicSelectionIfNeeded(session);
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
      createMemberCard('PL!SP-stage-liella', { groupNames: ['Liella!'] }),
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

  it('PL!S-bp6-020-L option A grants a LIVE_SUCCESS draw record', () => {
    const live = createCardInstance(
      createLiveCard('PL!S-bp6-020-L', { name: '冒険Type A, B, C!!', score: 4 }),
      PLAYER1,
      'bp6-020-live-a'
    );
    let game = registerCards(createGameState('bp6-020-a', PLAYER1, 'P1', PLAYER2, 'P2'), [live]);
    game = placeLiveZone(game, [live.instanceId]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID, live.instanceId),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-020-a');

    expect(session.state?.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      BP6_020_GRANT_DRAW_OPTION_ID,
      BP6_020_GAIN_HEART_OPTION_ID,
      BP6_020_SCORE_OPTION_ID,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    expect(session.state?.activeEffect?.selectionLabel).toBeUndefined();
    expect(session.state?.activeEffect?.effectChoice).toMatchObject({
      mode: 'SINGLE',
      options: [
        { id: BP6_020_GRANT_DRAW_OPTION_ID },
        { id: BP6_020_GAIN_HEART_OPTION_ID },
        { id: BP6_020_SCORE_OPTION_ID },
      ],
      publicConfirmation: true,
    });

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        BP6_020_GRANT_DRAW_OPTION_ID
      )
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      effectChoice: { selectedOptionIds: [BP6_020_GRANT_DRAW_OPTION_ID] },
    });
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID &&
          action.payload.step === 'GRANT_LIVE_SUCCESS_DRAW_ONE'
      )?.payload
    ).toMatchObject({
      step: 'GRANT_LIVE_SUCCESS_DRAW_ONE',
      grantedTurnCount: game.turnCount,
      sourceLiveCardId: live.instanceId,
    });
  });

  it('PL!S-bp6-020-L first window lets option A and C resolve without selecting a relay member', () => {
    for (const selectedOptionId of [BP6_020_GRANT_DRAW_OPTION_ID, BP6_020_SCORE_OPTION_ID]) {
      const live = createCardInstance(
        createLiveCard('PL!S-bp6-020-L', { score: 4 }),
        PLAYER1,
        `bp6-020-option-only-live-${selectedOptionId}`
      );
      const relayAqours = createCardInstance(
        createMemberCard('PL!S-option-only-relay'),
        PLAYER1,
        `option-only-relay-${selectedOptionId}`
      );
      const successLives = [0, 1].map((index) =>
        createCardInstance(
          createLiveCard(`PL!S-option-only-success-${index}`),
          PLAYER1,
          `option-only-success-${selectedOptionId}-${index}`
        )
      );
      let game = registerCards(
        createGameState(`bp6-020-option-only-${selectedOptionId}`, PLAYER1, 'P1', PLAYER2, 'P2'),
        [live, relayAqours, ...successLives]
      );
      game = placeLiveZone(game, [live.instanceId]);
      game = placeStageMembers(game, [{ cardId: relayAqours.instanceId, slot: SlotPosition.LEFT }]);
      game = markEnteredThisTurn(game, PLAYER1, [relayAqours.instanceId]);
      game = emitRelayEnterEvent(game, {
        cardId: relayAqours.instanceId,
        playerId: PLAYER1,
        slot: SlotPosition.LEFT,
        replacedCardId: `option-only-replaced-${selectedOptionId}`,
      });
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        successZone: {
          ...player.successZone,
          cardIds: successLives.map((card) => card.instanceId),
        },
      }));
      game = {
        ...game,
        liveResolution: {
          ...game.liveResolution,
          playerScores: new Map([[PLAYER1, 4]]),
        },
        pendingAbilities: [
          createPendingAbility(
            S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
            live.instanceId
          ),
        ],
      };
      const session = createSessionFromGame(
        resolvePendingCardEffects(game).gameState,
        `bp6-020-option-only-${selectedOptionId}`
      );

      expect(session.state?.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
        BP6_020_GRANT_DRAW_OPTION_ID,
        BP6_020_GAIN_HEART_OPTION_ID,
        BP6_020_SCORE_OPTION_ID,
      ]);
      expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();
      expect(session.state?.activeEffect?.selectionLabel).toBeUndefined();

      const finish = session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          selectedOptionId
        )
      );

      expect(finish.success, finish.error).toBe(true);
      confirmPublicSelectionIfNeeded(session);
      expect(session.state?.activeEffect).toBeNull();
      expect(
        session.state?.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID &&
            (selectedOptionId === BP6_020_GRANT_DRAW_OPTION_ID
              ? action.payload.step === 'GRANT_LIVE_SUCCESS_DRAW_ONE'
              : action.payload.step === 'SUCCESS_LIVE_TWO_THIS_LIVE_SCORE')
        )
      ).toBe(true);
    }
  });

  it('PL!S-bp6-020-L option B only targets this-turn relay-entered current-stage Aqours members', () => {
    const live = createCardInstance(createLiveCard('PL!S-bp6-020-L'), PLAYER1, 'bp6-020-live-b');
    const validRelayAqours = createCardInstance(createMemberCard('PL!S-valid-relay'), PLAYER1, 'valid-relay');
    const ordinaryAqours = createCardInstance(createMemberCard('PL!S-ordinary'), PLAYER1, 'ordinary');
    const nonAqoursRelay = createCardInstance(
      createMemberCard('PL!SP-non-aqours-relay', { groupNames: ['Liella!'] }),
      PLAYER1,
      'non-aqours-relay'
    );
    const opponentRelayAqours = createCardInstance(
      createMemberCard('PL!S-opponent-relay'),
      PLAYER2,
      'opponent-relay'
    );
    const leftStageRelayAqours = createCardInstance(
      createMemberCard('PL!S-left-stage-relay'),
      PLAYER1,
      'left-stage-relay'
    );
    let game = registerCards(createGameState('bp6-020-b', PLAYER1, 'P1', PLAYER2, 'P2'), [
      live,
      validRelayAqours,
      ordinaryAqours,
      nonAqoursRelay,
      opponentRelayAqours,
      leftStageRelayAqours,
    ]);
    game = placeLiveZone(game, [live.instanceId]);
    game = placeStageMembers(game, [
      { cardId: validRelayAqours.instanceId, slot: SlotPosition.LEFT },
      { cardId: ordinaryAqours.instanceId, slot: SlotPosition.CENTER },
      { cardId: nonAqoursRelay.instanceId, slot: SlotPosition.RIGHT },
    ]);
    game = placeOpponentStageMember(game, opponentRelayAqours.instanceId, SlotPosition.CENTER);
    game = markEnteredThisTurn(game, PLAYER1, [
      validRelayAqours.instanceId,
      ordinaryAqours.instanceId,
      nonAqoursRelay.instanceId,
      leftStageRelayAqours.instanceId,
    ]);
    game = markEnteredThisTurn(game, PLAYER2, [opponentRelayAqours.instanceId]);
    game = emitRelayEnterEvent(game, {
      cardId: validRelayAqours.instanceId,
      playerId: PLAYER1,
      slot: SlotPosition.LEFT,
      replacedCardId: 'p1-replaced-left',
    });
    game = emitRelayEnterEvent(game, {
      cardId: nonAqoursRelay.instanceId,
      playerId: PLAYER1,
      slot: SlotPosition.RIGHT,
      replacedCardId: 'p1-replaced-right',
    });
    game = emitRelayEnterEvent(game, {
      cardId: leftStageRelayAqours.instanceId,
      playerId: PLAYER1,
      slot: SlotPosition.CENTER,
      replacedCardId: 'p1-replaced-left-stage',
    });
    game = emitRelayEnterEvent(game, {
      cardId: opponentRelayAqours.instanceId,
      playerId: PLAYER2,
      slot: SlotPosition.CENTER,
      replacedCardId: 'p2-replaced-center',
    });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID, live.instanceId),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-020-b');

    expect(session.state?.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      BP6_020_GRANT_DRAW_OPTION_ID,
      BP6_020_GAIN_HEART_OPTION_ID,
      BP6_020_SCORE_OPTION_ID,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    expect(session.state?.activeEffect?.selectionLabel).toBeUndefined();

    const chooseHeart = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        BP6_020_GAIN_HEART_OPTION_ID
      )
    );
    expect(chooseHeart.success, chooseHeart.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect?.stepId).toBe(
      BP6_020_SELECT_RELAY_ENTERED_AQOURS_MEMBER_STEP_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([validRelayAqours.instanceId]);
    expect(session.state?.activeEffect?.selectionLabel).toBe(
      '选择本回合换手登场的 Aqours 成员'
    );

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        validRelayAqours.instanceId
      )
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: validRelayAqours.instanceId,
      hearts: [createHeartIcon(HeartColor.RED, 1)],
      sourceCardId: live.instanceId,
      abilityId: S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
    });
  });

  it('PL!S-bp6-020-L option B still displays and resolves no-op without legal relay members', () => {
    const live = createCardInstance(
      createLiveCard('PL!S-bp6-020-L'),
      PLAYER1,
      'bp6-020-live-b-no-target'
    );
    const ordinaryAqours = createCardInstance(
      createMemberCard('PL!S-ordinary-no-relay'),
      PLAYER1,
      'ordinary-no-relay'
    );
    let game = registerCards(createGameState('bp6-020-b-no-target', PLAYER1, 'P1', PLAYER2, 'P2'), [
      live,
      ordinaryAqours,
    ]);
    game = placeLiveZone(game, [live.instanceId]);
    game = placeStageMembers(game, [
      { cardId: ordinaryAqours.instanceId, slot: SlotPosition.CENTER },
    ]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID, live.instanceId),
      ],
    };
    const session = createSessionFromGame(
      resolvePendingCardEffects(game).gameState,
      'bp6-020-b-no-target'
    );

    expect(session.state?.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      BP6_020_GRANT_DRAW_OPTION_ID,
      BP6_020_GAIN_HEART_OPTION_ID,
      BP6_020_SCORE_OPTION_ID,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        BP6_020_GAIN_HEART_OPTION_ID
      )
    );

    expect(finish.success, finish.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toHaveLength(0);
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID &&
          action.payload.step === 'NO_RELAY_ENTERED_AQOURS_MEMBER_FOR_RED_HEART'
      )?.payload
    ).toMatchObject({
      step: 'NO_RELAY_ENTERED_AQOURS_MEMBER_FOR_RED_HEART',
      selectedOptionId: BP6_020_GAIN_HEART_OPTION_ID,
      relayEnteredAqoursMemberCardIds: [],
    });
  });

  it.each([
    { label: 'two success LIVE cards', successLiveCount: 2, expectedScore: 5, expectedBonus: 1 },
    { label: 'one success LIVE card', successLiveCount: 1, expectedScore: 4, expectedBonus: 0 },
  ])('PL!S-bp6-020-L option C scores only with $label', ({ successLiveCount, expectedScore, expectedBonus }) => {
    const live = createCardInstance(createLiveCard('PL!S-bp6-020-L', { score: 4 }), PLAYER1, `bp6-020-c-${successLiveCount}`);
    const successLives = Array.from({ length: successLiveCount }, (_, index) =>
      createCardInstance(createLiveCard(`PL!S-success-${index}`), PLAYER1, `success-${successLiveCount}-${index}`)
    );
    let game = registerCards(createGameState(`bp6-020-c-${successLiveCount}`, PLAYER1, 'P1', PLAYER2, 'P2'), [
      live,
      ...successLives,
    ]);
    game = placeLiveZone(game, [live.instanceId]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: successLives.map((card) => card.instanceId) },
    }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[PLAYER1, 4]]),
      },
      pendingAbilities: [
        createPendingAbility(S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID, live.instanceId),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, `bp6-020-c-${successLiveCount}`);

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        BP6_020_SCORE_OPTION_ID
      )
    );
    expect(finish.success, finish.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(expectedScore);
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID &&
          (action.payload.step === 'SUCCESS_LIVE_TWO_THIS_LIVE_SCORE' ||
            action.payload.step === 'NO_SUCCESS_LIVE_TWO')
      )?.payload
    ).toMatchObject({
      successLiveCount,
      scoreBonus: expectedBonus,
    });
    if (expectedBonus > 0) {
      expect(session.state?.liveResolution.liveModifiers).toContainEqual({
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: live.instanceId,
        sourceCardId: live.instanceId,
        abilityId: S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
      });
    } else {
      expect(session.state?.liveResolution.liveModifiers).toHaveLength(0);
    }
  });

  it('PL!S-bp6-020-L continues ordered pending resolution after its choice resolves', () => {
    const live = createCardInstance(createLiveCard('PL!S-bp6-020-L'), PLAYER1, 'bp6-020-ordered-live');
    const targetMember = createCardInstance(createMemberCard('PL!S-bp3-025-target', { blade: 6 }), PLAYER1, 'ordered-target');
    let game = registerCards(createGameState('bp6-020-ordered', PLAYER1, 'P1', PLAYER2, 'P2'), [
      live,
      targetMember,
    ]);
    game = placeLiveZone(game, [live.instanceId]);
    game = placeStageMembers(game, [{ cardId: targetMember.instanceId, slot: SlotPosition.CENTER }]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID, live.instanceId),
        createPendingAbility(
          S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID,
          live.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-020-ordered');

    const order = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, undefined, null, true)
    );
    expect(order.success, order.error).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID
    );

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        BP6_020_GRANT_DRAW_OPTION_ID
      )
    );
    expect(finish.success, finish.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMember.instanceId]);
  });
});
