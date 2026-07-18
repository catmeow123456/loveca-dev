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
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_BP1_002_ON_ENTER_LEFT_PAY_TWO_ENERGY_DRAW_TWO_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function member(code: string, id: string) {
  return createCardInstance<MemberCardData>(
    {
      cardCode: code,
      name: id,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    P1,
    id
  );
}

function energy(id: string) {
  return createCardInstance<EnergyCardData>(
    { cardCode: `ENERGY-${id}`, name: id, cardType: CardType.ENERGY },
    P1,
    id
  );
}

function pending(
  sourceCardId: string,
  sourceSlot: SlotPosition,
  id = 'pending-002'
): PendingAbilityState {
  return {
    id,
    abilityId: SP_BP1_002_ON_ENTER_LEFT_PAY_TWO_ENERGY_DRAW_TWO_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage-event'],
    sourceSlot,
  };
}

function setup(
  options: {
    readonly sourceCode?: string;
    readonly sourceSlot?: SlotPosition;
    readonly activeEnergy?: number;
    readonly deckCount?: number;
    readonly waitingCount?: number;
    readonly specialEnergy?: boolean;
  } = {}
) {
  const source = member(options.sourceCode ?? 'PL!SP-bp1-002-P', 'keke-source');
  const energies = Array.from({ length: Math.max(options.activeEnergy ?? 2, 3) }, (_, index) =>
    energy(`energy-${index}`)
  );
  const deck = Array.from({ length: options.deckCount ?? 2 }, (_, index) =>
    member(`DECK-${index}`, `deck-${index}`)
  );
  const waiting = Array.from({ length: options.waitingCount ?? 0 }, (_, index) =>
    member(`WAITING-${index}`, `waiting-${index}`)
  );
  let game = registerCards(createGameState('sp-bp1-002', P1, 'P1', P2, 'P2'), [
    source,
    ...energies,
    ...deck,
    ...waiting,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      player.memberSlots,
      options.sourceSlot ?? SlotPosition.LEFT,
      source.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
    energyZone: energies.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation:
            index < (options.activeEnergy ?? 2)
              ? OrientationState.ACTIVE
              : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      { ...player.energyZone, cardIds: [], cardStates: new Map() }
    ),
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((card) => card.instanceId) },
  }));
  if (options.specialEnergy) {
    game = {
      ...game,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: energies[1]!.instanceId,
          sourceCardId: 'special-energy-marker',
          abilityId: 'special-energy-marker',
        },
      ],
    };
  }
  const sourceSlot = options.sourceSlot ?? SlotPosition.LEFT;
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId, sourceSlot)] },
    source,
    energies,
    deck,
    waiting,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(
  game: GameState,
  optionId?: string,
  selectedCardIds?: readonly string[]
): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    optionId,
    selectedCardIds
  );
}

describe('PL!SP-bp1-002 Keke LEFT on-enter draw', () => {
  it.each(['PL!SP-bp1-002-P', 'PL!SP-bp1-002-P＋', 'PL!SP-bp1-002-R＋', 'PL!SP-bp1-002-SEC'])(
    '%s uses the event LEFT slot and exact player copy',
    (sourceCode) => {
      const scenario = setup({ sourceCode });
      const started = start(scenario.game);
      expect(started.activeEffect).toMatchObject({
        abilityId: SP_BP1_002_ON_ENTER_LEFT_PAY_TWO_ENERGY_DRAW_TWO_ABILITY_ID,
        effectText: '【登场】可以支付[E][E]：若有登场于舞台的左侧区域，则抽2张卡。',
        metadata: { enteredSlot: SlotPosition.LEFT },
        selectableOptions: [{ id: 'pay', label: '支付[E][E]' }],
        canSkipSelection: true,
      });
    }
  );

  it.each([SlotPosition.CENTER, SlotPosition.RIGHT])(
    '%s entry consumes pending without an empty payment window',
    (sourceSlot) => {
      const scenario = setup({ sourceSlot });
      const done = start(scenario.game);
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
      expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    }
  );

  it('keeps the event LEFT decision after the member moves or leaves before resolution', () => {
    for (const mode of ['move', 'leave'] as const) {
      const scenario = setup();
      const started = start(scenario.game);
      const changed = updatePlayer(started, P1, (player) => {
        const withoutLeft = removeCardFromSlot(player.memberSlots, SlotPosition.LEFT);
        return {
          ...player,
          memberSlots:
            mode === 'move'
              ? placeCardInSlot(withoutLeft, SlotPosition.CENTER, scenario.source.instanceId, {
                  orientation: OrientationState.ACTIVE,
                  face: FaceState.FACE_UP,
                })
              : withoutLeft,
        };
      });
      const done = confirm(changed, 'pay');
      expect(done.players[0].hand.cardIds).toHaveLength(2);
      expect(
        done.actionHistory.find((action) => action.type === 'PAY_COST')?.payload
      ).toMatchObject({
        energyCardIds: ['energy-0', 'energy-1'],
        sourceSlot: SlotPosition.LEFT,
      });
    }
  });

  it('decline and insufficient energy never partially pay or draw, and continuation advances', () => {
    const scenario = setup();
    const next = { ...pending(scenario.source.instanceId, SlotPosition.LEFT), id: 'next-pending' };
    const declined = confirm(
      start({ ...scenario.game, pendingAbilities: [scenario.game.pendingAbilities[0]!, next] })
    );
    expect(declined.activeEffect).toMatchObject({ abilityId: 'system:select-pending-card-effect' });
    expect(declined.players[0].hand.cardIds).toEqual([]);
    expect(declined.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);

    const insufficient = start(setup({ activeEnergy: 1 }).game);
    expect(insufficient.activeEffect).toBeNull();
    expect(insufficient.players[0].hand.cardIds).toEqual([]);
    expect(insufficient.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it.each([
    [0, 0, 0],
    [1, 0, 1],
    [2, 0, 2],
    [0, 1, 1],
  ])(
    'draws the actual available count (deck %i, waiting %i)',
    (deckCount, waitingCount, expected) => {
      const scenario = setup({ deckCount, waitingCount });
      const done = confirm(start(scenario.game), 'pay');
      expect(done.players[0].hand.cardIds).toHaveLength(expected);
      const resolvedAction = done.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.step === 'PAY_TWO_ENERGY_DRAW_TWO'
      );
      expect(resolvedAction?.payload).toMatchObject({ drawnCardIds: expect.any(Array) });
      expect((resolvedAction?.payload.drawnCardIds as readonly string[]).length).toBe(expected);
    }
  );

  it('requires exact special-energy selection and rejects forged, duplicate, stale, and repeated input', () => {
    const scenario = setup({ activeEnergy: 3, specialEnergy: true });
    const payWindow = start(scenario.game);
    const energyWindow = confirm(payWindow, 'pay');
    expect(energyWindow.activeEffect).toMatchObject({
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
    const actionCount = energyWindow.actionHistory.length;
    expect(confirm(energyWindow, undefined, ['forged', 'energy-0'])).toBe(energyWindow);
    expect(confirm(energyWindow, undefined, ['energy-0', 'energy-0'])).toBe(energyWindow);
    expect(energyWindow.actionHistory).toHaveLength(actionCount);

    const done = confirm(energyWindow, undefined, ['energy-1', 'energy-2']);
    expect(done.actionHistory.find((action) => action.type === 'PAY_COST')?.payload).toMatchObject({
      energyCardIds: ['energy-1', 'energy-2'],
    });
    expect(confirmActiveEffectStep(done, P1, energyWindow.activeEffect!.id)).toBe(done);
  });
});
