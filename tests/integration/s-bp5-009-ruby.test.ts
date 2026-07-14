import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  CardInstance,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
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
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_S_BP5_009_ON_ENTER_PAY_ENERGY_RECOVER_SAINTSNOW_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
const ABILITY_ID =
  PL_S_BP5_009_ON_ENTER_PAY_ENERGY_RECOVER_SAINTSNOW_GAIN_TWO_BLADE_ABILITY_ID;

function member(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 15,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
    bladeHearts: [],
  };
}

function live(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['SaintSnow'],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    bladeHearts: [],
  };
}

function energy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function instance<TData extends AnyCardData>(
  data: TData,
  id: string,
  ownerId = PLAYER1
): CardInstance<TData> {
  return createCardInstance(data, ownerId, id);
}

function pending(sourceCardId: string, id = 's-bp5-009-pending'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event:${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: {
  readonly energyCount?: number;
  readonly waitingCards?: readonly CardInstance[];
  readonly extraPending?: readonly PendingAbilityState[];
} = {}) {
  const source = instance(member('PL!S-bp5-009-R', { name: '黒澤ルビィ' }), 'ruby-source');
  const energyCards = Array.from({ length: options.energyCount ?? 1 }, (_, index) =>
    instance(energy(`ENERGY-${index + 1}`), `energy-${index + 1}`)
  );
  const waitingCards =
    options.waitingCards ??
    [
      instance(
        member('PL!S-test-saintsnow-member', {
          name: '鹿角聖良',
          groupNames: ['SaintSnow'],
        }),
        'saintsnow-member'
      ),
    ];

  let game = registerCards(
    createGameState('s-bp5-009-ruby', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...energyCards, ...waitingCards]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card) => [
          card.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ])
      ),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));

  return {
    game: {
      ...game,
      pendingAbilities: [pending(source.instanceId), ...(options.extraPending ?? [])],
    },
    source,
    energyCards,
    waitingCards,
  };
}

function startEffect(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function choosePay(game: GameState): GameState {
  const effect = game.activeEffect!;
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    PLAYER1,
    effect.id,
    undefined,
    undefined,
    undefined,
    'pay'
  );
}

function chooseDecline(game: GameState): GameState {
  const effect = game.activeEffect!;
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, effect.id, null);
}

function chooseWaitingRoomCard(game: GameState, cardId: string): GameState {
  const effect = game.activeEffect!;
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, effect.id, cardId);
}

function removeSourceFromStage(game: GameState, sourceCardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [...player.waitingRoom.cardIds, sourceCardId],
    },
  }));
}

describe('PL!S-bp5-009 黒澤ルビィ', () => {
  it('opens an optional pay-energy window and does not pay before confirmation', () => {
    const { game, energyCards } = setup();

    const started = startEffect(game);
    const player = started.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(started.activeEffect?.selectableOptions).toEqual([{ id: 'pay', label: '支付[E]' }]);
    expect(started.activeEffect?.canSkipSelection).toBe(true);
    expect(started.activeEffect?.skipSelectionLabel).toBe('不发动');
    expect(player.energyZone.cardStates.get(energyCards[0]!.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(started.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('declines without paying, recovering, or adding BLADE', () => {
    const { game, energyCards, waitingCards } = setup();

    const skipped = chooseDecline(startEffect(game));
    const player = skipped.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(skipped.activeEffect).toBeNull();
    expect(player.energyZone.cardStates.get(energyCards[0]!.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(player.waitingRoom.cardIds).toEqual([waitingCards[0]!.instanceId]);
    expect(player.hand.cardIds).toEqual([]);
    expect(skipped.liveResolution.liveModifiers).toEqual([]);
  });

  it('pays one active energy, recovers a SaintSnow card, and gives source BLADE +2', () => {
    const { game, energyCards, waitingCards, source } = setup();

    let state = choosePay(startEffect(game));
    expect(state.activeEffect?.selectableCardIds).toEqual([waitingCards[0]!.instanceId]);
    expect(
      state.players[0].energyZone.cardStates.get(energyCards[0]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);

    state = chooseWaitingRoomCard(state, waitingCards[0]!.instanceId);
    const player = state.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(state.activeEffect).toBeNull();
    expect(player.waitingRoom.cardIds).toEqual([]);
    expect(player.hand.cardIds).toEqual([waitingCards[0]!.instanceId]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: ABILITY_ID,
    });
  });

  it('allows both SaintSnow member and LIVE cards as waiting-room candidates only', () => {
    const saintSnowMember = instance(
      member('PL!S-test-saintsnow-member', {
        name: '鹿角理亞',
        groupNames: ['SaintSnow'],
      }),
      'saintsnow-member'
    );
    const saintSnowLive = instance(live('PL!S-test-saintsnow-live'), 'saintsnow-live');
    const aqoursMember = instance(
      member('PL!S-test-aqours-member', { groupNames: ['Aqours'] }),
      'aqours-member'
    );
    const { game } = setup({
      waitingCards: [saintSnowMember, saintSnowLive, aqoursMember],
    });

    const paid = choosePay(startEffect(game));

    expect(paid.activeEffect?.selectableCardIds).toEqual([
      saintSnowMember.instanceId,
      saintSnowLive.instanceId,
    ]);
  });

  it('consumes safely without paying when there is no active energy', () => {
    const { game, waitingCards } = setup({ energyCount: 0 });

    const resolved = startEffect(game);
    const player = resolved.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(player.waitingRoom.cardIds).toEqual([waitingCards[0]!.instanceId]);
    expect(player.hand.cardIds).toEqual([]);
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('consumes safely without paying when there is no SaintSnow target', () => {
    const aqoursMember = instance(
      member('PL!S-test-aqours-member', { groupNames: ['Aqours'] }),
      'aqours-member'
    );
    const { game, energyCards } = setup({ waitingCards: [aqoursMember] });

    const resolved = startEffect(game);
    const player = resolved.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(resolved.activeEffect).toBeNull();
    expect(player.energyZone.cardStates.get(energyCards[0]!.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(player.hand.cardIds).toEqual([]);
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('still recovers after payment if the source has left stage, but does not write BLADE', () => {
    const { game, waitingCards, source } = setup();

    let state = choosePay(startEffect(game));
    state = removeSourceFromStage(state, source.instanceId);
    state = chooseWaitingRoomCard(state, waitingCards[0]!.instanceId);
    const player = state.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(player.hand.cardIds).toEqual([waitingCards[0]!.instanceId]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('rejects an expired waiting-room target without moving it', () => {
    const { game, waitingCards } = setup();

    let state = choosePay(startEffect(game));
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [],
      },
      mainDeck: {
        ...player.mainDeck,
        cardIds: [waitingCards[0]!.instanceId],
      },
    }));

    const rejected = chooseWaitingRoomCard(state, waitingCards[0]!.instanceId);
    const player = rejected.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(rejected.activeEffect).toBe(state.activeEffect);
    expect(player.hand.cardIds).toEqual([]);
    expect(player.mainDeck.cardIds).toEqual([waitingCards[0]!.instanceId]);
  });
});
