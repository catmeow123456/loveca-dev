import { describe, expect, it } from 'vitest';
import type {
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
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
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  S_BP5_006_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  S_BP6_005_ON_ENTER_LOOK_TOP_THREE_COLOR_MEMBER_ABILITY_ID,
  S_BP6_008_ACTIVATED_PLAY_AQOURS_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
  S_BP6_010_LIVE_START_RED_REQUIREMENT_GAIN_RED_HEART_ABILITY_ID,
  S_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID,
  S_SD1_007_ACTIVATED_DISCARD_RECOVER_SCORE_AQOURS_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupName?: string;
    readonly hearts?: readonly HeartColor[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupName: options.groupName ?? 'Aqours',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: (options.hearts ?? [HeartColor.RED]).map((color) => createHeartIcon(color, 1)),
  };
}

function createLiveCard(
  cardCode: string,
  options: {
    readonly groupName?: string;
    readonly redRequirement?: number;
    readonly hasScore?: boolean;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: options.groupName ?? 'Aqours',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({
      [HeartColor.RED]: options.redRequirement ?? 1,
    }),
    bladeHearts: options.hasScore ? [{ effect: BladeHeartEffect.SCORE }] : [],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  triggerCondition: TriggerCondition,
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: triggerCondition,
    eventIds: [`${abilityId}:event`],
    sourceSlot,
  };
}

function forceMainPhase(game: GameState): GameState {
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}

function createSessionFromGame(game: GameState, gameId = 's-future-water-batch1') {
  const session = createGameSession();
  session.createGame(gameId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

describe('未来水卡组 执行批次1 focused workflows', () => {
  it('PL!S-bp6-005 reveals one red-green-blue member to hand and moves the rest to waiting room', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-005-P', { name: '渡辺 曜', cost: 2 }),
      PLAYER1,
      's-bp6-005-source'
    );
    const target = createCardInstance(
      createMemberCard('PL!S-test-rgb-member', {
        hearts: [HeartColor.RED, HeartColor.GREEN, HeartColor.BLUE],
      }),
      PLAYER1,
      's-bp6-005-target'
    );
    const miss = createCardInstance(
      createMemberCard('PL!S-test-red-green-member', {
        hearts: [HeartColor.RED, HeartColor.GREEN],
      }),
      PLAYER1,
      's-bp6-005-miss'
    );
    let game = registerCards(createGameState('s-bp6-005', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      target,
      miss,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: [target.instanceId, miss.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_005_ON_ENTER_LOOK_TOP_THREE_COLOR_MEMBER_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);

    const reveal = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );
    expect(reveal.success, reveal.error).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(target.instanceId);

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([miss.instanceId]);
  });

  it('PL!S-bp5-006 only waits source, discards, and inspects after the optional cost is chosen', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp5-006-R', { name: '津島善子', cost: 4 }),
      PLAYER1,
      's-bp5-006-source'
    );
    const discard = createCardInstance(createMemberCard('PL!S-hand-cost'), PLAYER1, 'hand-cost');
    const target = createCardInstance(
      createMemberCard('PL!S-high-cost-aqours', { cost: 9 }),
      PLAYER1,
      'high-cost-aqours'
    );
    const lowCost = createCardInstance(
      createMemberCard('PL!S-low-cost-aqours', { cost: 8 }),
      PLAYER1,
      'low-cost-aqours'
    );
    let game = registerCards(createGameState('s-bp5-006', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      discard,
      target,
      lowCost,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [target.instanceId, lowCost.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP5_006_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    };
    const session = createSessionFromGame(
      resolvePendingCardEffects(game).gameState,
      's-bp5-006-pay'
    );

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);

    const cost = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );
    expect(cost.success, cost.error).toBe(true);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);

    const reveal = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );
    expect(reveal.success, reveal.error).toBe(true);
    const finish = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discard.instanceId,
      lowCost.instanceId,
    ]);
  });

  it('PL!S-bp5-006 decline consumes pending without paying cost or inspecting deck', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp5-006-R', { name: '津島善子', cost: 4 }),
      PLAYER1,
      's-bp5-006-decline-source'
    );
    const hand = createCardInstance(createMemberCard('PL!S-hand'), PLAYER1, 'decline-hand');
    const top = createCardInstance(createMemberCard('PL!S-top', { cost: 9 }), PLAYER1, 'decline-top');
    let game = registerCards(createGameState('s-bp5-006-decline', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      hand,
      top,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [hand.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [top.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP5_006_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    };
    const session = createSessionFromGame(
      resolvePendingCardEffects(game).gameState,
      's-bp5-006-decline'
    );

    const decline = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(decline.success, decline.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([hand.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([top.instanceId]);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('draw-bottom shared ability draws one and places a private hand card on deck bottom without waiting-room events', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp5-014-N', { name: '渡辺 曜' }),
      PLAYER1,
      'draw-bottom-source'
    );
    const hand = createCardInstance(createMemberCard('PL!S-hand-bottom'), PLAYER1, 'hand-bottom');
    const drawn = createCardInstance(createMemberCard('PL!S-drawn'), PLAYER1, 'drawn-card');
    let game = registerCards(createGameState('draw-bottom', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      hand,
      drawn,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [hand.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [drawn.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'draw-bottom');

    expect(session.state?.activeEffect?.selectableCardVisibility).toBe('AWAITING_PLAYER_ONLY');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      hand.instanceId,
      drawn.instanceId,
    ]);

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, hand.instanceId)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([drawn.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([hand.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      session.state?.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toBe(false);
  });

  it('PL!S-bp6-010 gives source member red Heart only when own live red requirement total is at least four', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-010-N', { name: '高海千歌' }),
      PLAYER1,
      's-bp6-010-source'
    );
    const live = createCardInstance(
      createLiveCard('PL!S-live-red-four', { redRequirement: 4 }),
      PLAYER1,
      'red-four-live'
    );
    let game = registerCards(createGameState('s-bp6-010', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      live,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: [live.instanceId],
        cardStates: new Map([
          [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
        ]),
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_010_LIVE_START_RED_REQUIREMENT_GAIN_RED_HEART_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 's-bp6-010');

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [createHeartIcon(HeartColor.RED, 1)],
      sourceCardId: source.instanceId,
      abilityId: S_BP6_010_LIVE_START_RED_REQUIREMENT_GAIN_RED_HEART_ABILITY_ID,
    });
  });

  it('PL!S-bp6-010 resolves with no modifier when red requirement total is below four', () => {
    const source = createCardInstance(createMemberCard('PL!S-bp6-010-N'), PLAYER1, 'bp6-010-low');
    const live = createCardInstance(
      createLiveCard('PL!S-live-red-three', { redRequirement: 3 }),
      PLAYER1,
      'red-three-live'
    );
    let game = registerCards(createGameState('s-bp6-010-low', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      live,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: [live.instanceId],
        cardStates: new Map([
          [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
        ]),
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_010_LIVE_START_RED_REQUIREMENT_GAIN_RED_HEART_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };
    const session = createSessionFromGame(
      resolvePendingCardEffects(game).gameState,
      's-bp6-010-low'
    );

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('PL!S-sd1-007 discards two as cost and recovers only SCORE Aqours LIVE', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-sd1-007-SD', { name: '国木田花丸', cost: 11 }),
      PLAYER1,
      's-sd1-007-source'
    );
    const cost1 = createCardInstance(createMemberCard('PL!S-cost-1'), PLAYER1, 'cost-1');
    const cost2 = createCardInstance(createMemberCard('PL!S-cost-2'), PLAYER1, 'cost-2');
    const scoreLive = createCardInstance(
      createLiveCard('PL!S-score-live', { hasScore: true }),
      PLAYER1,
      'score-live'
    );
    const noScoreLive = createCardInstance(createLiveCard('PL!S-no-score-live'), PLAYER1, 'no-score');
    const otherGroupScoreLive = createCardInstance(
      createLiveCard('PL!SP-score-live', { groupName: 'Liella!', hasScore: true }),
      PLAYER1,
      'other-score-live'
    );
    let game = registerCards(createGameState('s-sd1-007', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      cost1,
      cost2,
      scoreLive,
      noScoreLive,
      otherGroupScoreLive,
    ]);
    game = forceMainPhase(
      updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: [cost1.instanceId, cost2.instanceId] },
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: [scoreLive.instanceId, noScoreLive.instanceId, otherGroupScoreLive.instanceId],
        },
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      }))
    );
    const session = createSessionFromGame(game, 's-sd1-007');

    const activate = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        source.instanceId,
        S_SD1_007_ACTIVATED_DISCARD_RECOVER_SCORE_AQOURS_LIVE_ABILITY_ID
      )
    );
    expect(activate.success, activate.error).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      cost1.instanceId,
      cost2.instanceId,
    ]);

    const pay = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [cost1.instanceId, cost2.instanceId]
      )
    );
    expect(pay.success, pay.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([cost1.instanceId, cost2.instanceId])
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([scoreLive.instanceId]);

    const recover = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, scoreLive.instanceId)
    );
    expect(recover.success, recover.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([scoreLive.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([cost1.instanceId, cost2.instanceId, noScoreLive.instanceId])
    );
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(scoreLive.instanceId);
  });

  it('PL!S-bp6-008 pays two energy, sends self to waiting room, and plays an Aqours member to the original slot', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-008-P', { name: '小原鞠莉', cost: 15 }),
      PLAYER1,
      's-bp6-008-source'
    );
    const target = createCardInstance(
      createMemberCard('PL!S-target-member', { cost: 17 }),
      PLAYER1,
      's-bp6-008-target'
    );
    const tooHigh = createCardInstance(
      createMemberCard('PL!S-too-high', { cost: 18 }),
      PLAYER1,
      's-bp6-008-too-high'
    );
    const energyCards = [createEnergyCard('E-1'), createEnergyCard('E-2')].map((card, index) =>
      createCardInstance(card, PLAYER1, `energy-${index}`)
    );
    let game = registerCards(createGameState('s-bp6-008', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      target,
      tooHigh,
      ...energyCards,
    ]);
    game = forceMainPhase(
      updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: [target.instanceId, tooHigh.instanceId] },
        energyZone: {
          ...player.energyZone,
          cardIds: energyCards.map((card) => card.instanceId),
          cardStates: new Map(
            energyCards.map((card) => [
              card.instanceId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
          ),
        },
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      }))
    );
    const session = createSessionFromGame(game, 's-bp6-008');

    const activate = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        source.instanceId,
        S_BP6_008_ACTIVATED_PLAY_AQOURS_MEMBER_TO_SOURCE_SLOT_ABILITY_ID
      )
    );
    expect(activate.success, activate.error).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      target.instanceId,
      source.instanceId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(tooHigh.instanceId);
    for (const energy of energyCards) {
      expect(session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(target.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(target.instanceId);
  });

  it('PL!S-bp6-008 cannot start without enough active energy', () => {
    const source = createCardInstance(createMemberCard('PL!S-bp6-008-P'), PLAYER1, 'bp6-008-no-energy');
    const target = createCardInstance(createMemberCard('PL!S-target', { cost: 17 }), PLAYER1, 'target');
    const energy = createCardInstance(createEnergyCard('E-1'), PLAYER1, 'only-energy');
    let game = registerCards(createGameState('s-bp6-008-no-energy', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      target,
      energy,
    ]);
    game = forceMainPhase(
      updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: [target.instanceId] },
        energyZone: {
          ...player.energyZone,
          cardIds: [energy.instanceId],
          cardStates: new Map([
            [energy.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          ]),
        },
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      }))
    );
    const session = createSessionFromGame(game, 's-bp6-008-no-energy');

    const activate = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        source.instanceId,
        S_BP6_008_ACTIVATED_PLAY_AQOURS_MEMBER_TO_SOURCE_SLOT_ABILITY_ID
      )
    );
    expect(activate.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(source.instanceId);
  });
});
