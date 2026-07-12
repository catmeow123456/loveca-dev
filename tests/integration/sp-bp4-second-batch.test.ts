import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  SP_BP4_002_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_LIELLA_LIVE_ABILITY_ID,
  SP_BP4_018_ACTIVATED_SELF_SACRIFICE_RECOVER_LIELLA_CARD_ABILITY_ID,
  SP_BP4_022_LIVE_START_PAY_UP_TO_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode, cost = 2): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createOtherMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLive(
  cardCode: string,
  options: { readonly groupNames?: readonly string[]; readonly totalRequired?: number } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement(
      { [HeartColor.PINK]: options.totalRequired ?? 1 },
      options.totalRequired
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

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${abilityId}:event`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function createSessionFromGame(game: GameState, gameId: string) {
  const session = createGameSession();
  session.createGame(gameId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function baseGame(): GameState {
  return {
    ...createGameState('sp-bp4-second-batch', PLAYER1, 'P1', PLAYER2, 'P2'),
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}

describe('PL!SP-bp4 second batch effects', () => {
  it('PL!SP-bp4-002 can decline or wait source, take only high-requirement Liella! LIVE, and sends the rest to waiting room', () => {
    const source = createCardInstance(createMember('PL!SP-bp4-002-P', '唐 可可'), PLAYER1, '002');
    const target = createCardInstance(
      createLive('PL!SP-live-high-liella', { totalRequired: 8 }),
      PLAYER1,
      'target-live'
    );
    const lowRequirement = createCardInstance(
      createLive('PL!SP-live-low-liella', { totalRequired: 7 }),
      PLAYER1,
      'low-live'
    );
    const nonLiella = createCardInstance(
      createLive('PL!SP-live-other', { groupNames: ['Aqours'], totalRequired: 8 }),
      PLAYER1,
      'other-live'
    );
    const member = createCardInstance(createMember('PL!SP-member-liella'), PLAYER1, 'member');
    const bottom = createCardInstance(createMember('PL!SP-bottom'), PLAYER1, 'bottom');
    let game = registerCards(baseGame(), [source, target, lowRequirement, nonLiella, member, bottom]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: {
        ...player.mainDeck,
        cardIds: [
          target.instanceId,
          lowRequirement.instanceId,
          nonLiella.instanceId,
          member.instanceId,
          bottom.instanceId,
        ],
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          SP_BP4_002_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_LIELLA_LIVE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    };

    const declineSession = createSessionFromGame(
      resolvePendingCardEffects(game).gameState,
      'bp4-002-decline'
    );
    expect(declineSession.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'activate', label: '发动' },
      { id: 'decline', label: '不发动' },
    ]);
    const decline = declineSession.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        declineSession.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'decline'
      )
    );
    expect(decline.success, decline.error).toBe(true);
    expect(
      declineSession.state?.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(declineSession.state?.players[0].mainDeck.cardIds.slice(0, 4)).toEqual([
      target.instanceId,
      lowRequirement.instanceId,
      nonLiella.instanceId,
      member.instanceId,
    ]);
    expect(declineSession.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp4-002-pay');
    const activate = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'activate'
      )
    );
    expect(activate.success, activate.error).toBe(true);
    expect(session.state?.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual([
      target.instanceId,
      lowRequirement.instanceId,
      nonLiella.instanceId,
      member.instanceId,
    ]);

    const reveal = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );
    expect(reveal.success, reveal.error).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(target.instanceId);

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      lowRequirement.instanceId,
      nonLiella.instanceId,
      member.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([bottom.instanceId]);
  });

  it('PL!SP-bp4-018 pays self-sacrifice first, then can recover the source Liella! card', () => {
    const source = createCardInstance(createMember('PL!SP-bp4-018-N', '米女メイ', 4), PLAYER1, '018');
    const liellaLive = createCardInstance(createLive('PL!SP-liella-live'), PLAYER1, 'liella-live');
    const nonLiella = createCardInstance(
      createOtherMember('PL!S-other-member', 'Other'),
      PLAYER1,
      'other-member'
    );
    let game = registerCards(baseGame(), [source, liellaLive, nonLiella]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [liellaLive.instanceId, nonLiella.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const session = createSessionFromGame(game, 'bp4-018');

    const activate = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        source.instanceId,
        SP_BP4_018_ACTIVATED_SELF_SACRIFICE_RECOVER_LIELLA_CARD_ABILITY_ID
      )
    );
    expect(activate.success, activate.error).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      liellaLive.instanceId,
      source.instanceId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(nonLiella.instanceId);

    const recover = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, source.instanceId)
    );
    expect(recover.success, recover.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toEqual([source.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([liellaLive.instanceId, nonLiella.instanceId]);
  });

  it('PL!SP-bp4-022 pays up to two active energy and gains matching BLADE', () => {
    const source = createCardInstance(createMember('PL!SP-bp4-022-N', '鬼塚冬毬', 10), PLAYER1, '022');
    const energies = [0, 1].map((index) =>
      createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `energy-${index}`)
    );
    let game = registerCards(baseGame(), [source, ...energies]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: energies.reduce(
        (zone, energy) =>
          addCardToStatefulZone(zone, energy.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          SP_BP4_022_LIVE_START_PAY_UP_TO_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp4-022-two');

    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'pay-1', label: '支付[E]' },
      { id: 'pay-2', label: '支付[E][E]' },
      { id: 'decline', label: '不发动' },
    ]);
    const payTwo = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay-2'
      )
    );
    expect(payTwo.success, payTwo.error).toBe(true);
    for (const energy of energies) {
      expect(session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: SP_BP4_022_LIVE_START_PAY_UP_TO_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
    });

    let oneEnergyGame = registerCards(baseGame(), [source, energies[0]!]);
    oneEnergyGame = updatePlayer(oneEnergyGame, PLAYER1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, energies[0]!.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    oneEnergyGame = {
      ...oneEnergyGame,
      pendingAbilities: [
        createPendingAbility(
          SP_BP4_022_LIVE_START_PAY_UP_TO_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };
    const oneEnergySession = createSessionFromGame(
      resolvePendingCardEffects(oneEnergyGame).gameState,
      'bp4-022-one'
    );
    expect(oneEnergySession.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'pay-1', label: '支付[E]' },
      { id: 'decline', label: '不发动' },
    ]);
    const payOne = oneEnergySession.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        oneEnergySession.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay-1'
      )
    );
    expect(payOne.success, payOne.error).toBe(true);
    expect(oneEnergySession.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: source.instanceId,
      abilityId: SP_BP4_022_LIVE_START_PAY_UP_TO_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
    });

    let noEnergyGame = registerCards(baseGame(), [source]);
    noEnergyGame = updatePlayer(noEnergyGame, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    noEnergyGame = {
      ...noEnergyGame,
      pendingAbilities: [
        createPendingAbility(
          SP_BP4_022_LIVE_START_PAY_UP_TO_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };
    const noEnergySession = createSessionFromGame(
      resolvePendingCardEffects(noEnergyGame).gameState,
      'bp4-022-none'
    );
    expect(noEnergySession.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'decline', label: '不发动' },
    ]);
    const decline = noEnergySession.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        noEnergySession.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'decline'
      )
    );
    expect(decline.success, decline.error).toBe(true);
    expect(noEnergySession.state?.liveResolution.liveModifiers).toEqual([]);
  });
});
