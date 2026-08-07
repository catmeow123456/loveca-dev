import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
const EFFECT_TEXT =
  '【LIVE开始时】可以支付[E]：自己的舞台上存在3名『CatChu!』的成员的场合，抽1张卡。';

function member(
  cardCode: string,
  name: string,
  unitName: string | undefined = 'CatChu!'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp7-015-pending',
    abilityId: SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: false,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: {
    readonly activeEnergy?: boolean;
    readonly catchuCount?: 1 | 2 | 3;
    readonly deckHasCard?: boolean;
  } = {}
) {
  const catchuCount = options.catchuCount ?? 3;
  const source = createCardInstance(
    member('PL!SP-bp7-015-N', '平安名すみれ'),
    PLAYER1,
    'sp-bp7-015-source'
  );
  const catchuLeft = createCardInstance(
    member('PL!SP-test-catchu-left', '澠田千砂都'),
    PLAYER1,
    'sp-bp7-015-catchu-left'
  );
  const right = createCardInstance(
    member(
      'PL!SP-test-right',
      catchuCount === 3 ? '伊達さゆり' : '葉月恋',
      catchuCount === 3 ? 'CatChu!' : 'KALEIDOSCORE'
    ),
    PLAYER1,
    'sp-bp7-015-right'
  );
  const energyCard = createCardInstance(energy('PL!SP-test-energy'), PLAYER1, 'sp-bp7-015-energy');
  const drawCard = createCardInstance(
    member('PL!SP-test-draw', '抽牌目标', 'KALEIDOSCORE'),
    PLAYER1,
    'sp-bp7-015-draw'
  );
  let game = registerCards(createGameState('sp-bp7-015-sumire', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    catchuLeft,
    right,
    energyCard,
    drawCard,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (catchuCount >= 2) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, catchuLeft.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (catchuCount >= 3) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, right.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: {
        ...player.mainDeck,
        cardIds: options.deckHasCard === false ? [] : [drawCard.instanceId],
      },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots,
      energyZone: {
        ...player.energyZone,
        cardIds: [energyCard.instanceId],
        cardStates: new Map([
          [
            energyCard.instanceId,
            {
              orientation:
                options.activeEnergy === false ? OrientationState.WAITING : OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            },
          ],
        ]),
      },
    };
  });
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    source,
    catchuLeft,
    right,
    energyCard,
    drawCard,
  };
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID
    )
    .at(-1)?.payload;
}

function pay(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    'pay'
  );
}

describe('PL!SP-bp7-015 Sumire LIVE_START pay-energy conditional draw workflow', () => {
  it('shows the full definition text and declining leaves the active energy untouched', () => {
    const scenario = setup();
    const paymentWindow = resolvePendingCardEffects(scenario.game).gameState;

    expect(paymentWindow.activeEffect).toMatchObject({
      abilityId: SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID,
      effectText: EFFECT_TEXT,
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const resolved = confirmActiveEffectStep(
      paymentWindow,
      PLAYER1,
      paymentWindow.activeEffect!.id,
      null
    );
    expect(
      resolved.players[0].energyZone.cardStates.get(scenario.energyCard.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'DECLINE_PAY_ENERGY',
      paidEnergyCardIds: [],
    });
  });

  it('pays one active energy, rechecks three CatChu!, draws one, and completes continuation', () => {
    const scenario = setup();
    const paymentWindow = resolvePendingCardEffects(scenario.game).gameState;
    const resolved = pay(paymentWindow);

    expect(
      resolved.players[0].energyZone.cardStates.get(scenario.energyCard.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.drawCard.instanceId]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.find((action) => action.type === 'PAY_COST')?.payload
    ).toMatchObject({
      energyCardIds: [scenario.energyCard.instanceId],
      amount: 1,
    });
    expect(latestPayload(resolved)).toMatchObject({
      step: 'PAY_ENERGY_THREE_CATCHU_DRAW_ONE',
      paidEnergyCardIds: [scenario.energyCard.instanceId],
      catchuMemberCount: 3,
      conditionMet: true,
      drawnCardIds: [scenario.drawCard.instanceId],
    });
  });

  it('keeps the legal energy payment when the CatChu! condition becomes false before payment', () => {
    const scenario = setup();
    let paymentWindow = resolvePendingCardEffects(scenario.game).gameState;
    paymentWindow = updatePlayer(paymentWindow, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.RIGHT]: null },
        cardStates: new Map(player.memberSlots.cardStates),
      },
    }));

    const resolved = pay(paymentWindow);
    expect(
      resolved.players[0].energyZone.cardStates.get(scenario.energyCard.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(true);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'PAY_ENERGY_CATCHU_CONDITION_NOT_MET',
      catchuMemberCount: 2,
      conditionMet: false,
      drawnCardIds: [],
    });
  });

  it('keeps the legal energy payment when the condition is met but no card can be drawn', () => {
    const scenario = setup({ deckHasCard: false });
    const resolved = pay(resolvePendingCardEffects(scenario.game).gameState);

    expect(
      resolved.players[0].energyZone.cardStates.get(scenario.energyCard.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(true);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'PAY_ENERGY_THREE_CATCHU_DRAW_ONE',
      catchuMemberCount: 3,
      conditionMet: true,
      drawnCardIds: [],
    });
  });

  it('consumes the pending ability without a payment window when no active energy exists', () => {
    const scenario = setup({ activeEnergy: false });
    const resolved = resolvePendingCardEffects(scenario.game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'NO_ACTIVE_ENERGY_FOR_COST',
      paidEnergyCardIds: [],
    });
  });
});
