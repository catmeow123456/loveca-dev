import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import {
  addCardToStatefulZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HASUNOSORA_TRIPLE_UNIT_CONTINUOUS_IDENTITY_ABILITY_ID,
  HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID,
  HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID,
  HS_SD1_008_ON_ENTER_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
  HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
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

function createHasunosoraMember(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createOtherMember(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName: 'Liella!',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createHasunosoraLive(cardCode: string, name = cardCode, score = 3): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function createOtherLive(cardCode: string, name = cardCode, score = 3): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  suffix = 'pending'
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${suffix}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`event-${suffix}`],
  };
}

function createState(cards: readonly ReturnType<typeof createCardInstance>[]): GameState {
  return registerCards(createGameState('hs-sd1-003-008-020', PLAYER1, 'P1', PLAYER2, 'P2'), cards);
}

function putCards(options: {
  readonly game: GameState;
  readonly hand?: readonly string[];
  readonly deck?: readonly string[];
  readonly energy?: readonly { readonly cardId: string; readonly orientation?: OrientationState }[];
  readonly liveZone?: readonly string[];
  readonly stage?: readonly { readonly cardId: string; readonly slot: SlotPosition }[];
}): GameState {
  return updatePlayer(
    {
      ...options.game,
      liveResolution: {
        ...options.game.liveResolution,
        performingPlayerId: PLAYER1,
      },
    },
    PLAYER1,
    (player) => {
      let memberSlots = player.memberSlots;
      for (const stageMember of options.stage ?? []) {
        memberSlots = placeCardInSlot(memberSlots, stageMember.slot, stageMember.cardId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        });
      }
      return {
        ...player,
        hand: { ...player.hand, cardIds: [...(options.hand ?? [])] },
        mainDeck: { ...player.mainDeck, cardIds: [...(options.deck ?? [])] },
        energyZone: (options.energy ?? []).reduce(
          (zone, energy) =>
            addCardToStatefulZone(zone, energy.cardId, {
              orientation: energy.orientation ?? OrientationState.ACTIVE,
              face: FaceState.FACE_DOWN,
            }),
          { ...player.energyZone, cardIds: [], cardStates: new Map() }
        ),
        liveZone: (options.liveZone ?? []).reduce(
          (zone, cardId) =>
            addCardToStatefulZone(zone, cardId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
          { ...player.liveZone, cardIds: [], cardStates: new Map() }
        ),
        memberSlots,
      };
    }
  );
}

function start(game: GameState, ability: PendingAbilityState): GameState {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState;
}

function chooseOption(game: GameState, selectedOptionId: string): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    false,
    selectedOptionId
  );
}

function chooseCard(game: GameState, selectedCardId: string | null): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function chooseCards(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    false,
    null,
    selectedCardIds
  );
}

function hasHandToWaitingEvent(state: GameState, cardIds: readonly string[]): boolean {
  return state.eventLog.some(
    (entry) =>
      entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
      entry.event.fromZone === ZoneType.HAND &&
      cardIds.every((cardId) => entry.event.cardInstanceIds?.includes(cardId) === true)
  );
}

function findHeartModifier(state: GameState, targetMemberCardId: string) {
  return state.liveResolution.liveModifiers.find(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.playerId === PLAYER1 &&
      'targetMemberCardId' in modifier &&
      modifier.targetMemberCardId === targetMemberCardId
  );
}

function findBladeModifier(state: GameState, sourceCardId: string) {
  return state.liveResolution.liveModifiers.find(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.playerId === PLAYER1 &&
      modifier.sourceCardId === sourceCardId
  );
}

describe('PL!HS-sd1-003/008/020 workflows', () => {
  function setup003(options: {
    readonly activeEnergyCount?: number;
    readonly includeTarget?: boolean;
    readonly includeOtherTarget?: boolean;
  }): {
    readonly state: GameState;
    readonly source: ReturnType<typeof createCardInstance>;
    readonly target: ReturnType<typeof createCardInstance>;
    readonly other: ReturnType<typeof createCardInstance>;
  } {
    const source = createCardInstance(
      createHasunosoraMember('PL!HS-sd1-003-SD', '大沢瑠璃乃', 7),
      PLAYER1,
      'sd1-003-source'
    );
    const target = createCardInstance(
      createHasunosoraMember('PL!HS-test-target', 'Target'),
      PLAYER1,
      'sd1-003-target'
    );
    const other = createCardInstance(createOtherMember('PL!SP-test-target'), PLAYER1, 'other-target');
    const energy = Array.from({ length: options.activeEnergyCount ?? 1 }, (_, index) =>
      createCardInstance(createOtherMember(`energy-${index}`), PLAYER1, `energy-${index}`)
    );
    const stage: { cardId: string; slot: SlotPosition }[] = [
      { cardId: source.instanceId, slot: SlotPosition.CENTER },
    ];
    if (options.includeTarget !== false) {
      stage.push({ cardId: target.instanceId, slot: SlotPosition.LEFT });
    }
    if (options.includeOtherTarget === true) {
      stage.push({ cardId: other.instanceId, slot: SlotPosition.RIGHT });
    }
    const state = putCards({
      game: createState([source, target, other, ...energy]),
      energy: energy.map((card) => ({ cardId: card.instanceId })),
      stage,
    });
    return {
      state: start(
        state,
        pending(
          HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      ),
      source,
      target,
      other,
    };
  }

  it('PL!HS-sd1-003-SD pays energy and gives another Hasunosora member Heart and BLADE', () => {
    const setup = setup003({});
    const paid = chooseOption(setup.state, 'pay');
    const resolved = chooseCard(paid, setup.target.instanceId);

    expect(resolved.players[0]!.energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(findHeartModifier(resolved, setup.target.instanceId)).toMatchObject({
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      abilityId: HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID,
    });
    expect(findBladeModifier(resolved, setup.target.instanceId)).toMatchObject({
      countDelta: 1,
      abilityId: HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID,
    });
  });

  it('PL!HS-sd1-003-SD can decline or consume as no-op with no energy/target', () => {
    const declined = chooseOption(setup003({}).state, 'decline');
    expect(declined.activeEffect).toBeNull();
    expect(declined.liveResolution.liveModifiers).toEqual([]);

    expect(setup003({ activeEnergyCount: 0 }).state.activeEffect).toBeNull();
    expect(setup003({ includeTarget: false }).state.activeEffect).toBeNull();
  });

  it('PL!HS-sd1-003-SD target list excludes itself and non-Hasunosora members', () => {
    const setup = setup003({ includeOtherTarget: true });
    const paid = chooseOption(setup.state, 'pay');

    expect(paid.activeEffect?.selectableCardIds).toEqual([setup.target.instanceId]);
    const unchanged = chooseCard(paid, setup.source.instanceId);
    expect(unchanged.activeEffect?.stepId).toBe(paid.activeEffect?.stepId);
  });

  it('PL!HS-sd1-003-SD continues pending after target selection', () => {
    const first = setup003({ activeEnergyCount: 2 });
    const secondSource = createCardInstance(
      createHasunosoraMember('PL!HS-sd1-003-SD', 'Second Rurino', 7),
      PLAYER1,
      'sd1-003-second-source'
    );
    const withSecond = {
      ...registerCards(first.state, [secondSource]),
      pendingAbilities: [
        pending(
          HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID,
          secondSource.instanceId,
          TriggerCondition.ON_LIVE_START,
          'second'
        ),
      ],
    };
    const resolved = chooseCard(chooseOption(withSecond, 'pay'), first.target.instanceId);
    expect(resolved.activeEffect?.sourceCardId).toBe(secondSource.instanceId);
  });

  it('PL!HS-sd1-008-SD on-enter draws two, discards one, and enqueues hand-to-waiting triggers', () => {
    const source = createCardInstance(
      createHasunosoraMember('PL!HS-sd1-008-SD', '桂城 泉', 13),
      PLAYER1,
      'sd1-008-source'
    );
    const hand = createCardInstance(createOtherMember('hand'), PLAYER1, '008-hand');
    const deck1 = createCardInstance(createOtherMember('deck1'), PLAYER1, '008-deck-1');
    const deck2 = createCardInstance(createOtherMember('deck2'), PLAYER1, '008-deck-2');
    const triggerSource = createCardInstance(
      createHasunosoraMember('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      '008-trigger-source'
    );
    const state = start(
      putCards({
        game: createState([source, hand, deck1, deck2, triggerSource]),
        hand: [hand.instanceId],
        deck: [deck1.instanceId, deck2.instanceId],
        stage: [
          { cardId: source.instanceId, slot: SlotPosition.CENTER },
          { cardId: triggerSource.instanceId, slot: SlotPosition.LEFT },
        ],
      }),
      pending(
        HS_SD1_008_ON_ENTER_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_ENTER_STAGE
      )
    );

    expect(state.activeEffect?.selectableCardIds).toEqual([
      hand.instanceId,
      deck1.instanceId,
      deck2.instanceId,
    ]);
    const resolved = chooseCard(state, hand.instanceId);
    expect(resolved.players[0]!.hand.cardIds).toEqual([deck1.instanceId, deck2.instanceId]);
    expect(resolved.players[0]!.waitingRoom.cardIds).toEqual([hand.instanceId]);
    expect(hasHandToWaitingEvent(resolved, [hand.instanceId])).toBe(true);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceIds?.includes(hand.instanceId) === true
      )
    ).toBe(true);
  });

  it('PL!HS-sd1-008-SD on-enter handles no/low hand after drawing by discarding what exists', () => {
    const source = createCardInstance(
      createHasunosoraMember('PL!HS-sd1-008-SD', '桂城 泉', 13),
      PLAYER1,
      'sd1-008-low-source'
    );
    const state = start(
      putCards({
        game: createState([source]),
        stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
      }),
      pending(
        HS_SD1_008_ON_ENTER_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'low'
      )
    );
    const resolved = chooseCard(state, null);
    expect(resolved.activeEffect).toBeNull();
  });

  function setup008Live(options: {
    readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly includeTarget?: boolean;
  }) {
    const source = createCardInstance(
      createHasunosoraMember('PL!HS-sd1-008-SD', '桂城 泉', 13),
      PLAYER1,
      'sd1-008-live-source'
    );
    const target = createCardInstance(
      createHasunosoraMember('PL!HS-008-target', 'Target'),
      PLAYER1,
      'sd1-008-live-target'
    );
    const handCards =
      options.handCards ??
      [
        createCardInstance(createHasunosoraMember('PL!HS-hand-1'), PLAYER1, '008-hasu-1'),
        createCardInstance(createHasunosoraLive('PL!HS-hand-live'), PLAYER1, '008-hasu-2'),
      ];
    return {
      source,
      target,
      handCards,
      state: start(
        putCards({
          game: createState([source, target, ...handCards]),
          hand: handCards.map((card) => card.instanceId),
          stage: [
            { cardId: source.instanceId, slot: SlotPosition.CENTER },
            ...(options.includeTarget === false
              ? []
              : [{ cardId: target.instanceId, slot: SlotPosition.LEFT }]),
          ],
        }),
        pending(
          HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      ),
    };
  }

  it('PL!HS-sd1-008-SD live-start can skip and no-ops with fewer than two Hasunosora hand cards', () => {
    const skipped = chooseCards(setup008Live({}).state, []);
    expect(skipped.activeEffect).toBeNull();

    const oneHasu = createCardInstance(createHasunosoraMember('PL!HS-one'), PLAYER1, '008-one');
    expect(setup008Live({ handCards: [oneHasu] }).state.activeEffect).toBeNull();
    expect(setup008Live({ includeTarget: false }).state.activeEffect).toBeNull();
  });

  for (const heartColor of [
    HeartColor.PINK,
    HeartColor.GREEN,
    HeartColor.BLUE,
    HeartColor.PURPLE,
  ] as const) {
    it(`PL!HS-sd1-008-SD live-start grants ${heartColor} Heart x2`, () => {
      const setup = setup008Live({});
      const discarded = chooseCards(
        setup.state,
        setup.handCards.map((card) => card.instanceId)
      );
      const heartSelected = chooseOption(discarded, heartColor);
      const resolved = chooseCard(heartSelected, setup.target.instanceId);

      expect(hasHandToWaitingEvent(resolved, setup.handCards.map((card) => card.instanceId))).toBe(
        true
      );
      expect(findHeartModifier(resolved, setup.target.instanceId)).toMatchObject({
        hearts: [{ color: heartColor, count: 2 }],
        abilityId: HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID,
      });
    });
  }

  it('PL!HS-sd1-008-SD live-start target list excludes source and non-Hasunosora, and continues pending', () => {
    const handCards = [0, 1, 2, 3].map((index) =>
      createCardInstance(createHasunosoraMember(`PL!HS-008-hand-${index}`), PLAYER1, `008-hand-${index}`)
    );
    const setup = setup008Live({ handCards });
    const second = {
      ...setup.state,
      pendingAbilities: [
        pending(
          HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID,
          setup.source.instanceId,
          TriggerCondition.ON_LIVE_START,
          'second'
        ),
      ],
    };
    const discarded = chooseCards(
      second,
      setup.handCards.slice(0, 2).map((card) => card.instanceId)
    );
    const selected = chooseOption(discarded, HeartColor.PINK);
    expect(selected.activeEffect?.selectableCardIds).toEqual([setup.target.instanceId]);
    const resolved = chooseCard(selected, setup.target.instanceId);
    expect(resolved.activeEffect?.abilityId).toBe(
      HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID
    );
  });

  function setup020(options: {
    readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly includeTarget?: boolean;
    readonly targetHasunosora?: boolean;
  }) {
    const live = createCardInstance(
      createHasunosoraLive('PL!HS-sd1-020-SD', 'Link to the FUTURE（104期Ver.）', 6),
      PLAYER1,
      'sd1-020-live'
    );
    const target = createCardInstance(
      options.targetHasunosora === true
        ? createHasunosoraMember('PL!HS-020-target')
        : createOtherMember('PL!SP-020-target'),
      PLAYER1,
      'sd1-020-target'
    );
    const handCards = options.handCards ?? [];
    return {
      live,
      target,
      handCards,
      state: start(
        putCards({
          game: createState([live, target, ...handCards]),
          hand: handCards.map((card) => card.instanceId),
          liveZone: [live.instanceId],
          stage:
            options.includeTarget === false
              ? []
              : [{ cardId: target.instanceId, slot: SlotPosition.CENTER }],
        }),
        pending(
          HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID,
          live.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      ),
    };
  }

  it('PL!HS-sd1-020-SD keeps continuous identity registered and resolves zero discard as no Blade', () => {
    expect(
      getCardAbilityDefinitionsForCardCode('PL!HS-sd1-020-SD').some(
        (ability) => ability.abilityId === HASUNOSORA_TRIPLE_UNIT_CONTINUOUS_IDENTITY_ABILITY_ID
      )
    ).toBe(true);

    const resolved = chooseCards(setup020({}).state, []);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('PL!HS-sd1-020-SD discards one Hasunosora member and can target any own stage member', () => {
    const hand = createCardInstance(createHasunosoraMember('PL!HS-020-hand'), PLAYER1, '020-hand-1');
    const setup = setup020({ handCards: [hand] });
    const selected = chooseCards(setup.state, [hand.instanceId]);
    const resolved = chooseCard(selected, setup.target.instanceId);

    expect(hasHandToWaitingEvent(resolved, [hand.instanceId])).toBe(true);
    expect(findBladeModifier(resolved, setup.target.instanceId)).toMatchObject({
      countDelta: 1,
      abilityId: HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID,
    });
  });

  it('PL!HS-sd1-020-SD discards three Hasunosora members for BLADE x3', () => {
    const handCards = [0, 1, 2].map((index) =>
      createCardInstance(createHasunosoraMember(`PL!HS-020-hand-${index}`), PLAYER1, `020-hand-${index}`)
    );
    const setup = setup020({ handCards, targetHasunosora: true });
    const selected = chooseCards(
      setup.state,
      handCards.map((card) => card.instanceId)
    );
    const resolved = chooseCard(selected, setup.target.instanceId);

    expect(findBladeModifier(resolved, setup.target.instanceId)).toMatchObject({
      countDelta: 3,
    });
  });

  it('PL!HS-sd1-020-SD only accepts Hasunosora member hand cards and no-ops without a stage target', () => {
    const hasuMember = createCardInstance(createHasunosoraMember('PL!HS-020-legal'), PLAYER1, '020-legal');
    const hasuLive = createCardInstance(createHasunosoraLive('PL!HS-020-live-hand'), PLAYER1, '020-live-hand');
    const otherMember = createCardInstance(createOtherMember('PL!SP-020-other'), PLAYER1, '020-other');
    const setup = setup020({ handCards: [hasuMember, hasuLive, otherMember] });

    expect(setup.state.activeEffect?.selectableCardIds).toEqual([hasuMember.instanceId]);
    const unchanged = chooseCards(setup.state, [hasuLive.instanceId]);
    expect(unchanged.activeEffect?.id).toBe(setup.state.activeEffect?.id);
    expect(setup020({ handCards: [hasuMember], includeTarget: false }).state.activeEffect).toBeNull();
  });

  it('PL!HS-sd1-020-SD continues pending after target selection', () => {
    const handCards = [
      createCardInstance(createHasunosoraMember('PL!HS-020-a'), PLAYER1, '020-a'),
      createCardInstance(createHasunosoraMember('PL!HS-020-b'), PLAYER1, '020-b'),
    ];
    const setup = setup020({ handCards });
    const withSecond = {
      ...setup.state,
      pendingAbilities: [
        pending(
          HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID,
          setup.live.instanceId,
          TriggerCondition.ON_LIVE_START,
          'second'
        ),
      ],
    };
    const selected = chooseCards(withSecond, [handCards[0]!.instanceId]);
    const resolved = chooseCard(selected, setup.target.instanceId);
    expect(resolved.activeEffect?.abilityId).toBe(
      HS_SD1_020_LIVE_START_DISCARD_UP_TO_THREE_HASUNOSORA_MEMBERS_TARGET_BLADE_ABILITY_ID
    );
  });
});
