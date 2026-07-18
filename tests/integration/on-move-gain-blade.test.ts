import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  HS_BP5_014_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
  SP_BP7_014_AUTO_ON_MOVE_GAIN_TWO_BLADE_ABILITY_ID,
  SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
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

interface OnMoveBladeCase {
  readonly cardCode: string;
  readonly name: string;
  readonly unitName: string;
  readonly abilityId: string;
  readonly amount: number;
}

const ON_MOVE_BLADE_CASES: readonly OnMoveBladeCase[] = [
  {
    cardCode: 'PL!SP-sd2-011-SD2',
    name: '鬼塚冬毬',
    unitName: '5yncri5e!',
    abilityId: SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
    amount: 1,
  },
  {
    cardCode: 'PL!HS-bp5-014-N',
    name: '安養寺 姫芽',
    unitName: 'みらくらぱーく！',
    abilityId: HS_BP5_014_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
    amount: 1,
  },
  {
    cardCode: 'PL!SP-bp7-014-N',
    name: '岚千砂都',
    unitName: 'CatChu!',
    abilityId: SP_BP7_014_AUTO_ON_MOVE_GAIN_TWO_BLADE_ABILITY_ID,
    amount: 2,
  },
];

function createOnMoveBladeMember(testCase: OnMoveBladeCase): MemberCardData {
  return {
    cardCode: testCase.cardCode,
    name: testCase.name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ', 'Liella!'],
    unitName: testCase.unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupState(testCase: OnMoveBladeCase = ON_MOVE_BLADE_CASES[0]): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly other: ReturnType<typeof createCardInstance>;
  readonly testCase: OnMoveBladeCase;
} {
  const source = createCardInstance(
    createOnMoveBladeMember(testCase),
    PLAYER1,
    'blade-source'
  );
  const other = createCardInstance(createMember('PL!SP-test-member'), PLAYER1, 'other-member');
  let game = createGameState('on-move-gain-blade', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.RIGHT,
      other.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));

  return { game, source, other, testCase };
}

function resolveMove(options: {
  readonly game: GameState;
  readonly cardId: string;
  readonly toSlot: SlotPosition;
  readonly triggerPlayerId?: string;
}): GameState {
  const moveResult = moveMemberBetweenSlots(
    options.game,
    PLAYER1,
    options.cardId,
    options.toSlot
  );
  expect(moveResult).not.toBeNull();
  let movedState = moveResult!.gameState;
  if (options.triggerPlayerId) {
    movedState = {
      ...movedState,
      eventLog: movedState.eventLog.map((entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
        entry.event.cardInstanceId === options.cardId
          ? {
              ...entry,
              event: {
                ...entry.event,
                triggerPlayerId: options.triggerPlayerId,
              },
            }
          : entry
      ),
    };
  }

  const result = new GameService().executeCheckTiming(movedState, [
    TriggerCondition.ON_MEMBER_SLOT_MOVED,
  ]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function bladeModifiers(game: GameState, abilityId = SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === abilityId
  );
}

describe('on-move BLADE shared workflow', () => {
  function setupPendingPair(bothNew = false): GameState {
    const firstCase = ON_MOVE_BLADE_CASES[2]!;
    const secondCase = bothNew ? ON_MOVE_BLADE_CASES[2]! : ON_MOVE_BLADE_CASES[0]!;
    const first = createCardInstance(createOnMoveBladeMember(firstCase), PLAYER1, 'pair-first');
    const second = createCardInstance(createOnMoveBladeMember(secondCase), PLAYER1, 'pair-second');
    let game = registerCards(
      createGameState('on-move-blade-pending-pair', PLAYER1, 'P1', PLAYER2, 'P2'),
      [first, second]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    const makePending = (
      id: string,
      sourceCardId: string,
      abilityId: string,
      sourceSlot: SlotPosition
    ): PendingAbilityState => ({
      id,
      abilityId,
      sourceCardId,
      controllerId: PLAYER1,
      timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      eventIds: [`event-${id}`],
      sourceSlot,
    });
    return {
      ...game,
      pendingAbilities: [
        makePending(
          'pair-new',
          first.instanceId,
          SP_BP7_014_AUTO_ON_MOVE_GAIN_TWO_BLADE_ABILITY_ID,
          SlotPosition.LEFT
        ),
        makePending(
          'pair-old',
          second.instanceId,
          secondCase.abilityId,
          SlotPosition.RIGHT
        ),
      ],
    };
  }

  it.each(ON_MOVE_BLADE_CASES)(
    'gains the configured BLADE amount for the source member after $cardCode moves',
    (testCase) => {
      const { game, source } = setupState(testCase);
      const state = resolveMove({
        game,
        cardId: source.instanceId,
        toSlot: SlotPosition.CENTER,
      });

      expect(state.pendingAbilities).toEqual([]);
      expect(bladeModifiers(state, testCase.abilityId)).toEqual([
        {
          kind: 'BLADE',
          playerId: PLAYER1,
          sourceCardId: source.instanceId,
          abilityId: testCase.abilityId,
          countDelta: testCase.amount,
        },
      ]);
    }
  );

  it('preserves PL!SP-sd2-011 Tomari behavior', () => {
    const { game, source, testCase } = setupState(ON_MOVE_BLADE_CASES[0]);
    const state = resolveMove({
      game,
      cardId: source.instanceId,
      toSlot: SlotPosition.CENTER,
    });

    expect(bladeModifiers(state, testCase.abilityId)).toEqual([
      {
        kind: 'BLADE',
        playerId: PLAYER1,
        sourceCardId: source.instanceId,
        abilityId: testCase.abilityId,
        countDelta: 1,
      },
    ]);
  });

  it('does not gain BLADE twice in the same turn', () => {
    const { game, source } = setupState();
    const firstState = resolveMove({
      game,
      cardId: source.instanceId,
      toSlot: SlotPosition.CENTER,
    });
    const secondState = resolveMove({
      game: firstState,
      cardId: source.instanceId,
      toSlot: SlotPosition.LEFT,
    });

    expect(bladeModifiers(secondState)).toHaveLength(1);
    expect(
      secondState.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
  });

  it('also triggers when the movement event is marked as caused by the opponent', () => {
    const { game, source } = setupState();
    const state = resolveMove({
      game,
      cardId: source.instanceId,
      toSlot: SlotPosition.CENTER,
      triggerPlayerId: PLAYER2,
    });

    expect(bladeModifiers(state)).toEqual([
      expect.objectContaining({
        sourceCardId: source.instanceId,
        countDelta: 1,
      }),
    ]);
  });

  it('does not trigger when another member moves', () => {
    const { game, other } = setupState();
    const state = resolveMove({
      game,
      cardId: other.instanceId,
      toSlot: SlotPosition.CENTER,
    });

    expect(bladeModifiers(state)).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('manual pending selection opens one confirmation before resolving the chosen AUTO', () => {
    const order = resolvePendingCardEffects(setupPendingPair()).gameState;
    const confirmation = confirmActiveEffectStep(
      order,
      PLAYER1,
      order.activeEffect!.id,
      undefined,
      undefined,
      false,
      'pair-new'
    );
    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(bladeModifiers(confirmation, SP_BP7_014_AUTO_ON_MOVE_GAIN_TWO_BLADE_ABILITY_ID)).toEqual(
      []
    );

    const resolved = confirmActiveEffectStep(
      confirmation,
      PLAYER1,
      confirmation.activeEffect!.id
    );
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(bladeModifiers(resolved, SP_BP7_014_AUTO_ON_MOVE_GAIN_TWO_BLADE_ABILITY_ID)).toHaveLength(
      1
    );
  });

  it('ordered batch resolves both fixed AUTO abilities without extra confirmation windows', () => {
    const order = resolvePendingCardEffects(setupPendingPair()).gameState;
    const resolved = confirmActiveEffectStep(
      order,
      PLAYER1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(bladeModifiers(resolved, SP_BP7_014_AUTO_ON_MOVE_GAIN_TWO_BLADE_ABILITY_ID)).toHaveLength(
      1
    );
    expect(bladeModifiers(resolved, SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID)).toHaveLength(1);
  });

  it('tracks the turn-once limit independently for two Chisato source instances', () => {
    const order = resolvePendingCardEffects(setupPendingPair(true)).gameState;
    const resolved = confirmActiveEffectStep(
      order,
      PLAYER1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    const modifiers = bladeModifiers(
      resolved,
      SP_BP7_014_AUTO_ON_MOVE_GAIN_TWO_BLADE_ABILITY_ID
    );
    expect(modifiers).toHaveLength(2);
    expect(new Set(modifiers.map((modifier) => modifier.sourceCardId)).size).toBe(2);
  });

  it.each(ON_MOVE_BLADE_CASES)(
    'consumes stale $cardCode pending as an audited no-op and continues',
    (testCase) => {
      const { game, source } = setupState(testCase);
      const pending: PendingAbilityState = {
        id: `stale-${testCase.cardCode}`,
        abilityId: testCase.abilityId,
        sourceCardId: source.instanceId,
        controllerId: PLAYER1,
        timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
        eventIds: ['stale-move-event'],
        sourceSlot: SlotPosition.LEFT,
        metadata: { fromSlot: SlotPosition.LEFT, toSlot: SlotPosition.CENTER },
      };
      const staleState = updatePlayer(
        { ...game, pendingAbilities: [pending] },
        PLAYER1,
        (player) => ({
          ...player,
          memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        })
      );

      const resolved = resolvePendingCardEffects(staleState).gameState;

      expect(resolved.pendingAbilities).toEqual([]);
      expect(bladeModifiers(resolved, testCase.abilityId)).toEqual([]);
      expect(
        resolved.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === testCase.abilityId &&
            action.payload.step === 'NO_OP_SOURCE_MEMBER_UNAVAILABLE' &&
            action.payload.bladeBonus === undefined
        )
      ).toBe(true);
    }
  );

  it('consumes the pending when the BLADE helper rejects an invalid source instance', () => {
    const testCase = ON_MOVE_BLADE_CASES[2]!;
    const { game, source } = setupState(testCase);
    const pending: PendingAbilityState = {
      id: 'invalid-helper-source',
      abilityId: testCase.abilityId,
      sourceCardId: source.instanceId,
      controllerId: PLAYER1,
      timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      eventIds: ['invalid-helper-source-event'],
      sourceSlot: SlotPosition.LEFT,
    };
    const cardRegistry = new Map(game.cardRegistry);
    cardRegistry.delete(source.instanceId);

    const resolved = resolvePendingCardEffects({
      ...game,
      cardRegistry,
      pendingAbilities: [pending],
    }).gameState;

    expect(resolved.pendingAbilities).toEqual([]);
    expect(bladeModifiers(resolved, testCase.abilityId)).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.payload.abilityId === testCase.abilityId &&
          action.payload.step === 'NO_OP_SOURCE_MEMBER_UNAVAILABLE' &&
          action.payload.bladeBonus === undefined
      )
    ).toBe(true);
  });
});
