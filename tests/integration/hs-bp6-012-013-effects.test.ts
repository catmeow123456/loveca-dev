import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
  HS_BP6_013_LIVE_START_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
  HS_BP6_013_ON_ENTER_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
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

function createMember(
  cardCode: string,
  name = cardCode,
  options: {
    readonly unitName?: string;
    readonly cost?: number;
    readonly blade?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function baseGame(testId: string): GameState {
  return createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2');
}

function stageMember(
  game: GameState,
  playerId: string,
  cardId: string,
  slot: SlotPosition,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function withPending(
  game: GameState,
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): GameState {
  return {
    ...game,
    pendingAbilities: [
      {
        id: `${abilityId}:${sourceCardId}:pending`,
        abilityId,
        sourceCardId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId,
        eventIds: ['manual-event'],
      },
    ],
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(game: GameState, selectedCardId?: string | null): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

describe('PL!HS-bp6-012 Ginko workflow', () => {
  function setupGinko(options: {
    readonly hasOtherCerise: boolean;
    readonly energyOrientations: readonly OrientationState[];
  }) {
    const source = createCardInstance(
      createMember('PL!HS-bp6-012-R', '百生 吟子', { unitName: 'Cerise Bouquet' }),
      PLAYER1,
      'bp6-012-source'
    );
    const other = createCardInstance(
      createMember('PL!HS-bp6-012-other', 'Other Cerise', { unitName: 'スリーズブーケ' }),
      PLAYER1,
      'bp6-012-other'
    );
    const energyCards = options.energyOrientations.map((_, index) =>
      createCardInstance(
        createEnergy(`BP6-012-ENERGY-${index}`),
        PLAYER1,
        `bp6-012-energy-${index}`
      )
    );
    let game = registerCards(baseGame('bp6-012-ginko'), [source, other, ...energyCards]);
    game = stageMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER);
    if (options.hasOtherCerise) {
      game = stageMember(game, PLAYER1, other.instanceId, SlotPosition.LEFT);
    }
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: energyCards.reduce(
        (zone, card, index) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: options.energyOrientations[index],
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    }));

    return {
      game,
      sourceId: source.instanceId,
      energyCardIds: energyCards.map((card) => card.instanceId),
    };
  }

  it('activates exactly one waiting energy when another Cerise Bouquet member is on own stage', () => {
    const scenario = setupGinko({
      hasOtherCerise: true,
      energyOrientations: [
        OrientationState.WAITING,
        OrientationState.WAITING,
        OrientationState.ACTIVE,
      ],
    });

    const state = resolve(
      withPending(
        scenario.game,
        HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_ENTER_STAGE
      )
    );

    expect(
      scenario.energyCardIds.map(
        (cardId) => state.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.WAITING, OrientationState.ACTIVE]);
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID
      )?.payload.activatedEnergyCardIds
    ).toEqual([scenario.energyCardIds[0]]);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('no-ops when there is no other Cerise Bouquet member', () => {
    const scenario = setupGinko({
      hasOtherCerise: false,
      energyOrientations: [OrientationState.WAITING],
    });

    const state = resolve(
      withPending(
        scenario.game,
        HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_ENTER_STAGE
      )
    );

    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.actionHistory.at(-1)?.payload.step).toBe('NO_OTHER_CERISE_BOUQUET_MEMBER');
    expect(state.pendingAbilities).toEqual([]);
  });

  it('no-ops when the condition is met but there is no waiting energy', () => {
    const scenario = setupGinko({
      hasOtherCerise: true,
      energyOrientations: [OrientationState.ACTIVE],
    });

    const state = resolve(
      withPending(
        scenario.game,
        HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_ENTER_STAGE
      )
    );

    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.actionHistory.at(-1)?.payload.step).toBe('NO_WAITING_ENERGY');
    expect(state.pendingAbilities).toEqual([]);
  });
});

describe('PL!HS-bp6-013 Kosuzu workflow', () => {
  function setupKosuzu(options: { readonly rightTarget?: 'highBlade' | 'waiting' } = {}) {
    const source = createCardInstance(
      createMember('PL!HS-bp6-013-R', '徒町 小鈴', { unitName: 'DOLLCHESTRA', blade: 3 }),
      PLAYER1,
      'bp6-013-source'
    );
    const legal = createCardInstance(
      createMember('PL!HS-bp6-013-legal', 'Legal target', {
        unitName: 'スリーズブーケ',
        blade: 3,
      }),
      PLAYER2,
      'bp6-013-legal'
    );
    const dollchestra = createCardInstance(
      createMember('PL!HS-bp6-013-dollchestra', 'Doll target', {
        unitName: 'DOLLCHESTRA',
        blade: 1,
      }),
      PLAYER2,
      'bp6-013-dollchestra'
    );
    const highBlade = createCardInstance(
      createMember('PL!HS-bp6-013-high-blade', 'High blade target', {
        unitName: 'スリーズブーケ',
        blade: 4,
      }),
      PLAYER2,
      'bp6-013-high-blade'
    );
    const alreadyWaiting = createCardInstance(
      createMember('PL!HS-bp6-013-waiting', 'Waiting target', {
        unitName: 'みらくらぱーく！',
        blade: 2,
      }),
      PLAYER2,
      'bp6-013-waiting'
    );
    let game = registerCards(baseGame('bp6-013-kosuzu'), [
      source,
      legal,
      dollchestra,
      highBlade,
      alreadyWaiting,
    ]);
    game = stageMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER);
    game = stageMember(game, PLAYER2, legal.instanceId, SlotPosition.LEFT);
    game = stageMember(game, PLAYER2, dollchestra.instanceId, SlotPosition.CENTER);
    game =
      options.rightTarget === 'highBlade'
        ? stageMember(game, PLAYER2, highBlade.instanceId, SlotPosition.RIGHT)
        : stageMember(
            game,
            PLAYER2,
            alreadyWaiting.instanceId,
            SlotPosition.RIGHT,
            OrientationState.WAITING
          );

    return {
      game,
      sourceId: source.instanceId,
      legalId: legal.instanceId,
      dollchestraId: dollchestra.instanceId,
      highBladeId: highBlade.instanceId,
      alreadyWaitingId: alreadyWaiting.instanceId,
    };
  }

  it('ON_ENTER selects only a legal opponent member and enqueues member-state change', () => {
    const scenario = setupKosuzu({ rightTarget: 'highBlade' });
    let state = resolve(
      withPending(
        scenario.game,
        HS_BP6_013_ON_ENTER_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_ENTER_STAGE
      )
    );

    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.legalId]);
    expect(state.activeEffect?.selectableCardIds).not.toContain(scenario.dollchestraId);
    expect(state.activeEffect?.selectableCardIds).not.toContain(scenario.highBladeId);

    state = confirm(state, scenario.legalId);

    expect(state.players[1].memberSlots.cardStates.get(scenario.legalId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.legalId
      )
    ).toBe(true);
  });

  it('excludes opponent members that are already WAITING', () => {
    const scenario = setupKosuzu({ rightTarget: 'waiting' });
    const state = resolve(
      withPending(
        scenario.game,
        HS_BP6_013_ON_ENTER_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_ENTER_STAGE
      )
    );

    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.legalId]);
    expect(state.activeEffect?.selectableCardIds).not.toContain(scenario.alreadyWaitingId);
  });

  it('LIVE_START uses the same legal target selection without an extra confirm-only prompt', () => {
    const scenario = setupKosuzu();
    let state = resolve(
      withPending(
        scenario.game,
        HS_BP6_013_LIVE_START_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.legalId]);

    state = confirm(state, scenario.legalId);

    expect(state.players[1].memberSlots.cardStates.get(scenario.legalId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('LIVE_START no-target path opens confirm-only with realtime condition text', () => {
    const scenario = setupKosuzu();
    let state = updatePlayer(scenario.game, PLAYER2, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(
          [...player.memberSlots.cardStates].map(([cardId, cardState]) => [
            cardId,
            { ...cardState, orientation: OrientationState.WAITING },
          ])
        ),
      },
    }));
    state = resolve(
      withPending(
        state,
        HS_BP6_013_LIVE_START_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(state.activeEffect?.effectText).toContain('当前合法目标0名');
    expect(state.activeEffect?.effectText).toContain('不会将成员变为待机状态');

    state = confirm(state);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[1].memberSlots.cardStates.get(scenario.legalId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });
});
