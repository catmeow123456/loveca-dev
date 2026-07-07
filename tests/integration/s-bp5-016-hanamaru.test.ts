import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { S_BP5_016_LIVE_START_HIGHER_COST_THAN_ALL_OPPONENT_STAGE_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
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

function createMember(cardCode: string, name: string, cost: number): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function runLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function setupHanamaruState(options: {
  readonly sources?: readonly ReturnType<typeof createCardInstance>[];
  readonly ownOthers?: readonly ReturnType<typeof createCardInstance>[];
  readonly opponentMembers?: readonly ReturnType<typeof createCardInstance>[];
} = {}): {
  readonly game: GameState;
  readonly sources: readonly ReturnType<typeof createCardInstance>[];
} {
  const sources =
    options.sources ??
    [
      createCardInstance(
        createMember('PL!S-bp5-016-N', '国木田花丸', 9),
        PLAYER1,
        'hanamaru-source'
      ),
    ];
  const ownOthers = options.ownOthers ?? [];
  const opponentMembers = options.opponentMembers ?? [];
  let game = createGameState('s-bp5-016-hanamaru', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...sources, ...ownOthers, ...opponentMembers]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const ownCards = [...sources, ...ownOthers];
    const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];
    let memberSlots = player.memberSlots;
    for (const [index, card] of ownCards.entries()) {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];
    let memberSlots = player.memberSlots;
    for (const [index, card] of opponentMembers.entries()) {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
  return { game, sources };
}

describe('PL!S-bp5-016-N Hanamaru live-start workflow', () => {
  it('opens a realtime confirm-only bridge and gains BLADE when own stage has a higher-cost member', () => {
    const highOwn = createCardInstance(
      createMember('PL!S-test-high-own', 'High Own', 11),
      PLAYER1,
      'hanamaru-high-own'
    );
    const opponentLow = createCardInstance(
      createMember('PL!S-test-low-opponent', 'Low Opponent', 10),
      PLAYER2,
      'hanamaru-opponent-low'
    );
    const { game, sources } = setupHanamaruState({
      ownOthers: [highOwn],
      opponentMembers: [opponentLow],
    });

    const preview = runLiveStart(game);

    expect(preview.activeEffect).toMatchObject({
      abilityId: S_BP5_016_LIVE_START_HIGHER_COST_THAN_ALL_OPPONENT_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
      sourceCardId: sources[0]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('己方最高费用：11');
    expect(preview.activeEffect?.effectText).toContain('对方舞台成员费用：10');
    expect(preview.activeEffect?.effectText).toContain('条件满足');
    expect(preview.activeEffect?.effectText).toContain('实际获得[BLADE][BLADE]');
    expect(getMemberEffectiveBladeCount(preview, PLAYER1, sources[0]!.instanceId)).toBe(1);

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, sources[0]!.instanceId)).toBe(3);
  });

  it('treats an empty opponent stage as satisfied when the source remains on own stage', () => {
    const { game, sources } = setupHanamaruState();
    const preview = runLiveStart(game);
    expect(preview.activeEffect?.effectText).toContain('对方舞台成员费用：无');
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, sources[0]!.instanceId)).toBe(3);
  });

  it('does not gain BLADE when the highest own cost only ties the opponent member cost', () => {
    const opponentEqual = createCardInstance(
      createMember('PL!S-test-equal-opponent', 'Equal Opponent', 9),
      PLAYER2,
      'hanamaru-opponent-equal'
    );
    const { game, sources } = setupHanamaruState({ opponentMembers: [opponentEqual] });
    const preview = runLiveStart(game);
    expect(preview.activeEffect?.effectText).toContain('条件未满足');
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, sources[0]!.instanceId)).toBe(1);
  });

  it('rechecks source liveness after the confirm-only bridge before applying BLADE', () => {
    const opponentLow = createCardInstance(
      createMember('PL!S-test-low-opponent', 'Low Opponent', 4),
      PLAYER2,
      'hanamaru-opponent-low-source-leaves'
    );
    const { game, sources } = setupHanamaruState({ opponentMembers: [opponentLow] });
    const preview = runLiveStart(game);
    const sourceLeft = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));

    const resolved = confirmActiveEffectStep(sourceLeft, PLAYER1, sourceLeft.activeEffect!.id);

    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, sources[0]!.instanceId)).toBe(1);
    expect(
      resolved.actionHistory
        .filter(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId ===
              S_BP5_016_LIVE_START_HIGHER_COST_THAN_ALL_OPPONENT_STAGE_GAIN_TWO_BLADE_ABILITY_ID
        )
        .at(-1)?.payload
    ).toMatchObject({
      sourceOnStage: false,
      conditionMet: false,
      bladeBonus: 0,
    });
  });

  it('auto-resolves multiple pending Hanamaru abilities in order without confirm-only bridges', () => {
    const sources = [
      createCardInstance(
        createMember('PL!S-bp5-016-N', '国木田花丸 A', 9),
        PLAYER1,
        'hanamaru-source-a'
      ),
      createCardInstance(
        createMember('PL!S-bp5-016-N', '国木田花丸 B', 9),
        PLAYER1,
        'hanamaru-source-b'
      ),
    ];
    const opponentLow = createCardInstance(
      createMember('PL!S-test-low-opponent', 'Low Opponent', 4),
      PLAYER2,
      'hanamaru-opponent-low-order'
    );
    const { game } = setupHanamaruState({ sources, opponentMembers: [opponentLow] });
    const orderSelection = runLiveStart(game);

    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, sources[0]!.instanceId)).toBe(3);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, sources[1]!.instanceId)).toBe(3);
  });

  it('shows a confirm-only bridge when manually selecting one of multiple pending Hanamaru abilities', () => {
    const sources = [
      createCardInstance(
        createMember('PL!S-bp5-016-N', '国木田花丸 A', 9),
        PLAYER1,
        'hanamaru-manual-source-a'
      ),
      createCardInstance(
        createMember('PL!S-bp5-016-N', '国木田花丸 B', 9),
        PLAYER1,
        'hanamaru-manual-source-b'
      ),
    ];
    const opponentLow = createCardInstance(
      createMember('PL!S-test-low-opponent', 'Low Opponent', 4),
      PLAYER2,
      'hanamaru-opponent-low-manual'
    );
    const { game } = setupHanamaruState({ sources, opponentMembers: [opponentLow] });
    const orderSelection = runLiveStart(game);

    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      sources[1]!.instanceId
    );

    expect(preview.activeEffect).toMatchObject({
      sourceCardId: sources[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(getMemberEffectiveBladeCount(preview, PLAYER1, sources[1]!.instanceId)).toBe(1);
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, sources[1]!.instanceId)).toBe(3);
  });
});
