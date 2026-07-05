import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { N_BP5_005_AUTO_RELAY_REPLACED_NIJIGASAKI_NO_BLADE_HEART_ACTIVATE_ENERGY_DRAW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createAi(): MemberCardData {
  return {
    cardCode: 'PL!N-bp5-005-R＋',
    name: '宮下 愛',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createReplacement(options: {
  readonly cost: number;
  readonly cardCode?: string;
  readonly groupNames?: readonly string[];
  readonly hasBladeHeart?: boolean;
}): MemberCardData {
  return {
    cardCode: options.cardCode ?? 'PL!N-bp5-005-REPLACEMENT',
    name: 'Relay Replacement',
    groupNames: options.groupNames ?? ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: options.cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: options.hasBladeHeart
      ? [{ effect: BladeHeartEffect.DRAW }]
      : [],
  };
}

function createEnergy(index: number): EnergyCardData {
  return {
    cardCode: `N-BP5-005-ENERGY-${index}`,
    name: `Energy ${index}`,
    cardType: CardType.ENERGY,
  };
}

function createDeckMember(index: number): MemberCardData {
  return {
    cardCode: `N-BP5-005-DECK-${index}`,
    name: `Deck ${index}`,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function setupAiScenario(options: {
  readonly replacementCost?: number;
  readonly replacementCardCode?: string;
  readonly replacementGroupNames?: readonly string[];
  readonly replacementHasBladeHeart?: boolean;
  readonly energyOrientations?: readonly OrientationState[];
  readonly mainDeckCount?: number;
  readonly sourceInWaitingRoom?: boolean;
  readonly metadataToZone?: ZoneType | null;
  readonly includeReplacingCardId?: boolean;
  readonly costModifier?: number;
}): GameState {
  const source = createCardInstance(createAi(), PLAYER1, 'n-bp5-005-source');
  const replacement = createCardInstance(
    createReplacement({
      cost: options.replacementCost ?? 10,
      cardCode: options.replacementCardCode,
      groupNames: options.replacementGroupNames,
      hasBladeHeart: options.replacementHasBladeHeart,
    }),
    PLAYER1,
    'n-bp5-005-replacement'
  );
  const energyCards = (options.energyOrientations ?? [
    OrientationState.WAITING,
    OrientationState.WAITING,
  ]).map((_, index) =>
    createCardInstance(createEnergy(index), PLAYER1, `n-bp5-005-energy-${index}`)
  );
  const deckCards = Array.from({ length: options.mainDeckCount ?? 1 }, (_, index) =>
    createCardInstance(createDeckMember(index), PLAYER1, `n-bp5-005-deck-${index}`)
  );

  let game = createGameState('n-bp5-005-ai', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, replacement, ...energyCards, ...deckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, replacement.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.sourceInWaitingRoom === false ? [] : [source.instanceId],
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation: options.energyOrientations?.[index] ?? OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    mainDeck: {
      ...player.mainDeck,
      cardIds: deckCards.map((card) => card.instanceId),
    },
  }));
  if (options.costModifier !== undefined) {
    game = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: replacement.instanceId,
      sourceCardId: replacement.instanceId,
      abilityId: 'test-cost-modifier',
      countDelta: options.costModifier,
    });
  }
  return {
    ...game,
    pendingAbilities: [
      {
        id: 'n-bp5-005-leave-stage',
        abilityId:
          N_BP5_005_AUTO_RELAY_REPLACED_NIJIGASAKI_NO_BLADE_HEART_ACTIVATE_ENERGY_DRAW_ABILITY_ID,
        sourceCardId: source.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LEAVE_STAGE,
        eventIds: ['n-bp5-005-leave-stage-event'],
        sourceSlot: SlotPosition.CENTER,
        metadata: {
          toZone: options.metadataToZone === undefined ? ZoneType.WAITING_ROOM : options.metadataToZone,
          replacingCardId:
            options.includeReplacingCardId === false ? null : replacement.instanceId,
        },
      },
    ],
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function energyOrientations(game: GameState): readonly (OrientationState | undefined)[] {
  const player = game.players[0]!;
  return player.energyZone.cardIds.map(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation
  );
}

function resolveStep(game: GameState): string | undefined {
  return game.actionHistory.find(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        N_BP5_005_AUTO_RELAY_REPLACED_NIJIGASAKI_NO_BLADE_HEART_ACTIVATE_ENERGY_DRAW_ABILITY_ID
  )?.payload.step as string | undefined;
}

describe('PL!N-bp5-005 Ai ON_LEAVE_STAGE relay replacement workflow', () => {
  it('activates two waiting energy when the relay replacement is a cost 10+ Nijigasaki member without Blade Heart', () => {
    const result = resolve(setupAiScenario({ replacementCost: 10 }));

    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(energyOrientations(result)).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(result.players[0]!.hand.cardIds).toEqual([]);
    expect(resolveStep(result)).toBe('ACTIVATE_ENERGY_DRAW_BY_RELAY_REPLACEMENT');
  });

  it('activates energy and draws one card when the relay replacement is cost 15+', () => {
    const result = resolve(
      setupAiScenario({
        replacementCost: 15,
        energyOrientations: [OrientationState.WAITING, OrientationState.WAITING],
        mainDeckCount: 1,
      })
    );

    expect(energyOrientations(result)).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(result.players[0]!.hand.cardIds).toEqual(['n-bp5-005-deck-0']);
    expect(result.players[0]!.mainDeck.cardIds).toEqual(['n-bp5-005-source']);
  });

  it('does not apply when cost is too low, group is not Nijigasaki, replacement has Blade Heart, replacingCardId is missing, or source did not enter waiting room', () => {
    for (const options of [
      { label: 'cost below 10', replacementCost: 9 },
      {
        label: 'not Nijigasaki',
        replacementCost: 10,
        replacementCardCode: 'PL!SP-bp5-005-REPLACEMENT',
        replacementGroupNames: ['Liella!'],
      },
      { label: 'has Blade Heart', replacementCost: 10, replacementHasBladeHeart: true },
      { label: 'missing replacingCardId', replacementCost: 10, includeReplacingCardId: false },
      { label: 'source not to waiting room', replacementCost: 10, metadataToZone: ZoneType.HAND },
    ] as const) {
      const result = resolve(setupAiScenario(options));

      expect(result.pendingAbilities).toEqual([]);
      expect(energyOrientations(result)).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
      expect(result.players[0]!.hand.cardIds).toEqual([]);
      expect({ label: options.label, step: resolveStep(result) }).not.toMatchObject({
        step: 'ACTIVATE_ENERGY_DRAW_BY_RELAY_REPLACEMENT',
      });
    }
  });

  it('uses effective cost modifiers so a cost 14 replacement can reach the cost 15 draw threshold', () => {
    const result = resolve(
      setupAiScenario({
        replacementCost: 14,
        costModifier: 1,
        mainDeckCount: 1,
      })
    );

    expect(energyOrientations(result)).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(result.players[0]!.hand.cardIds).toEqual(['n-bp5-005-deck-0']);
  });

  it('does not fail when there are no waiting energy cards and still draws for a cost 15+ replacement', () => {
    const result = resolve(
      setupAiScenario({
        replacementCost: 15,
        energyOrientations: [OrientationState.ACTIVE, OrientationState.ACTIVE],
        mainDeckCount: 1,
      })
    );

    expect(energyOrientations(result)).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(result.players[0]!.hand.cardIds).toEqual(['n-bp5-005-deck-0']);
    expect(
      result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_005_AUTO_RELAY_REPLACED_NIJIGASAKI_NO_BLADE_HEART_ACTIVATE_ENERGY_DRAW_ABILITY_ID
      )?.payload.activatedEnergyCardIds
    ).toEqual([]);
  });
});
