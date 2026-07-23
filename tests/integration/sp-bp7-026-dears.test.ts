import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
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
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP7_026_LIVE_START_RETURN_ONE_ENERGY_REN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'dears-source';
const ABILITY_ID = SP_BP7_026_LIVE_START_RETURN_ONE_ENERGY_REN_DRAW_TWO_DISCARD_ONE_ABILITY_ID;
const EFFECT_TEXT =
  '【LIVE开始时】可以将存在于能量区的1张能量放置入能量卡组：自己的舞台上存在「叶月恋」的场合，抽2张卡，将1张手牌放置入休息室。';
const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

interface SetupOptions {
  readonly sourceCode?: string;
  readonly sourceOwnerId?: string;
  readonly sourceInLiveZone?: boolean;
  readonly energyOrientations?: readonly OrientationState[];
  readonly markedEnergyIndexes?: readonly number[];
  readonly ownStageNames?: readonly string[];
  readonly ownStageCardCodes?: readonly string[];
  readonly ownStageOrientations?: readonly OrientationState[];
  readonly opponentStageNames?: readonly string[];
  readonly belowName?: string;
  readonly handCount?: number;
  readonly deckCount?: number;
  readonly withPending?: boolean;
}

function liveData(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: 'Dears',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
}

function memberData(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function pending(id = 'dears-pending'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [],
  };
}

function setup(options: SetupOptions = {}): GameState {
  const source = createCardInstance(
    liveData(options.sourceCode ?? 'PL!SP-bp7-026-L'),
    options.sourceOwnerId ?? P1,
    SOURCE_ID
  );
  const energies = (options.energyOrientations ?? [OrientationState.ACTIVE]).map(
    (orientation, index) => ({
      orientation,
      card: createCardInstance(
        {
          cardCode: `ENERGY-${index}`,
          name: `Energy ${index}`,
          cardType: CardType.ENERGY,
        },
        P1,
        `energy-${index}`
      ),
    })
  );
  const ownStage = (options.ownStageNames ?? []).map((name, index) => ({
    card: createCardInstance(
      memberData(options.ownStageCardCodes?.[index] ?? `OWN-MEMBER-${index}`, name),
      P1,
      `own-member-${index}`
    ),
    orientation: options.ownStageOrientations?.[index] ?? OrientationState.ACTIVE,
  }));
  const opponentStage = (options.opponentStageNames ?? []).map((name, index) =>
    createCardInstance(memberData(`OPPONENT-MEMBER-${index}`, name), P2, `opponent-member-${index}`)
  );
  const below = options.belowName
    ? createCardInstance(memberData('BELOW-MEMBER', options.belowName), P1, 'below-member')
    : null;
  const hand = Array.from({ length: options.handCount ?? 0 }, (_, index) =>
    createCardInstance(memberData(`HAND-${index}`, `Hand ${index}`), P1, `hand-${index}`)
  );
  const deck = Array.from({ length: options.deckCount ?? 0 }, (_, index) =>
    createCardInstance(memberData(`DECK-${index}`, `Deck ${index}`), P1, `deck-${index}`)
  );

  let game = registerCards(createGameState('dears', P1, 'P1', P2, 'P2'), [
    source,
    ...energies.map(({ card }) => card),
    ...ownStage.map(({ card }) => card),
    ...opponentStage,
    ...(below ? [below] : []),
    ...hand,
    ...deck,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : { ...player.liveZone, cardIds: [source.instanceId] },
    energyZone: energies.reduce(
      (zone, { card, orientation }) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    hand: { ...player.hand, cardIds: hand.map(({ instanceId }) => instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: deck.map(({ instanceId }) => instanceId) },
  }));
  ownStage.forEach(({ card, orientation }, index) => {
    game = placeStageMember(game, P1, SLOTS[index]!, card.instanceId, orientation);
  });
  opponentStage.forEach((card, index) => {
    game = placeStageMember(game, P2, SLOTS[index]!, card.instanceId);
  });
  if (below) {
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.LEFT]: [below.instanceId],
        },
      },
    }));
  }
  if ((options.markedEnergyIndexes?.length ?? 0) > 0) {
    game = {
      ...game,
      energyActivePhaseSkips: options.markedEnergyIndexes!.map((index) => ({
        playerId: P1,
        energyCardId: energies[index]!.card.instanceId,
        sourceCardId: SOURCE_ID,
        abilityId: 'marker-source',
      })),
    };
  }
  return options.withPending === false ? game : { ...game, pendingAbilities: [pending()] };
}

function placeStageMember(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string,
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

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(
  game: GameState,
  input: {
    readonly option?: string;
    readonly cardId?: string;
    readonly cardIds?: readonly string[];
  } = {}
): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    input.cardId ?? null,
    null,
    false,
    input.option ?? null,
    input.cardIds
  );
}

function energyMovedEvents(game: GameState) {
  return game.eventLog.filter(
    ({ event }) => event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK
  );
}

function waitingRoomEvents(game: GameState) {
  return game.eventLog.filter(
    ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
  );
}

describe('PL!SP-bp7-026-L 分数3「Dears」', () => {
  it('registers the exact queued LIVE_START definition and public Chinese text', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-026-L')).toEqual([
      expect.objectContaining({
        abilityId: ABILITY_ID,
        cardCodes: ['PL!SP-bp7-026-L'],
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.LIVE_CARD,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
        effectText: EFFECT_TEXT,
      }),
    ]);
    expect(
      getCardAbilityDefinitionsForCardCode('PL!SP-bp7-026-L')[0]?.baseCardCodes
    ).toBeUndefined();
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-026-P')).toEqual([]);
  });

  it('enqueues from a real LIVE_START check and opens only the optional return window', () => {
    const checked = enqueueTriggeredCardEffects(
      setup({ withPending: false, ownStageNames: ['葉月恋'] }),
      [TriggerCondition.ON_LIVE_START]
    );
    expect(checked.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: ABILITY_ID,
        sourceCardId: SOURCE_ID,
        controllerId: P1,
      }),
    ]);

    const game = start(checked);
    expect(game.activeEffect).toEqual(
      expect.objectContaining({
        abilityId: ABILITY_ID,
        effectText: EFFECT_TEXT,
        stepId: 'SP_BP7_026_RETURN_ONE_ENERGY',
        stepText: '可以将1张能量放回能量卡组并发动此效果。',
        selectableOptions: [{ id: 'activate', label: '发动' }],
        confirmSelectionLabel: '发动',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      })
    );
    expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
  });

  it('declines without moving energy, drawing, or opening a second window', () => {
    const before = start(setup({ ownStageNames: ['葉月恋'], deckCount: 2 }));
    const game = confirm(before);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].energyZone.cardIds).toEqual(['energy-0']);
    expect(game.players[0].energyDeck.cardIds).toEqual([]);
    expect(game.players[0].hand.cardIds).toEqual([]);
    expect(energyMovedEvents(game)).toHaveLength(0);
    expect(game.actionHistory.at(-1)?.payload).toEqual(
      expect.objectContaining({ abilityId: ABILITY_ID, step: 'DECLINED' })
    );
  });

  it('keeps the returned energy paid when Ren is not on the own top-level stage', () => {
    const game = confirm(start(setup({ deckCount: 2 })), { option: 'activate' });
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].energyZone.cardIds).toEqual([]);
    expect(game.players[0].energyDeck.cardIds).toEqual(['energy-0']);
    expect(game.players[0].hand.cardIds).toEqual([]);
    expect(game.players[0].mainDeck.cardIds).toEqual(['deck-0', 'deck-1']);
    expect(energyMovedEvents(game)).toHaveLength(1);
    expect(game.actionHistory.at(-1)?.payload).toEqual(
      expect.objectContaining({
        abilityId: ABILITY_ID,
        step: 'PAID_REN_NOT_ON_STAGE',
        movedEnergyCardIds: ['energy-0'],
        conditionMet: false,
      })
    );
  });

  it.each(['葉月 恋', '叶月恋', '澁谷かのん&葉月 恋&鬼塚夏美'])(
    'recognizes the Ren identity %s after payment and starts draw two, discard one',
    (renName) => {
      const game = confirm(start(setup({ ownStageNames: [renName], deckCount: 2 })), {
        option: 'activate',
      });
      expect(game.players[0].hand.cardIds).toEqual(['deck-0', 'deck-1']);
      expect(game.players[0].mainDeck.cardIds).toEqual([]);
      expect(game.activeEffect).toEqual(
        expect.objectContaining({
          abilityId: ABILITY_ID,
          stepId: 'SP_BP7_026_SELECT_DISCARD_AFTER_DRAW',
          stepText: '请选择1张手牌放置入休息室。',
          selectableCardIds: ['deck-0', 'deck-1'],
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
          selectionLabel: '选择要放置入休息室的手牌',
          confirmSelectionLabel: '放置入休息室',
          canSkipSelection: false,
        })
      );
    }
  );

  it('counts a WAITING Ren on the own top-level stage', () => {
    const game = confirm(
      start(
        setup({
          ownStageNames: ['葉月恋'],
          ownStageOrientations: [OrientationState.WAITING],
          deckCount: 2,
        })
      ),
      { option: 'activate' }
    );
    expect(game.players[0].hand.cardIds).toEqual(['deck-0', 'deck-1']);
    expect(game.activeEffect?.stepId).toBe('SP_BP7_026_SELECT_DISCARD_AFTER_DRAW');
  });

  it('excludes opponent-stage and member-below Ren identities', () => {
    const game = confirm(
      start(
        setup({
          opponentStageNames: ['葉月恋'],
          belowName: '叶月恋',
          deckCount: 2,
        })
      ),
      { option: 'activate' }
    );
    expect(game.players[0].energyDeck.cardIds).toEqual(['energy-0']);
    expect(game.players[0].hand.cardIds).toEqual([]);
    expect(game.activeEffect).toBeNull();
  });

  it('uses the standard private hand discard and waiting-room trigger event', () => {
    let game = confirm(start(setup({ ownStageNames: ['葉月恋'], handCount: 1, deckCount: 2 })), {
      option: 'activate',
    });
    expect(game.activeEffect?.selectableCardIds).toEqual(['hand-0', 'deck-0', 'deck-1']);

    game = confirm(game, { cardId: 'deck-1' });
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual(['hand-0', 'deck-0']);
    expect(game.players[0].waitingRoom.cardIds).toEqual(['deck-1']);
    expect(waitingRoomEvents(game)).toHaveLength(1);
    expect(game.actionHistory.at(-1)?.payload).toEqual(
      expect.objectContaining({
        abilityId: ABILITY_ID,
        step: 'DISCARD_HAND_CARD',
        drawnCardIds: ['deck-0', 'deck-1'],
        discardedCardIds: ['deck-1'],
      })
    );
  });

  it('rejects stale or illegal discard input without progressing', () => {
    const game = confirm(start(setup({ ownStageNames: ['葉月恋'], deckCount: 2 })), {
      option: 'activate',
    });
    expect(confirm(game, { cardId: 'energy-0' })).toBe(game);

    const stale = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['deck-1'] },
    }));
    expect(confirm(stale, { cardId: 'deck-0' })).toBe(stale);
  });

  it('opens exact special-energy selection and rejects illegal return choices', () => {
    const game = start(
      setup({
        ownStageNames: ['葉月恋'],
        energyOrientations: [OrientationState.ACTIVE, OrientationState.WAITING],
        markedEnergyIndexes: [1],
        deckCount: 2,
      })
    );
    expect(game.activeEffect).toEqual(
      expect.objectContaining({
        selectableCardIds: ['energy-1', 'energy-0'],
        selectionLabel: '选择要放回能量卡组的能量',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        confirmSelectionLabel: '支付费用',
        skipSelectionLabel: '不发动',
      })
    );
    expect(confirm(game, { cardIds: ['energy-0', 'energy-1'] })).toBe(game);
    expect(confirm(game, { cardIds: ['missing-energy'] })).toBe(game);

    const paid = confirm(game, { cardIds: ['energy-1'] });
    expect(paid.players[0].energyDeck.cardIds).toEqual(['energy-1']);
    expect(paid.players[0].energyZone.cardIds).toEqual(['energy-0']);
    expect(
      paid.energyActivePhaseSkips.some(({ energyCardId }) => energyCardId === 'energy-1')
    ).toBe(false);
    expect(paid.activeEffect?.stepId).toBe('SP_BP7_026_SELECT_DISCARD_AFTER_DRAW');
  });

  it('enqueues the standard energy-return trigger without interrupting the discard step', () => {
    const game = confirm(
      start(
        setup({
          ownStageNames: ['葉月恋'],
          ownStageCardCodes: ['PL!SP-bp7-005-SEC'],
          deckCount: 2,
        })
      ),
      { option: 'activate' }
    );
    expect(game.activeEffect?.stepId).toBe('SP_BP7_026_SELECT_DISCARD_AFTER_DRAW');
    expect(game.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId: SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
        sourceCardId: 'own-member-0',
        timingId: TriggerCondition.ON_ENERGY_MOVED_TO_DECK,
      })
    );
  });

  it('automatically returns WAITING energy before ACTIVE energy', () => {
    const game = confirm(
      start(
        setup({
          energyOrientations: [OrientationState.ACTIVE, OrientationState.WAITING],
        })
      ),
      { option: 'activate' }
    );
    expect(game.players[0].energyDeck.cardIds).toEqual(['energy-1']);
    expect(game.players[0].energyZone.cardIds).toEqual(['energy-0']);
  });

  it('revalidates the exact source before payment and never moves energy when it is stale', () => {
    const opened = start(setup({ ownStageNames: ['葉月恋'], deckCount: 2 }));
    const stale = updatePlayer(opened, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const game = confirm(stale, { option: 'activate' });
    expect(game.players[0].energyZone.cardIds).toEqual(['energy-0']);
    expect(game.players[0].energyDeck.cardIds).toEqual([]);
    expect(game.players[0].hand.cardIds).toEqual([]);
    expect(energyMovedEvents(game)).toHaveLength(0);
    expect(game.activeEffect).toBeNull();
  });

  it.each([
    ['no energy', { energyOrientations: [] }],
    ['wrong exact card code', { sourceCode: 'PL!SP-bp7-026-P' }],
    ['wrong owner', { sourceOwnerId: P2 }],
    ['source outside the live zone', { sourceInLiveZone: false }],
  ] as const)('consumes safely for %s', (_label, options) => {
    const game = start(setup(options));
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(energyMovedEvents(game)).toHaveLength(0);
  });

  it('uses the standard no-hand confirmation when draw cannot obtain any cards', () => {
    let game = confirm(start(setup({ ownStageNames: ['葉月恋'] })), {
      option: 'activate',
    });
    expect(game.activeEffect).toEqual(
      expect.objectContaining({
        stepText: '没有可放置入休息室的手牌。确认后继续。',
        selectableCardIds: [],
        canSkipSelection: true,
        skipSelectionLabel: '确认',
      })
    );
    game = confirm(game);
    expect(game.activeEffect).toBeNull();
    expect(waitingRoomEvents(game)).toHaveLength(0);
  });
});
