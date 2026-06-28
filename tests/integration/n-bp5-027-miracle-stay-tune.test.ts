import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { PL_N_BP5_027_LIVE_START_SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
const STAGE_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

function createMiracleStayTune(cardCode = 'PL!N-bp5-027-L'): LiveCardData {
  return {
    cardCode,
    name: 'ミラクル STAY TUNE！',
    groupName: '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 2 }),
  };
}

function createMember(name: string): MemberCardData {
  return {
    cardCode: `TEST-${name}`,
    name,
    groupName: '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function setupState(options: {
  readonly ownSuccessCount?: number;
  readonly opponentSuccessCount?: number;
  readonly memberNames?: readonly string[];
  readonly sourceInLiveZone?: boolean;
}): {
  readonly game: GameState;
  readonly live: ReturnType<typeof createCardInstance>;
} {
  const live = createCardInstance(createMiracleStayTune(), PLAYER1, 'miracle-stay-tune-live');
  const ownSuccessLives = Array.from({ length: options.ownSuccessCount ?? 0 }, (_, index) =>
    createCardInstance(createMiracleStayTune(`PL!N-test-own-success-${index}-L`), PLAYER1, `own-success-${index}`)
  );
  const opponentSuccessLives = Array.from({ length: options.opponentSuccessCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMiracleStayTune(`PL!N-test-opponent-success-${index}-L`),
      PLAYER2,
      `opponent-success-${index}`
    )
  );
  const memberEntries = (options.memberNames ?? ['上原歩夢', '桜坂しずく', '鐘嵐珠']).map(
    (name, index) => {
      const card = createCardInstance(createMember(name), PLAYER1, `member-${index}`);
      const slot = STAGE_SLOTS[index] ?? SlotPosition.RIGHT;
      return [slot, card] as const;
    }
  );

  let game = createGameState('n-bp5-027-miracle-stay-tune', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    live,
    ...ownSuccessLives,
    ...opponentSuccessLives,
    ...memberEntries.map(([, card]) => card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const memberSlots = memberEntries.reduce(
      (slots, [slot, card]) =>
        placeCardInSlot(slots, slot, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    );
    const liveZone =
      options.sourceInLiveZone === false
        ? player.liveZone
        : addCardToStatefulZone(player.liveZone, live.instanceId);
    const successZone = ownSuccessLives.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.successZone
    );
    return {
      ...player,
      liveZone,
      successZone,
      memberSlots,
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    const successZone = opponentSuccessLives.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.successZone
    );
    return {
      ...player,
      successZone,
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 5]]),
    },
  };

  return { game, live };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  expect(result.gameState.activeEffect).toBeNull();
  return result.gameState;
}

function miracleScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        PL_N_BP5_027_LIVE_START_SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function latestPayload(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          PL_N_BP5_027_LIVE_START_SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE_ABILITY_ID
    )?.payload;
}

describe('PL!N-bp5-027-L Miracle STAY TUNE live start workflow', () => {
  it('adds SCORE +1 and refreshes playerScores when own success zone has two cards and stage has three names', () => {
    const { game, live } = setupState({ ownSuccessCount: 2 });

    const state = resolveLiveStart(game);

    expect(miracleScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: live.instanceId,
        sourceCardId: live.instanceId,
        abilityId:
          PL_N_BP5_027_LIVE_START_SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestPayload(state)).toMatchObject({
      ownSuccessZoneCount: 2,
      opponentSuccessZoneCount: 0,
      successZoneConditionMet: true,
      differentNameConditionMet: true,
      scoreBonus: 1,
    });
  });

  it('adds SCORE +1 when opponent success zone has two cards', () => {
    const { game } = setupState({ opponentSuccessCount: 2 });

    const state = resolveLiveStart(game);

    expect(miracleScoreModifiers(state)).toHaveLength(1);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestPayload(state)).toMatchObject({
      ownSuccessZoneCount: 0,
      opponentSuccessZoneCount: 2,
      scoreBonus: 1,
    });
  });

  it('consumes pending without SCORE when neither success zone has two cards', () => {
    const { game } = setupState({ ownSuccessCount: 1, opponentSuccessCount: 1 });

    const state = resolveLiveStart(game);

    expect(state.pendingAbilities).toEqual([]);
    expect(miracleScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(latestPayload(state)).toMatchObject({
      successZoneConditionMet: false,
      scoreBonus: 0,
    });
  });

  it('does not add SCORE when stage has fewer than three different names', () => {
    const { game } = setupState({
      ownSuccessCount: 2,
      memberNames: ['上原歩夢', '上原 歩夢', '桜坂しずく'],
    });

    const state = resolveLiveStart(game);

    expect(miracleScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(latestPayload(state)).toMatchObject({
      differentNameConditionMet: false,
      scoreBonus: 0,
    });
  });

  it('does not add SCORE when the source is not in the live zone', () => {
    const { game, live } = setupState({ ownSuccessCount: 2, sourceInLiveZone: false });
    const stateWithPending: GameState = {
      ...game,
      pendingAbilities: [
        {
          id: `${PL_N_BP5_027_LIVE_START_SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE_ABILITY_ID}:${live.instanceId}:manual`,
          abilityId:
            PL_N_BP5_027_LIVE_START_SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
          sourceCardId: live.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['manual-live-start'],
        },
      ],
    };

    const result = resolvePendingCardEffects(stateWithPending);

    expect(result.gameState.pendingAbilities).toEqual([]);
    expect(miracleScoreModifiers(result.gameState)).toEqual([]);
    expect(result.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(latestPayload(result.gameState)).toMatchObject({
      sourceInLiveZone: false,
      scoreBonus: 0,
    });
  });
});
