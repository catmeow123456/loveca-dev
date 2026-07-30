import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID,
  HS_BP8_001_ON_ENTER_MILL_THREE_ALL_CERISE_ACTIVATE_ENERGY_ABILITY_ID,
  S_BP7_007_LIVE_START_BOTTOM_AQOURS_MEMBERS_GAIN_BLADE_ABILITY_ID,
  S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  createCardInstance,
  createHeartIcon,
  type EnergyCardData,
  type MemberCardData,
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
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';

const P1 = 'p1';
const P2 = 'p2';
const HANAMARU_ENTER = S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID;
const HANAMARU_LIVE_START = S_BP7_007_LIVE_START_BOTTOM_AQOURS_MEMBERS_GAIN_BLADE_ABILITY_ID;
const KAHO_ENTER = HS_BP8_001_ON_ENTER_MILL_THREE_ALL_CERISE_ACTIVATE_ENERGY_ABILITY_ID;
const KAHO_AUTO = HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID;

function member(
  cardCode: string,
  instanceId: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly ownerId?: string;
  } = {}
) {
  const data: MemberCardData = {
    cardCode,
    name: options.name ?? instanceId,
    groupNames: options.groupNames ?? ['Aqours'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
  return createCardInstance(data, options.ownerId ?? P1, instanceId);
}

function energy(instanceId: string) {
  const data: EnergyCardData = {
    cardCode: `ENERGY-${instanceId}`,
    name: instanceId,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, P1, instanceId);
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  suffix = 'main'
): PendingAbilityState {
  return {
    id: `${abilityId}:${suffix}`,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function bladeModifiers(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === abilityId
  );
}

describe('PL!S-bp7-007-SEC 费用11「国木田花丸」', () => {
  it('registers both abilities by base card number', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!S-bp7-007-SEC')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: HANAMARU_ENTER,
          baseCardCodes: ['PL!S-bp7-007'],
          category: CardAbilityCategory.ON_ENTER,
          sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
          triggerCondition: TriggerCondition.ON_ENTER_STAGE,
          implemented: true,
        }),
        expect.objectContaining({
          abilityId: HANAMARU_LIVE_START,
          category: CardAbilityCategory.LIVE_START,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          triggerCondition: TriggerCondition.ON_LIVE_START,
          implemented: true,
        }),
      ])
    );
    expect(getCardAbilityDefinitionsForCardCode('PL!S-bp7-007-R')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ abilityId: HANAMARU_ENTER }),
        expect.objectContaining({ abilityId: HANAMARU_LIVE_START }),
      ])
    );
  });

  it('recovers a low-cost Yoshiko through public confirmation, then optionally plays her to an empty slot', () => {
    const hanamaru = member('PL!S-bp7-007-SEC', 'hanamaru', {
      name: '国木田花丸',
      cost: 11,
    });
    const yoshiko = member('TEST-YOSHIKO', 'yoshiko', {
      name: '津島善子',
      cost: 2,
    });
    let game = registerCards(createGameState('hanamaru-enter', P1, 'P1', P2, 'P2'), [
      hanamaru,
      yoshiko,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanamaru.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      waitingRoom: addCardToStatefulZone(player.waitingRoom, yoshiko.instanceId),
    }));
    game = resolve({
      ...game,
      pendingAbilities: [
        pending(HANAMARU_ENTER, hanamaru.instanceId, TriggerCondition.ON_ENTER_STAGE),
      ],
    });
    expect(game.activeEffect).toMatchObject({
      selectableCardIds: [yoshiko.instanceId],
      selectableCardVisibility: 'PUBLIC',
      canSkipSelection: false,
    });

    game = confirmActiveEffectStepThroughPublicReveal(
      game,
      P1,
      game.activeEffect!.id,
      yoshiko.instanceId
    );
    expect(game.players[0].hand.cardIds).toContain(yoshiko.instanceId);
    expect(game.activeEffect).toMatchObject({
      stepId: 'S_BP7_007_DECIDE_PLAY_RECOVERED_MEMBER',
      selectableOptions: [{ id: 'play', label: '登场' }],
      canSkipSelection: true,
    });

    game = confirmActiveEffectStep(
      game,
      P1,
      game.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'play'
    );
    expect(game.activeEffect).toMatchObject({
      stepId: 'S_BP7_007_SELECT_EMPTY_STAGE_SLOT',
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
    });
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, undefined, SlotPosition.LEFT);
    expect(game.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(yoshiko.instanceId);
    expect(game.players[0].hand.cardIds).not.toContain(yoshiko.instanceId);
    expect(
      game.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          event.cardInstanceId === yoshiko.instanceId
      )
    ).toBe(true);
  });
});

describe('PL!HS-bp8-001-P 费用13「日野下花帆」', () => {
  it('registers both abilities by base card number, including the once-per-turn AUTO', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!HS-bp8-001-P')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: KAHO_ENTER,
          baseCardCodes: ['PL!HS-bp8-001'],
          category: CardAbilityCategory.ON_ENTER,
          sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
          triggerCondition: TriggerCondition.ON_ENTER_STAGE,
          implemented: true,
        }),
        expect.objectContaining({
          abilityId: KAHO_AUTO,
          category: CardAbilityCategory.AUTO,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          triggerCondition: TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK,
          perTurnLimit: 1,
          skipQueueWhenTurnLimitReached: true,
          implemented: true,
        }),
      ])
    );
    expect(getCardAbilityDefinitionsForCardCode('PL!HS-bp8-001-R')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ abilityId: KAHO_ENTER }),
        expect.objectContaining({ abilityId: KAHO_AUTO }),
      ])
    );
  });

  it('mills the real top three and activates two energy only when all three are Cerise Bouquet', () => {
    const kaho = member('PL!HS-bp8-001-P', 'kaho', {
      name: '日野下花帆',
      cost: 13,
      groupNames: ['蓮ノ空'],
      unitName: 'Cerise Bouquet',
    });
    const deckCards = ['a', 'b', 'c'].map((id) =>
      member(`CERISE-${id}`, `cerise-${id}`, {
        groupNames: ['蓮ノ空'],
        unitName: 'スリーズブーケ',
      })
    );
    const energies = [energy('energy-1'), energy('energy-2')];
    let game = registerCards(createGameState('kaho-enter', P1, 'P1', P2, 'P2'), [
      kaho,
      ...deckCards,
      ...energies,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kaho.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
      energyZone: energies.reduce(
        (zone, card) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    }));
    game = resolve({
      ...game,
      pendingAbilities: [pending(KAHO_ENTER, kaho.instanceId, TriggerCondition.ON_ENTER_STAGE)],
    });
    expect(game.activeEffect).toMatchObject({
      stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
      revealedCardIds: deckCards.map((card) => card.instanceId),
    });
    expect(
      game.actionHistory.findLast((action) => action.payload.step === 'MILL_TOP_THREE')?.payload
    ).toMatchObject({
      milledCardIds: deckCards.map((card) => card.instanceId),
      refreshCount: 1,
      allCeriseBouquet: true,
    });
    expect(
      game.eventLog
        .map((entry) => entry.event)
        .find((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)
    ).toMatchObject({
      cardInstanceIds: deckCards.map((card) => card.instanceId),
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: kaho.instanceId,
        abilityId: KAHO_ENTER,
      },
    });

    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id);
    expect(
      energies.map(
        (card) => game.players[0].energyZone.cardStates.get(card.instanceId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
  });

  it('is triggered by Hanamaru’s real waiting-room-to-deck workflow and gains exactly three BLADE', () => {
    const hanamaru = member('PL!S-bp7-007-SEC', 'hanamaru-link', {
      name: '国木田花丸',
      cost: 11,
    });
    const kaho = member('PL!HS-bp8-001-P', 'kaho-link', {
      name: '日野下花帆',
      cost: 13,
      groupNames: ['蓮ノ空'],
      unitName: 'Cerise Bouquet',
    });
    const aqours = ['one', 'two', 'three'].map((id) =>
      member(`AQOURS-${id}`, `aqours-${id}`, { groupNames: ['Aqours'] })
    );
    let game = registerCards(createGameState('hanamaru-kaho-link', P1, 'P1', P2, 'P2'), [
      hanamaru,
      kaho,
      ...aqours,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanamaru.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        kaho.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: aqours.map((card) => card.instanceId),
      },
    }));
    game = resolve({
      ...game,
      pendingAbilities: [
        pending(HANAMARU_LIVE_START, hanamaru.instanceId, TriggerCondition.ON_LIVE_START),
      ],
    });
    const selectedIds = aqours
      .slice(0, 2)
      .map((card) => card.instanceId)
      .reverse();
    game = confirmActiveEffectStepThroughPublicReveal(
      game,
      P1,
      game.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedIds
    );

    const movementEvent = game.eventLog
      .map((entry) => entry.event)
      .find(
        (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      );
    expect(movementEvent).toMatchObject({
      playerId: P1,
      movedCardIds: selectedIds,
      destination: { kind: 'BOTTOM' },
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: hanamaru.instanceId,
        abilityId: HANAMARU_LIVE_START,
      },
    });

    game = resolve(game);
    if (game.activeEffect?.abilityId === KAHO_AUTO) {
      game = confirmActiveEffectStep(game, P1, game.activeEffect.id);
    }
    game = resolve(game);
    expect(game.players[0].mainDeck.cardIds).toEqual(selectedIds);
    expect(bladeModifiers(game, HANAMARU_LIVE_START)).toEqual([
      expect.objectContaining({
        sourceCardId: hanamaru.instanceId,
        countDelta: 2,
      }),
    ]);
    expect(bladeModifiers(game, KAHO_AUTO)).toEqual([
      expect.objectContaining({
        sourceCardId: kaho.instanceId,
        countDelta: 3,
      }),
    ]);
    expect(
      game.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === KAHO_AUTO &&
          action.payload.step === 'WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE'
      )
    ).toHaveLength(1);

    game = resolve({
      ...game,
      pendingAbilities: [
        pending(
          HANAMARU_LIVE_START,
          hanamaru.instanceId,
          TriggerCondition.ON_LIVE_START,
          'second-real-move'
        ),
      ],
    });
    game = confirmActiveEffectStepThroughPublicReveal(
      game,
      P1,
      game.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [aqours[2]!.instanceId]
    );
    game = resolve(game);
    expect(
      game.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
    ).toHaveLength(2);
    expect(bladeModifiers(game, KAHO_AUTO)).toHaveLength(1);
    expect(
      game.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === KAHO_AUTO &&
          action.payload.step === 'WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE'
      )
    ).toHaveLength(1);
  });
});
