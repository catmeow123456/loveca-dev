import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import {
  SP_BP4_017_LIVE_START_LEFT_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
  SP_BP4_020_LIVE_START_RIGHT_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

interface MovedSideBladeCase {
  readonly cardCode: string;
  readonly name: string;
  readonly abilityId: string;
  readonly requiredSlot: SlotPosition;
}

const MOVED_SIDE_BLADE_CASES: readonly MovedSideBladeCase[] = [
  {
    cardCode: 'PL!SP-bp4-017-N',
    name: '桜小路きな子',
    abilityId: SP_BP4_017_LIVE_START_LEFT_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
    requiredSlot: SlotPosition.LEFT,
  },
  {
    cardCode: 'PL!SP-bp4-020-N',
    name: '鬼塚夏美',
    abilityId: SP_BP4_020_LIVE_START_RIGHT_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
    requiredSlot: SlotPosition.RIGHT,
  },
];

function createMember(testCase: MovedSideBladeCase): MemberCardData {
  return {
    cardCode: testCase.cardCode,
    name: testCase.name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function setupState(options: {
  readonly testCase: MovedSideBladeCase;
  readonly slot: SlotPosition;
  readonly movedThisTurn?: boolean;
  readonly eventLogMovedOnly?: boolean;
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(
    createMember(options.testCase),
    PLAYER1,
    'moved-side-source'
  );
  let game = createGameState('sp-bp4-moved-side-blade', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    positionMovedThisTurn: options.movedThisTurn ? [source.instanceId] : [],
    memberSlots: placeCardInSlot(player.memberSlots, options.slot, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  if (options.eventLogMovedOnly) {
    game = {
      ...game,
      eventLog: [
        ...game.eventLog,
        {
          id: 'stale-member-slot-moved-event',
          sequence: game.eventLog.length + 1,
          timestamp: Date.now(),
          event: {
            eventId: 'stale-member-slot-moved-event',
            eventType: TriggerCondition.ON_MEMBER_SLOT_MOVED,
            triggerPlayerId: PLAYER1,
            cardInstanceId: source.instanceId,
            controllerId: PLAYER1,
            fromSlot: SlotPosition.CENTER,
            toSlot: options.slot,
          },
        },
      ],
    };
  }

  return { game, source };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return confirmIfConfirmOnly(result.gameState, PLAYER1);
}

function movedSideBladeModifiers(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === abilityId
  );
}

describe('PL!SP-bp4-017/020 moved-side BLADE workflow', () => {
  it.each(MOVED_SIDE_BLADE_CASES)(
    'gains BLADE +2 for $cardCode in the correct side slot when positionMovedThisTurn contains source',
    (testCase) => {
      const { game, source } = setupState({
        testCase,
        slot: testCase.requiredSlot,
        movedThisTurn: true,
      });
      const state = resolveLiveStart(game);

      expect(movedSideBladeModifiers(state, testCase.abilityId)).toEqual([
        {
          kind: 'BLADE',
          playerId: PLAYER1,
          sourceCardId: source.instanceId,
          abilityId: testCase.abilityId,
          countDelta: 2,
        },
      ]);
      expect(
        state.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === testCase.abilityId &&
            action.payload.movedThisTurn === true &&
            action.payload.conditionMet === true &&
            action.payload.bladeBonus === 2
        )
      ).toBe(true);
    }
  );

  it('consumes pending and records a no-bonus payload when the source did not move this turn', () => {
    const testCase = MOVED_SIDE_BLADE_CASES[0];
    const { game } = setupState({
      testCase,
      slot: testCase.requiredSlot,
      movedThisTurn: false,
    });
    const state = resolveLiveStart(game);

    expect(movedSideBladeModifiers(state, testCase.abilityId)).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === testCase.abilityId &&
          action.payload.movedThisTurn === false &&
          action.payload.conditionMet === false &&
          action.payload.bladeBonus === 0
      )
    ).toBe(true);
  });

  it('does not enqueue when the source is in the wrong side slot', () => {
    const testCase = MOVED_SIDE_BLADE_CASES[0];
    const { game } = setupState({
      testCase,
      slot: SlotPosition.RIGHT,
      movedThisTurn: true,
    });
    const state = resolveLiveStart(game);

    expect(movedSideBladeModifiers(state, testCase.abilityId)).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === testCase.abilityId
      )
    ).toBe(false);
  });

  it('does not infer movement from eventLog when positionMovedThisTurn is empty', () => {
    const testCase = MOVED_SIDE_BLADE_CASES[1];
    const { game } = setupState({
      testCase,
      slot: testCase.requiredSlot,
      movedThisTurn: false,
      eventLogMovedOnly: true,
    });
    const state = resolveLiveStart(game);

    expect(movedSideBladeModifiers(state, testCase.abilityId)).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === testCase.abilityId &&
          action.payload.movedThisTurn === false &&
          action.payload.conditionMet === false
      )
    ).toBe(true);
  });
});
