import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createLive(cardCode = 'PL!N-pb1-037-L', name = 'Cara Tesoro'): LiveCardData {
  return {
    cardCode,
    name,
    groupName: '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({
      [HeartColor.GREEN]: 6,
      [HeartColor.RAINBOW]: 6,
    }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly groupName?: string;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupName: options.groupName ?? '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupCaraTesoroState(options: {
  readonly history:
    | 'energy'
    | 'energy-and-member'
    | 'cross-active-phase'
    | 'member-only'
    | 'filtered'
    | 'previous-turn';
}): GameState {
  const live = createCardInstance(createLive(), PLAYER1, 'cara-tesoro');
  const nijigasakiSource = createCardInstance(
    createMember({ cardCode: 'PL!N-test-source', name: '虹咲 Source' }),
    PLAYER1,
    'niji-source'
  );
  const otherGroupSource = createCardInstance(
    createMember({
      cardCode: 'PL!SP-test-source',
      name: 'Liella Source',
      groupName: 'Liella!',
    }),
    PLAYER1,
    'other-group-source'
  );
  const opponentSource = createCardInstance(
    createMember({ cardCode: 'PL!N-opponent-source', name: 'Opponent Source' }),
    PLAYER2,
    'opponent-source'
  );
  const stageMember = createCardInstance(
    createMember({ cardCode: 'PL!N-test-member', name: 'Stage Member' }),
    PLAYER1,
    'stage-member'
  );
  const energy = createCardInstance(createEnergy('energy-card'), PLAYER1, 'energy-card');

  let game = createGameState('n-pb1-037-cara-tesoro', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    live,
    nijigasakiSource,
    otherGroupSource,
    opponentSource,
    stageMember,
    energy,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, stageMember.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: addCardToStatefulZone(player.energyZone, energy.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
    },
  };

  switch (options.history) {
    case 'energy':
      return addNijigasakiEnergyActivation(addTurnStart(game), nijigasakiSource.instanceId, energy.instanceId);
    case 'energy-and-member':
      return addNijigasakiMemberActivation(
        addNijigasakiEnergyActivation(addTurnStart(game), nijigasakiSource.instanceId, energy.instanceId),
        nijigasakiSource.instanceId,
        stageMember.instanceId
      );
    case 'cross-active-phase':
      return addFirstPlayerToSecondPlayerActivePhaseChange(
        addNijigasakiMemberActivation(
          addNijigasakiEnergyActivation(
            addTurnStart(game),
            nijigasakiSource.instanceId,
            energy.instanceId
          ),
          nijigasakiSource.instanceId,
          stageMember.instanceId
        )
      );
    case 'member-only':
      return addNijigasakiMemberActivation(addTurnStart(game), nijigasakiSource.instanceId, stageMember.instanceId);
    case 'filtered': {
      let state = addTurnStart(game);
      state = addNijigasakiEnergyActivation(state, otherGroupSource.instanceId, energy.instanceId);
      state = addAction(state, 'RESOLVE_ABILITY', PLAYER2, {
        abilityId: 'opponent-effect',
        sourceCardId: opponentSource.instanceId,
        activatedEnergyCardIds: [energy.instanceId],
        previousOrientations: [{ cardId: energy.instanceId, orientation: OrientationState.WAITING }],
        nextOrientation: OrientationState.ACTIVE,
      });
      return addAction(state, 'TAP_ENERGY', PLAYER1, {
        activatedEnergyCardIds: [energy.instanceId],
        nextOrientation: OrientationState.ACTIVE,
      });
    }
    case 'previous-turn': {
      const state = addNijigasakiEnergyActivation(game, nijigasakiSource.instanceId, energy.instanceId);
      return addTurnStart(state);
    }
  }
}

function addTurnStart(game: GameState): GameState {
  return addAction(game, 'PHASE_CHANGE', null, {
    from: GamePhase.LIVE_RESULT_PHASE,
    to: GamePhase.ACTIVE_PHASE,
  });
}

function addFirstPlayerToSecondPlayerActivePhaseChange(game: GameState): GameState {
  return addAction(game, 'PHASE_CHANGE', null, {
    from: GamePhase.MAIN_PHASE,
    to: GamePhase.ACTIVE_PHASE,
  });
}

function addNijigasakiEnergyActivation(
  game: GameState,
  sourceCardId: string,
  energyCardId: string
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', PLAYER1, {
    abilityId: 'test-activate-energy',
    sourceCardId,
    activatedEnergyCardIds: [energyCardId],
    previousOrientations: [{ cardId: energyCardId, orientation: OrientationState.WAITING }],
    nextOrientation: OrientationState.ACTIVE,
  });
}

function addNijigasakiMemberActivation(
  game: GameState,
  sourceCardId: string,
  memberCardId: string
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', PLAYER1, {
    abilityId: 'test-activate-member',
    sourceCardId,
    activatedMemberCardIds: [memberCardId],
    previousOrientations: [{ cardId: memberCardId, orientation: OrientationState.WAITING }],
    nextOrientation: OrientationState.ACTIVE,
  });
}

function resolveLiveStart(game: GameState): GameState {
  const liveStartResult = new GameService().executeCheckTiming(game, [
    TriggerCondition.ON_LIVE_START,
  ]);
  expect(liveStartResult.success).toBe(true);
  const session = createGameSession();
  session.createGame('n-pb1-037-cara-tesoro-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = liveStartResult.gameState;
  const confirmResult = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, liveStartResult.gameState.activeEffect!.id)
  );
  expect(confirmResult.success).toBe(true);
  return session.state!;
}

function getCaraTesoroScoreBonus(game: GameState): number {
  const modifier = game.liveResolution.liveModifiers.find(
    (candidate) =>
      candidate.kind === 'SCORE' &&
      candidate.abilityId ===
        PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID
  );
  return modifier?.kind === 'SCORE' ? modifier.countDelta : 0;
}

describe('PL!N-pb1-037-L Cara Tesoro', () => {
  it('gains SCORE +1 if a Nijigasaki effect activated waiting energy this turn', () => {
    const state = resolveLiveStart(setupCaraTesoroState({ history: 'energy' }));

    expect(getCaraTesoroScoreBonus(state)).toBe(1);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID,
      activatedEnergyByNijigasakiEffect: true,
      activatedMemberByNijigasakiEffect: false,
      scoreBonus: 1,
    });
  });

  it('gains SCORE +2 instead when a Nijigasaki effect also activated a stage member', () => {
    const state = resolveLiveStart(setupCaraTesoroState({ history: 'energy-and-member' }));

    expect(getCaraTesoroScoreBonus(state)).toBe(2);
    expect(
      state.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId ===
            PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID
      )
    ).toHaveLength(1);
  });

  it('keeps first-player activation records after MAIN_PHASE to ACTIVE_PHASE handoff', () => {
    const state = resolveLiveStart(setupCaraTesoroState({ history: 'cross-active-phase' }));

    expect(getCaraTesoroScoreBonus(state)).toBe(2);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID,
      activatedEnergyByNijigasakiEffect: true,
      activatedMemberByNijigasakiEffect: true,
      scoreBonus: 2,
    });
  });

  it('does not gain score if only a stage member was activated', () => {
    const state = resolveLiveStart(setupCaraTesoroState({ history: 'member-only' }));

    expect(getCaraTesoroScoreBonus(state)).toBe(0);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      activatedEnergyByNijigasakiEffect: false,
      activatedMemberByNijigasakiEffect: true,
      scoreBonus: 0,
    });
  });

  it('ignores non-Nijigasaki, opponent, and non-card-effect activation records', () => {
    const state = resolveLiveStart(setupCaraTesoroState({ history: 'filtered' }));

    expect(getCaraTesoroScoreBonus(state)).toBe(0);
  });

  it('ignores activation records before the latest overall turn start', () => {
    const state = resolveLiveStart(setupCaraTesoroState({ history: 'previous-turn' }));

    expect(getCaraTesoroScoreBonus(state)).toBe(0);
  });
});
