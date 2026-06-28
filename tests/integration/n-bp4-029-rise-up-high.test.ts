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
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createRiseUpHigh(): LiveCardData {
  return {
    cardCode: 'PL!N-bp4-029-L',
    name: 'Rise Up High!',
    groupName: '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMember(
  cardCode: string,
  groupName = '虹ヶ咲学園スクールアイドル同好会'
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupRiseScenario(options: {
  readonly turnCount: number;
  readonly members?: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
}): {
  readonly game: GameState;
  readonly liveId: string;
} {
  const live = createCardInstance(createRiseUpHigh(), PLAYER1, 'rise-up-high');
  const members = Object.entries(options.members ?? {}) as [
    SlotPosition,
    ReturnType<typeof createCardInstance>,
  ][];
  let game = createGameState('n-bp4-029-rise-up-high', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...members.map(([, member]) => member)]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    memberSlots: members.reduce(
      (slots, [slot, member]) =>
        placeCardInSlot(slots, slot, member.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  game = {
    ...game,
    turnCount: options.turnCount,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 1]]),
    },
  };
  return { game, liveId: live.instanceId };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID
  );
}

function bladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.abilityId ===
        PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID
  );
}

describe('PL!N-bp4-029-L Rise Up High! live-start workflow', () => {
  it('adds score and automatically grants BLADE to the only Nijigasaki stage member on turn one', () => {
    const target = createCardInstance(createMember('PL!N-target-member'), PLAYER1, 'target-member');
    const { game, liveId } = setupRiseScenario({
      turnCount: 1,
      members: { [SlotPosition.CENTER]: target },
    });

    const state = resolveLiveStart(game);

    expect(scoreModifiers(state)).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: liveId,
      sourceCardId: liveId,
      abilityId: PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(bladeModifiers(state)).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: target.instanceId,
      abilityId: PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID,
    });
    expect(state.activeEffect).toBeNull();
  });

  it('does nothing outside the first turn', () => {
    const target = createCardInstance(createMember('PL!N-target-member'), PLAYER1, 'target-member');
    const { game } = setupRiseScenario({
      turnCount: 2,
      members: { [SlotPosition.CENTER]: target },
    });

    const state = resolveLiveStart(game);

    expect(scoreModifiers(state)).toHaveLength(0);
    expect(bladeModifiers(state)).toHaveLength(0);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(1);
  });

  it('adds score only when there is no Nijigasaki stage target', () => {
    const aqours = createCardInstance(
      createMember('PL!S-target-member', 'Aqours'),
      PLAYER1,
      'aqours'
    );
    const { game } = setupRiseScenario({
      turnCount: 1,
      members: { [SlotPosition.CENTER]: aqours },
    });

    const state = resolveLiveStart(game);

    expect(scoreModifiers(state)).toHaveLength(1);
    expect(bladeModifiers(state)).toHaveLength(0);
    expect(state.activeEffect).toBeNull();
  });

  it('opens target selection when multiple Nijigasaki stage members are available', () => {
    const left = createCardInstance(createMember('PL!N-left-member'), PLAYER1, 'left-member');
    const right = createCardInstance(createMember('PL!N-right-member'), PLAYER1, 'right-member');
    const { game } = setupRiseScenario({
      turnCount: 1,
      members: {
        [SlotPosition.LEFT]: left,
        [SlotPosition.RIGHT]: right,
      },
    });

    const state = resolveLiveStart(game);
    expect(state.activeEffect?.abilityId).toBe(
      PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID
    );
    expect(state.activeEffect?.selectableCardIds).toEqual([left.instanceId, right.instanceId]);

    const session = createGameSession();
    session.createGame('n-bp4-029-rise-up-high-selection', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = state;
    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id, right.instanceId)
    );
    expect(confirmResult.success, confirmResult.error).toBe(true);
    expect(bladeModifiers(session.state!)).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: right.instanceId,
      abilityId: PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID,
    });
    expect(session.state?.activeEffect).toBeNull();
  });
});
