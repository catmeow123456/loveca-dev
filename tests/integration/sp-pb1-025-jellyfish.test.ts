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
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { confirmIfConfirmOnly } from './confirm-only-pending';
import { GameService } from '../../src/application/game-service';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import {
  SP_PB1_003_ON_ENTER_ROTATE_BOTH_PLAYERS_STAGE_ABILITY_ID,
  SP_PB1_025_LIVE_START_ENTERED_OR_MOVED_FIVEYNCRISE_REQUIREMENT_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createJellyfish(cardCode = 'PL!SP-pb1-025-L'): LiveCardData {
  return {
    cardCode,
    name: 'Jellyfish',
    groupNames: ['Liella!'],
    unitName: '5yncri5e!',
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 6 }),
  };
}

function createMember(cardCode: string, name: string, unitName = '5yncri5e!'): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function setupLiveStart(
  stageMembers: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
    readonly entered?: boolean;
    readonly moved?: boolean;
  }[],
  offStageMembers: readonly ReturnType<typeof createCardInstance>[] = []
): { readonly game: GameState; readonly liveId: string; readonly members: readonly ReturnType<typeof createCardInstance>[] } {
  const live = createCardInstance(createJellyfish(), PLAYER1, 'jellyfish');
  const allMembers = [...stageMembers.map((entry) => entry.card), ...offStageMembers];
  let game = createGameState('sp-pb1-025-jellyfish', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...allMembers]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of stageMembers) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId);
    }
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      waitingRoom: offStageMembers.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.waitingRoom
      ),
      memberSlots,
      movedToStageThisTurn: stageMembers
        .filter((entry) => entry.entered === true)
        .map((entry) => entry.card.instanceId),
      positionMovedThisTurn: stageMembers
        .filter((entry) => entry.moved === true)
        .map((entry) => entry.card.instanceId),
    };
  });
  return { game, liveId: live.instanceId, members: allMembers };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return confirmIfConfirmOnly(result.gameState, PLAYER1);
}

function requirementReductionFor(game: GameState, liveId: string): number {
  return game.liveResolution.liveRequirementReductions.get(liveId) ?? 0;
}

function adjustedRainbowRequirement(game: GameState, liveId: string): number {
  const modifiers = game.liveResolution.liveRequirementModifiers.get(liveId) ?? [];
  return (
    applyHeartRequirementModifiers(createJellyfish().requirements, modifiers).colorRequirements.get(
      HeartColor.RAINBOW
    ) ?? 0
  );
}

describe('PL!SP-pb1-025 Jellyfish requirement reduction', () => {
  it('consumes pending without modifier when no stage member entered or moved this turn', () => {
    const member = createCardInstance(createMember('PL!SP-test-member', 'Member'), PLAYER1, 'member');
    const { game, liveId } = setupLiveStart([{ card: member, slot: SlotPosition.CENTER }]);

    const state = resolveLiveStart(game);
    expect(state.pendingAbilities).toEqual([]);
    expect(requirementReductionFor(state, liveId)).toBe(0);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('counts one entered 5yncri5e stage member and reduces required neutral Heart by 1', () => {
    const member = createCardInstance(createMember('PL!SP-test-entered', 'Entered'), PLAYER1, 'entered');
    const { game, liveId } = setupLiveStart([
      { card: member, slot: SlotPosition.CENTER, entered: true },
    ]);

    const state = resolveLiveStart(game);
    expect(requirementReductionFor(state, liveId)).toBe(1);
    expect(adjustedRainbowRequirement(state, liveId)).toBe(5);
  });

  it('counts multiple members across entered and moved records', () => {
    const entered = createCardInstance(createMember('PL!SP-test-entered', 'Entered'), PLAYER1, 'entered');
    const moved = createCardInstance(createMember('PL!SP-test-moved', 'Moved'), PLAYER1, 'moved');
    const both = createCardInstance(createMember('PL!SP-test-both', 'Both'), PLAYER1, 'both');
    const { game, liveId } = setupLiveStart([
      { card: entered, slot: SlotPosition.LEFT, entered: true },
      { card: moved, slot: SlotPosition.CENTER, moved: true },
      { card: both, slot: SlotPosition.RIGHT, entered: true, moved: true },
    ]);

    const state = resolveLiveStart(game);
    expect(requirementReductionFor(state, liveId)).toBe(3);
    expect(adjustedRainbowRequirement(state, liveId)).toBe(3);
  });

  it('does not count off-stage or non-5yncri5e members', () => {
    const offStage = createCardInstance(createMember('PL!SP-test-offstage', 'Offstage'), PLAYER1, 'offstage');
    const nonFiveyncrise = createCardInstance(
      createMember('PL!SP-test-catchu', 'CatChu Member', 'CatChu!'),
      PLAYER1,
      'cat-chu'
    );
    const target = createCardInstance(createMember('PL!SP-test-target', 'Target'), PLAYER1, 'target');
    const { game, liveId } = setupLiveStart(
      [
        { card: nonFiveyncrise, slot: SlotPosition.LEFT, moved: true },
        { card: target, slot: SlotPosition.CENTER, moved: true },
      ],
      [offStage]
    );
    const withOffStageRecord = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      movedToStageThisTurn: [...player.movedToStageThisTurn, offStage.instanceId],
      positionMovedThisTurn: [...player.positionMovedThisTurn, offStage.instanceId],
    }));

    const state = resolveLiveStart(withOffStageRecord);
    expect(requirementReductionFor(state, liveId)).toBe(1);
    expect(adjustedRainbowRequirement(state, liveId)).toBe(5);
  });

  it('counts members moved by PL!SP-pb1-003 earlier in the same turn', () => {
    const live = createCardInstance(createJellyfish('PL!SP-pb1-025-SRL'), PLAYER1, 'jellyfish');
    const source = createCardInstance(createMember('PL!SP-pb1-003-R', '嵐 千砂都'), PLAYER1, 'chisato');
    const other = createCardInstance(createMember('PL!SP-test-other', 'Other'), PLAYER1, 'other');
    let game = createGameState('sp-pb1-025-linked-regression', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [live, source, other]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, other.instanceId),
        SlotPosition.CENTER,
        source.instanceId
      ),
    }));
    const enterEvent = createEnterStageEvent(
      source.instanceId,
      ZoneType.HAND,
      SlotPosition.CENTER,
      PLAYER1,
      PLAYER1
    );
    const afterChisato = resolvePendingCardEffects(
      enqueueTriggeredCardEffects(emitGameEvent(game, enterEvent), [TriggerCondition.ON_ENTER_STAGE])
    ).gameState;
    expect(
      afterChisato.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PB1_003_ON_ENTER_ROTATE_BOTH_PLAYERS_STAGE_ABILITY_ID
      )
    ).toBe(true);

    const state = resolveLiveStart(afterChisato);
    expect(requirementReductionFor(state, live.instanceId)).toBe(2);
    expect(adjustedRainbowRequirement(state, live.instanceId)).toBe(4);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId ===
            SP_PB1_025_LIVE_START_ENTERED_OR_MOVED_FIVEYNCRISE_REQUIREMENT_ABILITY_ID &&
          modifier.sourceCardId === live.instanceId
      )
    ).toBe(true);
  });
});
