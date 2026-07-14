import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_PB1_003_ON_ENTER_WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY_ABILITY_ID,
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

function member(cardCode: string, unitName = 'Printemps'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    unitName,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function createPending(id: string, abilityId: string, sourceCardId: string): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: {
  readonly sourceCode?: string;
  readonly sourceOrientation?: OrientationState;
  readonly sourceOnStage?: boolean;
  readonly energyOrientations?: readonly OrientationState[];
  readonly includeContinuation?: boolean;
} = {}) {
  const source = createCardInstance(member(options.sourceCode ?? 'PL!-pb1-003-R'), PLAYER1, 'source');
  const printemps = createCardInstance(member('PRINTEMPS'), PLAYER1, 'printemps');
  const other = createCardInstance(member('BIBI', 'BiBi'), PLAYER1, 'other');
  const continuationSource = createCardInstance(member('DRAW-SOURCE'), PLAYER1, 'draw-source');
  const drawCard = createCardInstance(member('DRAW-CARD'), PLAYER1, 'draw-card');
  const energyCards = (options.energyOrientations ?? [OrientationState.WAITING, OrientationState.WAITING]).map(
    (orientation, index) => ({
      card: createCardInstance(energy(`ENERGY-${index}`), PLAYER1, `energy-${index}`),
      orientation,
    })
  );

  let game = registerCards(createGameState('pl-pb1-003', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    printemps,
    other,
    continuationSource,
    drawCard,
    ...energyCards.map((entry) => entry.card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: printemps.instanceId,
        [SlotPosition.CENTER]: options.sourceOnStage === false ? null : source.instanceId,
        [SlotPosition.RIGHT]: other.instanceId,
      },
      cardStates: new Map([
        [printemps.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        [source.instanceId, { orientation: options.sourceOrientation ?? OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        [other.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((entry) => entry.card.instanceId),
      cardStates: new Map(
        energyCards.map((entry) => [
          entry.card.instanceId,
          { orientation: entry.orientation, face: FaceState.FACE_UP },
        ])
      ),
    },
  }));

  const pendingAbilities = [
    createPending(
      'pb1-003-pending',
      PL_PB1_003_ON_ENTER_WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY_ABILITY_ID,
      source.instanceId
    ),
  ];
  if (options.includeContinuation) {
    pendingAbilities.push(
      createPending('draw-pending', MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID, continuationSource.instanceId)
    );
  }

  return {
    game: { ...game, pendingAbilities },
    source,
    printemps,
    drawCard,
    energyCards: energyCards.map((entry) => entry.card),
  };
}

function chooseOption(game: ReturnType<typeof resolvePendingCardEffects>['gameState'], option: string | null) {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    option
  );
}

function start003Pending(game: ReturnType<typeof resolvePendingCardEffects>['gameState'], sourceCardId: string) {
  const selection = resolvePendingCardEffects(game).gameState;
  if (selection.activeEffect?.abilityId !== 'system:select-pending-card-effect') {
    return selection;
  }
  return confirmActiveEffectStep(selection, PLAYER1, selection.activeEffect.id, sourceCardId);
}

describe('PL!-pb1-003 南ことり', () => {
  it('covers R/P＋ and records the paid ACTIVE -> WAITING event in the resolved payload', () => {
    for (const sourceCode of ['PL!-pb1-003-R', 'PL!-pb1-003-P＋']) {
      const scenario = setup({ sourceCode });
      const paid = chooseOption(resolvePendingCardEffects(scenario.game).gameState, 'WAIT_SOURCE');
      const stateEvent = paid.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            event.cardInstanceId === scenario.source.instanceId
        );
      const resolved = paid.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_PB1_003_ON_ENTER_WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY_ABILITY_ID &&
          action.payload.step === 'WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY'
      );

      expect(paid.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(stateEvent).toMatchObject({
        cardInstanceId: scenario.source.instanceId,
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
        cause: {
          kind: 'CARD_EFFECT',
          abilityId: PL_PB1_003_ON_ENTER_WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY_ABILITY_ID,
        },
      });
      expect(resolved?.payload).toMatchObject({
        waitedMemberCardId: scenario.source.instanceId,
        printempsMemberCardIds: [scenario.printemps.instanceId, scenario.source.instanceId],
        requestedActivationCount: 2,
        activatedEnergyCardIds: [scenario.energyCards[0]!.instanceId, scenario.energyCards[1]!.instanceId],
      });
      expect(resolved?.payload.memberStateChangedEventIds).toContain(stateEvent?.eventId);
    }
  });

  it('continues to the next pending after payment, and decline consumes this pending without changes', () => {
    const scenario = setup({ includeContinuation: true });
    const paid = chooseOption(start003Pending(scenario.game, scenario.source.instanceId), 'WAIT_SOURCE');
    expect(paid.pendingAbilities).toEqual([]);
    expect(paid.activeEffect).toBeNull();
    expect(paid.players[0].hand.cardIds).toContain(scenario.drawCard.instanceId);
    expect(
      paid.actionHistory.some(
        (action) =>
          action.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID &&
          action.payload.step === 'ON_ENTER_DRAW_ONE' &&
          action.payload.drawnCardIds?.includes(scenario.drawCard.instanceId)
      )
    ).toBe(true);

    const declinedScenario = setup({ includeContinuation: true });
    const declined = chooseOption(start003Pending(declinedScenario.game, declinedScenario.source.instanceId), null);
    expect(declined.activeEffect).toBeNull();
    expect(declined.pendingAbilities).toEqual([]);
    expect(declined.players[0].memberSlots.cardStates.get(declinedScenario.source.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(declined.players[0].energyZone.cardStates.get(declinedScenario.energyCards[0]!.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(declined.players[0].hand.cardIds).toContain(declinedScenario.drawCard.instanceId);
  });

  it('still pays with no waiting energy and safely consumes waiting or removed sources', () => {
    const noEnergy = setup({ energyOrientations: [OrientationState.ACTIVE] });
    const paid = chooseOption(resolvePendingCardEffects(noEnergy.game).gameState, 'WAIT_SOURCE');
    expect(paid.players[0].memberSlots.cardStates.get(noEnergy.source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      paid.actionHistory.find(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY'
      )?.payload.activatedEnergyCardIds
    ).toEqual([]);

    for (const options of [{ sourceOrientation: OrientationState.WAITING }, { sourceOnStage: false }]) {
      const scenario = setup(options);
      const finished = resolvePendingCardEffects(scenario.game).gameState;
      expect(finished.activeEffect).toBeNull();
      expect(finished.pendingAbilities).toEqual([]);
    }
  });
});
