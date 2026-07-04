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
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
  PL_N_BP4_010_ON_ENTER_EXCHANGE_NIJIGASAKI_SUCCESS_LIVE_ABILITY_ID,
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
const NIJIGASAKI_GROUP = 'ラブライブ！虹ヶ咲学園スクールアイドル同好会';

function createShioriko(): MemberCardData {
  return {
    cardCode: 'PL!N-bp4-010-R＋',
    name: '三船栞子',
    groupNames: [NIJIGASAKI_GROUP],
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createLive(
  cardCode: string,
  name: string,
  groupNames: readonly string[] = [NIJIGASAKI_GROUP]
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function setupStage(sourceId = 'shioriko'): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(createShioriko(), PLAYER1, sourceId);
  let game = createGameState('n-bp4-010-shioriko', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { game, source };
}

function withCards(game: GameState, cards: readonly ReturnType<typeof createCardInstance>[]): GameState {
  return registerCards(game, cards);
}

function addToSuccess(game: GameState, cardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    successZone: addCardToZone(player.successZone, cardId),
  }));
}

function addToWaiting(game: GameState, cardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: addCardToZone(player.waitingRoom, cardId),
  }));
}

function addToLiveZone(game: GameState, cardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function pendingAbility(abilityId: string, sourceCardId: string, timingId: TriggerCondition): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:test`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [],
  };
}

function withPending(game: GameState, abilityId: string, sourceCardId: string, timingId: TriggerCondition): GameState {
  return {
    ...game,
    pendingAbilities: [pendingAbility(abilityId, sourceCardId, timingId)],
  };
}

function resolve(game: GameState): GameState {
  const result = resolvePendingCardEffects(game);
  return result.gameState;
}

function confirm(game: GameState, selectedCardId?: string | null): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function heartModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.abilityId ===
        PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID
  );
}

function latestResolvePayload(game: GameState, abilityId: string) {
  return [...game.actionHistory]
    .reverse()
    .find((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    ?.payload;
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

describe('PL!N-bp4-010 Shioriko workflows', () => {
  it('optionally exchanges a Nijigasaki success LIVE with a current waiting-room Nijigasaki LIVE', () => {
    const { game: baseGame, source } = setupStage();
    const successLive = createCardInstance(createLive('PL!N-success-live', '夢への一歩'), PLAYER1, 'success-live');
    const waitingLive = createCardInstance(createLive('PL!N-waiting-live', 'Colorful Dreams! Colorful Smiles!'), PLAYER1, 'waiting-live');
    let game = withCards(baseGame, [successLive, waitingLive]);
    game = addToSuccess(addToWaiting(game, waitingLive.instanceId), successLive.instanceId);
    game = withPending(
      game,
      PL_N_BP4_010_ON_ENTER_EXCHANGE_NIJIGASAKI_SUCCESS_LIVE_ABILITY_ID,
      source.instanceId,
      TriggerCondition.ON_ENTER_STAGE
    );

    let state = resolve(game);
    expect(state.activeEffect?.selectableCardIds).toEqual([successLive.instanceId]);

    state = confirm(state, successLive.instanceId);
    expect(state.activeEffect?.selectableCardIds).toEqual([
      waitingLive.instanceId,
      successLive.instanceId,
    ]);

    state = confirm(state, waitingLive.instanceId);
    const player = state.players.find((candidate) => candidate.id === PLAYER1)!;
    expect(player.successZone.cardIds).toEqual([waitingLive.instanceId]);
    expect(player.waitingRoom.cardIds).toEqual([successLive.instanceId]);
    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
  });

  it('skips the on-enter exchange without moving cards', () => {
    const { game: baseGame, source } = setupStage('skip-shioriko');
    const successLive = createCardInstance(createLive('PL!N-success-live', '夢への一歩'), PLAYER1, 'success-live-skip');
    let game = withCards(baseGame, [successLive]);
    game = addToSuccess(game, successLive.instanceId);
    game = withPending(
      game,
      PL_N_BP4_010_ON_ENTER_EXCHANGE_NIJIGASAKI_SUCCESS_LIVE_ABILITY_ID,
      source.instanceId,
      TriggerCondition.ON_ENTER_STAGE
    );

    const state = confirm(resolve(game), null);
    const player = state.players.find((candidate) => candidate.id === PLAYER1)!;
    expect(player.successZone.cardIds).toEqual([successLive.instanceId]);
    expect(player.waitingRoom.cardIds).toEqual([]);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('gains green Heart after confirming the only live-zone Nijigasaki LIVE with a same-name success LIVE', () => {
    const { game: baseGame, source } = setupStage('live-start-shioriko');
    const live = createCardInstance(createLive('PL!N-live-zone', '夢への一歩'), PLAYER1, 'live-zone');
    const successLive = createCardInstance(createLive('PL!N-success-live', '夢への一歩'), PLAYER1, 'success-live-same-name');
    let game = withCards(baseGame, [live, successLive]);
    game = addToSuccess(addToLiveZone(game, live.instanceId), successLive.instanceId);

    let state = resolveLiveStart(game);
    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(heartModifiers(state)).toEqual([]);

    state = confirmIfConfirmOnly(state, PLAYER1);
    expect(heartModifiers(state)).toEqual([
      {
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        playerId: PLAYER1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
        sourceCardId: source.instanceId,
        abilityId: PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
      },
    ]);
    expect(latestResolvePayload(state, PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID)).toMatchObject({
      step: 'MATCHING_SUCCESS_LIVE_GAIN_GREEN_HEART',
      selectedLiveCardId: live.instanceId,
      hasMatchingSuccessLive: true,
    });
  });

  it('resolves without Heart when the selected Nijigasaki LIVE has no same-name success LIVE', () => {
    const { game: baseGame } = setupStage('no-match-shioriko');
    const live = createCardInstance(createLive('PL!N-live-zone', '夢への一歩'), PLAYER1, 'live-zone-no-match');
    const successLive = createCardInstance(createLive('PL!N-success-live', '別のライブ'), PLAYER1, 'success-live-other-name');
    let game = withCards(baseGame, [live, successLive]);
    game = addToSuccess(addToLiveZone(game, live.instanceId), successLive.instanceId);

    const state = confirmIfConfirmOnly(resolveLiveStart(game), PLAYER1);

    expect(heartModifiers(state)).toEqual([]);
    expect(latestResolvePayload(state, PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID)).toMatchObject({
      step: 'NO_MATCHING_SUCCESS_LIVE',
      selectedLiveCardId: live.instanceId,
      hasMatchingSuccessLive: false,
    });
  });

  it('ignores non-Nijigasaki LIVE cards and lets the player choose among multiple legal LIVE cards', () => {
    const { game: baseGame, source } = setupStage('multi-live-shioriko');
    const leftLive = createCardInstance(createLive('PL!N-left-live', '夢への一歩'), PLAYER1, 'left-live');
    const rightLive = createCardInstance(createLive('PL!N-right-live', '繚乱！ビクトリーロード'), PLAYER1, 'right-live');
    const otherGroupLive = createCardInstance(
      createLive('PL!SP-live', 'Liella Live', ['ラブライブ！スーパースター!!']),
      PLAYER1,
      'other-group-live'
    );
    const successLive = createCardInstance(createLive('PL!N-success-live', '繚乱！ビクトリーロード'), PLAYER1, 'success-live-right');
    let game = withCards(baseGame, [leftLive, rightLive, otherGroupLive, successLive]);
    game = addToLiveZone(addToLiveZone(addToLiveZone(game, leftLive.instanceId), rightLive.instanceId), otherGroupLive.instanceId);
    game = addToSuccess(game, successLive.instanceId);

    let state = resolveLiveStart(game);
    expect(state.activeEffect?.abilityId).toBe(
      PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID
    );
    expect(state.activeEffect?.selectableCardIds).toEqual([leftLive.instanceId, rightLive.instanceId]);

    state = confirm(state, rightLive.instanceId);
    expect(heartModifiers(state)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      sourceCardId: source.instanceId,
      abilityId: PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
    });
    expect(state.activeEffect).toBeNull();
  });
});
