import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
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
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_007_CONTINUOUS_TOTAL_ENERGY_FIFTEEN_GAIN_TWO_RED_HEART_ABILITY_ID,
  PL_N_BP4_007_LIVE_SUCCESS_EACH_PLAYER_PLACE_WAITING_ENERGY_ABILITY_ID,
  PL_N_BP4_007_ON_ENTER_EACH_PLAYER_RECOVER_LIVE_ABILITY_ID,
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

function createSetsuna(cardCode = 'PL!N-bp4-007-R＋'): MemberCardData {
  return {
    cardCode,
    name: '優木せつ菜',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(name: string, ownerId: string, instanceId: string) {
  const data: LiveCardData = {
    cardCode: `LIVE-${name}`,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
  return createCardInstance(data, ownerId, instanceId);
}

function createMember(name: string, ownerId: string, instanceId: string) {
  const data: MemberCardData = {
    cardCode: `MEMBER-${name}`,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [],
  };
  return createCardInstance(data, ownerId, instanceId);
}

function createEnergy(ownerId: string, instanceId: string) {
  return createCardInstance(
    {
      cardCode: `ENERGY-${instanceId}`,
      name: `Energy ${instanceId}`,
      cardType: CardType.ENERGY,
    },
    ownerId,
    instanceId
  );
}

function baseGame(cardCode = 'PL!N-bp4-007-R＋'): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(createSetsuna(cardCode), PLAYER1, `setsuna-${cardCode}`);
  let game = createGameState('n-bp4-007-setsuna', PLAYER1, 'P1', PLAYER2, 'P2');
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

function pendingAbility(abilityId: string, sourceCardId: string): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:test`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId:
      abilityId === PL_N_BP4_007_ON_ENTER_EACH_PLAYER_RECOVER_LIVE_ABILITY_ID
        ? TriggerCondition.ON_ENTER_STAGE
        : TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
  };
}

function withPending(game: GameState, abilityId: string, sourceCardId: string): GameState {
  return {
    ...game,
    pendingAbilities: [pendingAbility(abilityId, sourceCardId)],
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function addCards(game: GameState, cards: readonly ReturnType<typeof createCardInstance>[]) {
  return registerCards(game, cards);
}

function setWaitingRoom(game: GameState, playerId: string, cardIds: readonly string[]): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    waitingRoom: { ...player.waitingRoom, cardIds: [...cardIds] },
  }));
}

function setEnergyDeck(game: GameState, playerId: string, cardIds: readonly string[]): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    energyDeck: { ...player.energyDeck, cardIds: [...cardIds] },
  }));
}

function addEnergyZoneCount(game: GameState, playerId: string, count: number): GameState {
  const energies = Array.from({ length: count }, (_, index) =>
    createEnergy(playerId, `${playerId}-zone-energy-${index}`)
  );
  let state = registerCards(game, energies);
  state = updatePlayer(state, playerId, (player) => ({
    ...player,
    energyZone: energies.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  return state;
}

describe('PL!N-bp4-007 Setsuna on-enter, continuous, and live-success effects', () => {
  it('lets each player recover one LIVE from their own waiting room in controller then opponent order', () => {
    const scenario = baseGame();
    const ownLive = createLive('own', PLAYER1, 'own-live');
    const ownMember = createMember('own-member', PLAYER1, 'own-member');
    const opponentLive = createLive('opponent', PLAYER2, 'opponent-live');
    let game = addCards(scenario.game, [ownLive, ownMember, opponentLive]);
    game = setWaitingRoom(game, PLAYER1, [ownLive.instanceId, ownMember.instanceId]);
    game = setWaitingRoom(game, PLAYER2, [opponentLive.instanceId]);
    game = withPending(
      game,
      PL_N_BP4_007_ON_ENTER_EACH_PLAYER_RECOVER_LIVE_ABILITY_ID,
      scenario.source.instanceId
    );

    let state = resolve(game);
    expect(state.activeEffect?.awaitingPlayerId).toBe(PLAYER1);
    expect(state.activeEffect?.selectableCardIds).toEqual([ownLive.instanceId]);

    state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER1, state.activeEffect!.id, ownLive.instanceId);
    expect(state.players[0]!.hand.cardIds).toEqual([ownLive.instanceId]);
    expect(state.activeEffect?.awaitingPlayerId).toBe(PLAYER2);
    expect(state.activeEffect?.selectableCardIds).toEqual([opponentLive.instanceId]);

    state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER2, state.activeEffect!.id, opponentLive.instanceId);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0]!.waitingRoom.cardIds).toEqual([ownMember.instanceId]);
    expect(state.players[1]!.hand.cardIds).toEqual([opponentLive.instanceId]);
  });

  it('skips a player with no waiting-room LIVE and keeps stale selections from advancing', () => {
    const scenario = baseGame('PL!N-bp4-007-P');
    const opponentLive = createLive('opponent-only', PLAYER2, 'opponent-only-live');
    let game = addCards(scenario.game, [opponentLive]);
    game = setWaitingRoom(game, PLAYER1, []);
    game = setWaitingRoom(game, PLAYER2, [opponentLive.instanceId]);
    game = withPending(
      game,
      PL_N_BP4_007_ON_ENTER_EACH_PLAYER_RECOVER_LIVE_ABILITY_ID,
      scenario.source.instanceId
    );

    let state = resolve(game);
    expect(state.activeEffect?.awaitingPlayerId).toBe(PLAYER2);

    const stale = setWaitingRoom(state, PLAYER2, []);
    const unchanged = confirmActiveEffectStepThroughPublicReveal(
      stale,
      PLAYER2,
      stale.activeEffect!.id,
      opponentLive.instanceId
    );
    expect(unchanged.activeEffect).toEqual(stale.activeEffect);
    expect(unchanged.players[1]!.hand.cardIds).toEqual([]);

    state = setWaitingRoom(state, PLAYER2, [opponentLive.instanceId]);
    state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER2, state.activeEffect!.id, opponentLive.instanceId);
    expect(state.activeEffect).toBeNull();
    expect(state.players[1]!.hand.cardIds).toEqual([opponentLive.instanceId]);
  });

  it('collects two yellow Hearts only while total energy is at least fifteen and source remains staged', () => {
    const scenario = baseGame('PL!N-bp4-007-P＋');
    let game = addEnergyZoneCount(scenario.game, PLAYER1, 8);
    game = addEnergyZoneCount(game, PLAYER2, 7);

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.RED, count: 2 }],
      sourceCardId: scenario.source.instanceId,
      abilityId: PL_N_BP4_007_CONTINUOUS_TOTAL_ENERGY_FIFTEEN_GAIN_TWO_RED_HEART_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(game, PLAYER1, scenario.source.instanceId)).toEqual([
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.RED, count: 2 },
    ]);

    const belowThreshold = addEnergyZoneCount(scenario.game, PLAYER1, 14);
    expect(collectLiveModifiers(belowThreshold)).not.toContainEqual(
      expect.objectContaining({
        abilityId: PL_N_BP4_007_CONTINUOUS_TOTAL_ENERGY_FIFTEEN_GAIN_TWO_RED_HEART_ABILITY_ID,
      })
    );

    const sourceLeftStage = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(collectLiveModifiers(sourceLeftStage)).not.toContainEqual(
      expect.objectContaining({
        abilityId: PL_N_BP4_007_CONTINUOUS_TOTAL_ENERGY_FIFTEEN_GAIN_TWO_RED_HEART_ABILITY_ID,
      })
    );
  });

  it('shows confirm-only before live-success placement, then places one waiting energy for each player', () => {
    const scenario = baseGame('PL!N-bp4-007-SEC');
    const ownEnergy = createEnergy(PLAYER1, 'own-energy');
    const opponentEnergy = createEnergy(PLAYER2, 'opponent-energy');
    let game = addCards(scenario.game, [ownEnergy, opponentEnergy]);
    game = setEnergyDeck(game, PLAYER1, [ownEnergy.instanceId]);
    game = setEnergyDeck(game, PLAYER2, [opponentEnergy.instanceId]);
    game = withPending(
      game,
      PL_N_BP4_007_LIVE_SUCCESS_EACH_PLAYER_PLACE_WAITING_ENERGY_ABILITY_ID,
      scenario.source.instanceId
    );

    let state = resolve(game);
    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(state.activeEffect?.effectText).toContain(
      '自己和对方各自从自己的能量卡组顶将1张能量以待机状态放置到能量区'
    );
    expect(state.activeEffect?.effectText).not.toContain('当前能量卡组');
    expect(state.activeEffect?.effectText).not.toContain('确认后');
    expect(state.players[0]!.energyZone.cardIds).toEqual([]);

    state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER1, state.activeEffect!.id);
    expect(state.activeEffect).toBeNull();
    expect(state.players[0]!.energyZone.cardIds).toEqual([ownEnergy.instanceId]);
    expect(state.players[1]!.energyZone.cardIds).toEqual([opponentEnergy.instanceId]);
    expect(state.players[0]!.energyZone.cardStates.get(ownEnergy.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.players[1]!.energyZone.cardStates.get(opponentEnergy.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('live-success places only for players with energy deck and no-ops when source is off stage', () => {
    const scenario = baseGame();
    const ownEnergy = createEnergy(PLAYER1, 'own-only-energy');
    let game = addCards(scenario.game, [ownEnergy]);
    game = setEnergyDeck(game, PLAYER1, [ownEnergy.instanceId]);
    game = setEnergyDeck(game, PLAYER2, []);
    game = withPending(
      game,
      PL_N_BP4_007_LIVE_SUCCESS_EACH_PLAYER_PLACE_WAITING_ENERGY_ABILITY_ID,
      scenario.source.instanceId
    );

    let state = confirmActiveEffectStepThroughPublicReveal(resolve(game), PLAYER1, game.pendingAbilities[0]!.id);
    expect(state.players[0]!.energyZone.cardIds).toEqual([ownEnergy.instanceId]);
    expect(state.players[1]!.energyZone.cardIds).toEqual([]);

    const offStageScenario = baseGame('PL!N-bp4-007-P');
    const offStageEnergy = createEnergy(PLAYER1, 'off-stage-energy');
    let offStageGame = addCards(offStageScenario.game, [offStageEnergy]);
    offStageGame = setEnergyDeck(offStageGame, PLAYER1, [offStageEnergy.instanceId]);
    offStageGame = updatePlayer(offStageGame, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    offStageGame = withPending(
      offStageGame,
      PL_N_BP4_007_LIVE_SUCCESS_EACH_PLAYER_PLACE_WAITING_ENERGY_ABILITY_ID,
      offStageScenario.source.instanceId
    );

    state = confirmActiveEffectStepThroughPublicReveal(
      resolve(offStageGame),
      PLAYER1,
      offStageGame.pendingAbilities[0]!.id
    );
    expect(state.players[0]!.energyDeck.cardIds).toEqual([offStageEnergy.instanceId]);
    expect(state.players[0]!.energyZone.cardIds).toEqual([]);
  });
});
