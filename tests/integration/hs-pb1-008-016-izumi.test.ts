import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  HS_PB1_008_ON_ENTER_WAIT_ALL_LOW_ORIGINAL_BLADE_MEMBERS_ABILITY_ID,
  HS_PB1_016_ON_ENTER_TARGET_PURPLE_HEART_MEMBER_GAIN_PURPLE_HEART_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  addHeartLiveModifierForMember,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(options: {
  readonly cardCode: string;
  readonly name?: string;
  readonly blade?: number;
  readonly hearts?: readonly { readonly color: HeartColor; readonly count: number }[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name ?? options.cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'EdelNote',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: options.blade ?? 1,
    hearts: (options.hearts ?? [{ color: HeartColor.BLUE, count: 1 }]).map((heart) =>
      createHeartIcon(heart.color, heart.count)
    ),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function pendingAbility(
  id: string,
  abilityId: string,
  sourceCardId: string,
  controllerId = PLAYER1
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event-${id}`],
  };
}

function memberOrientation(
  game: GameState,
  playerIndex: number,
  cardId: string
): OrientationState | undefined {
  return game.players[playerIndex].memberSlots.cardStates.get(cardId)?.orientation;
}

function memberStateChangedEvents(game: GameState, cardId: string): number {
  return game.eventLog.filter(
    (entry) =>
      entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
      entry.event.cardInstanceId === cardId
  ).length;
}

describe('PL!HS-pb1-008 Izumi on-enter and continuous effects', () => {
  it('waits both players low original BLADE members, skips already waiting events, and continues pending', () => {
    const source = createCardInstance(
      createMember({ cardCode: 'PL!HS-pb1-008-R', name: '桂城 泉', blade: 3 }),
      PLAYER1,
      'pb1-008-source'
    );
    const ownAlreadyWaiting = createCardInstance(
      createMember({ cardCode: 'PL!HS-pb1-008-own-waiting', blade: 2 }),
      PLAYER1,
      'own-waiting'
    );
    const ownHighBlade = createCardInstance(
      createMember({ cardCode: 'PL!HS-pb1-008-own-high', blade: 4 }),
      PLAYER1,
      'own-high'
    );
    const opponentLowBlade = createCardInstance(
      createMember({ cardCode: 'PL!HS-pb1-008-opponent-low', blade: 1 }),
      PLAYER2,
      'opponent-low'
    );
    const opponentHighBlade = createCardInstance(
      createMember({ cardCode: 'PL!HS-pb1-008-opponent-high', blade: 5 }),
      PLAYER2,
      'opponent-high'
    );
    const drawSource = createCardInstance(
      createMember({ cardCode: 'PL!HS-pb1-008-draw-source' }),
      PLAYER1,
      'draw-source'
    );
    const drawCard = createCardInstance(
      createMember({ cardCode: 'PL!HS-pb1-008-draw-card' }),
      PLAYER1,
      'draw-card'
    );
    let game = createGameState('hs-pb1-008-on-enter', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [
      source,
      ownAlreadyWaiting,
      ownHighBlade,
      opponentLowBlade,
      opponentHighBlade,
      drawSource,
      drawCard,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
          SlotPosition.LEFT,
          ownAlreadyWaiting.instanceId,
          { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
        ),
        SlotPosition.RIGHT,
        ownHighBlade.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponentLowBlade.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        opponentHighBlade.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = {
      ...game,
      pendingAbilities: [
        pendingAbility(
          'pb1-008',
          HS_PB1_008_ON_ENTER_WAIT_ALL_LOW_ORIGINAL_BLADE_MEMBERS_ABILITY_ID,
          source.instanceId
        ),
        pendingAbility('draw-next', MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID, drawSource.instanceId),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(memberOrientation(resolved, 0, source.instanceId)).toBe(OrientationState.WAITING);
    expect(memberOrientation(resolved, 0, ownAlreadyWaiting.instanceId)).toBe(
      OrientationState.WAITING
    );
    expect(memberOrientation(resolved, 0, ownHighBlade.instanceId)).toBe(OrientationState.ACTIVE);
    expect(memberOrientation(resolved, 1, opponentLowBlade.instanceId)).toBe(
      OrientationState.WAITING
    );
    expect(memberOrientation(resolved, 1, opponentHighBlade.instanceId)).toBe(
      OrientationState.ACTIVE
    );
    expect(memberStateChangedEvents(resolved, source.instanceId)).toBe(1);
    expect(memberStateChangedEvents(resolved, ownAlreadyWaiting.instanceId)).toBe(0);
    expect(memberStateChangedEvents(resolved, opponentLowBlade.instanceId)).toBe(1);
    expect(resolved.players[0].hand.cardIds).toContain(drawCard.instanceId);
  });
});

describe('PL!HS-pb1-016 Izumi purple Heart target workflow', () => {
  function setupPb1016(options: {
    readonly targetPrintedPurple?: boolean;
    readonly targetGainsPurpleByModifier?: boolean;
    readonly includeOtherPurple?: boolean;
  }): {
    readonly game: GameState;
    readonly sourceId: string;
    readonly targetId: string;
    readonly otherId: string;
  } {
    const source = createCardInstance(
      createMember({
        cardCode: 'PL!HS-pb1-016-R',
        name: '桂城 泉',
        hearts: [{ color: HeartColor.PURPLE, count: 1 }],
      }),
      PLAYER1,
      'pb1-016-source'
    );
    const target = createCardInstance(
      createMember({
        cardCode: 'PL!HS-pb1-016-target',
        hearts: [
          {
            color: options.targetPrintedPurple ? HeartColor.PURPLE : HeartColor.BLUE,
            count: 1,
          },
        ],
      }),
      PLAYER1,
      'pb1-016-target'
    );
    const other = createCardInstance(
      createMember({
        cardCode: 'PL!HS-pb1-016-other',
        hearts: [
          {
            color: options.includeOtherPurple ? HeartColor.PURPLE : HeartColor.BLUE,
            count: 1,
          },
        ],
      }),
      PLAYER1,
      'pb1-016-other'
    );
    let game = createGameState('hs-pb1-016', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, target, other]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
          SlotPosition.LEFT,
          target.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        ),
        SlotPosition.RIGHT,
        other.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    if (options.targetGainsPurpleByModifier) {
      game = addHeartLiveModifierForMember(game, {
        playerId: PLAYER1,
        memberCardId: target.instanceId,
        sourceCardId: other.instanceId,
        abilityId: 'test:add-purple-heart',
        hearts: [{ color: HeartColor.PURPLE, count: 1 }],
      })!.gameState;
    }
    return {
      game: {
        ...game,
        pendingAbilities: [
          pendingAbility(
            'pb1-016',
            HS_PB1_016_ON_ENTER_TARGET_PURPLE_HEART_MEMBER_GAIN_PURPLE_HEART_ABILITY_ID,
            source.instanceId
          ),
        ],
      },
      sourceId: source.instanceId,
      targetId: target.instanceId,
      otherId: other.instanceId,
    };
  }

  it('selects a printed purple Heart member other than the source and writes TARGET_MEMBER modifier', () => {
    const scenario = setupPb1016({ targetPrintedPurple: true });
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.activeEffect).toMatchObject({
      abilityId: HS_PB1_016_ON_ENTER_TARGET_PURPLE_HEART_MEMBER_GAIN_PURPLE_HEART_ABILITY_ID,
      selectableCardIds: [scenario.targetId],
      selectionLabel: '选择获得[紫ハート]的成员',
    });
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.sourceId);

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.targetId
    );
    const modifier = resolved.liveResolution.liveModifiers.find(
      (candidate) =>
        candidate.kind === 'HEART' &&
        candidate.sourceCardId === scenario.sourceId &&
        candidate.abilityId ===
          HS_PB1_016_ON_ENTER_TARGET_PURPLE_HEART_MEMBER_GAIN_PURPLE_HEART_ABILITY_ID
    );

    expect(modifier).toMatchObject({
      target: 'TARGET_MEMBER',
      targetMemberCardId: scenario.targetId,
      hearts: [{ color: HeartColor.PURPLE, count: 1 }],
    });
    expect(getMemberEffectiveHeartIcons(resolved, PLAYER1, scenario.targetId)).toContainEqual({
      color: HeartColor.PURPLE,
      count: 1,
    });
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('uses effective purple Heart from modifiers for candidates', () => {
    const scenario = setupPb1016({ targetGainsPurpleByModifier: true });
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.targetId]);
  });

  it('consumes pending with no activeEffect when no other purple Heart target exists', () => {
    const scenario = setupPb1016({});
    const resolved = resolvePendingCardEffects(scenario.game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'NO_PURPLE_HEART_TARGET'
      )
    ).toBe(true);
  });

  it('rejects stale selections when the target loses effective purple Heart', () => {
    const scenario = setupPb1016({ targetGainsPurpleByModifier: true, includeOtherPurple: true });
    const started = resolvePendingCardEffects(scenario.game).gameState;
    const staleState = {
      ...started,
      liveResolution: {
        ...started.liveResolution,
        liveModifiers: [],
      },
    };

    const rejected = confirmActiveEffectStep(
      staleState,
      PLAYER1,
      staleState.activeEffect!.id,
      scenario.targetId
    );

    expect(rejected).toBe(staleState);
    expect(rejected.activeEffect).toBe(staleState.activeEffect);
    expect(rejected.pendingAbilities).toEqual([]);
  });

  it('keeps opponent active phase members waiting while energy still becomes active', () => {
    const source = createCardInstance(
      createMember({ cardCode: 'PL!HS-pb1-008-P＋', name: '桂城 泉' }),
      PLAYER2,
      'p2-pb1-008'
    );
    const p1Member = createCardInstance(
      createMember({ cardCode: 'PL!HS-pb1-016-p1-member' }),
      PLAYER1,
      'p1-member'
    );
    const p1Energy = createCardInstance(createEnergy('p1-energy'), PLAYER1, 'p1-energy');
    let game = createGameState('hs-pb1-008-active-phase', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, p1Member, p1Energy]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, p1Energy.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, p1Member.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));

    const result = new GameService().advancePhase({
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });

    expect(result.success).toBe(true);
    expect(result.gameState.players[0].memberSlots.cardStates.get(p1Member.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(result.gameState.players[0].energyZone.cardStates.get(p1Energy.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );

    const restored = new GameService().advancePhase({
      ...updatePlayer(result.gameState, PLAYER2, (player) => ({
        ...player,
        memberSlots: {
          ...player.memberSlots,
          slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
        },
      })),
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });

    expect(restored.success).toBe(true);
    expect(restored.gameState.players[0].memberSlots.cardStates.get(p1Member.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });
});
