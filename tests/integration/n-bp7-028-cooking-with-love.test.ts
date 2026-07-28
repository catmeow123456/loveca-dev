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
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP7_028_LIVE_START_SHUFFLE_WAITING_ROOM_BOTTOM_STAGE_NIJIGASAKI_GAIN_PINK_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY_ID =
  N_BP7_028_LIVE_START_SHUFFLE_WAITING_ROOM_BOTTOM_STAGE_NIJIGASAKI_GAIN_PINK_HEART_ABILITY_ID;
const SOURCE_ID = 'cooking-with-love';
const EXACT_EFFECT_TEXT =
  '【LIVE开始时】自己的休息室存在『虹咲』的LIVE卡和不持有BLADE HEART的『虹咲』的成员卡的场合，可以将存在于自己的休息室的所有卡片洗牌，放置于卡组底。如此做时，LIVE结束时为止，存在于自己的舞台的所有『虹咲』的成员获得[桃ハート]。';
const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

interface CardSpec {
  readonly id: string;
  readonly type: CardType;
  readonly group?: string;
  readonly bladeHeart?: boolean;
  readonly ownerId?: string;
  readonly orientation?: OrientationState;
}

function liveData(cardCode: string, group = '虹ヶ咲'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [group],
    cardType: CardType.LIVE,
    score: 7,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function card(spec: CardSpec) {
  const ownerId = spec.ownerId ?? P1;
  if (spec.type === CardType.LIVE) {
    return createCardInstance(liveData(spec.id, spec.group), ownerId, spec.id);
  }
  const data: MemberCardData = {
    cardCode: spec.id,
    name: spec.id,
    groupNames: [spec.group ?? '虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: spec.bladeHeart ? [{ effect: BladeHeartEffect.DRAW }] : [],
  };
  return createCardInstance(data, ownerId, spec.id);
}

function pending(id = 'cooking-pending'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
  };
}

function setup(
  options: {
    readonly waiting?: readonly CardSpec[];
    readonly ownStage?: readonly CardSpec[];
    readonly opponentStage?: readonly CardSpec[];
    readonly below?: CardSpec;
    readonly mainDeckCardIds?: readonly string[];
    readonly sourceCode?: string;
    readonly sourceInLiveZone?: boolean;
    readonly withPending?: boolean;
  } = {}
): GameState {
  const source = createCardInstance(
    liveData(options.sourceCode ?? 'PL!N-bp7-028-L'),
    P1,
    SOURCE_ID
  );
  const waiting = (options.waiting ?? defaultConditionCards()).map(card);
  const ownStage = (options.ownStage ?? []).map((spec) => ({
    spec,
    instance: card({ ...spec, ownerId: P1 }),
  }));
  const opponentStage = (options.opponentStage ?? []).map((spec) => ({
    spec,
    instance: card({ ...spec, ownerId: P2 }),
  }));
  const below = options.below ? card({ ...options.below, ownerId: P1 }) : null;
  const mainDeck = (options.mainDeckCardIds ?? []).map((id) =>
    card({ id, type: CardType.MEMBER, group: 'Aqours' })
  );
  let game = registerCards(createGameState('cooking', P1, 'P1', P2, 'P2'), [
    source,
    ...waiting,
    ...ownStage.map(({ instance }) => instance),
    ...opponentStage.map(({ instance }) => instance),
    ...(below ? [below] : []),
    ...mainDeck,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : { ...player.liveZone, cardIds: [source.instanceId] },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting.map(({ instanceId }) => instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: mainDeck.map(({ instanceId }) => instanceId) },
  }));
  for (const [index, { spec, instance }] of ownStage.entries()) {
    game = putStage(
      game,
      P1,
      SLOTS[index]!,
      instance.instanceId,
      spec.orientation ?? OrientationState.ACTIVE
    );
  }
  for (const [index, { spec, instance }] of opponentStage.entries()) {
    game = putStage(
      game,
      P2,
      SLOTS[index]!,
      instance.instanceId,
      spec.orientation ?? OrientationState.ACTIVE
    );
  }
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
  return options.withPending === false ? game : { ...game, pendingAbilities: [pending()] };
}

function defaultConditionCards(): readonly CardSpec[] {
  return [
    { id: 'waiting-niji-live', type: CardType.LIVE },
    { id: 'waiting-niji-member', type: CardType.MEMBER },
  ];
}

function putStage(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string | null,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      player.memberSlots,
      slot,
      cardId,
      cardId ? { orientation, face: FaceState.FACE_UP } : undefined
    ),
  }));
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function chooseOption(game: GameState, selectedOptionId: string | null): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    null,
    null,
    false,
    selectedOptionId
  );
}

function heartModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'HEART' && modifier.abilityId === ABILITY_ID
  );
}

function lastResolve(game: GameState) {
  return game.actionHistory
    .filter(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID
    )
    .at(-1);
}

describe('PL!N-bp7-028-L 分数7「Cooking with Love」', () => {
  it('registers a base-family queued LIVE_START definition with the public Chinese text', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-028-L')).toEqual([
      expect.objectContaining({
        abilityId: ABILITY_ID,
        baseCardCodes: ['PL!N-bp7-028'],
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.LIVE_CARD,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
        effectText: EXACT_EFFECT_TEXT,
      }),
    ]);
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-028-P')).toHaveLength(1);
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-029-P')).not.toContainEqual(
      expect.objectContaining({ abilityId: ABILITY_ID })
    );
  });

  it('enqueues from a real ON_LIVE_START check and opens only the optional action window', () => {
    const checked = enqueueTriggeredCardEffects(setup({ withPending: false }), [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(checked.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: ABILITY_ID,
        sourceCardId: SOURCE_ID,
        controllerId: P1,
        timingId: TriggerCondition.ON_LIVE_START,
      }),
    ]);
    const waiting = start(checked);
    expect(waiting.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      effectText: EXACT_EFFECT_TEXT,
      stepText:
        '可以将自己的休息室中的所有卡片洗牌并放置于卡组底，使自己舞台上的所有『虹咲』成员获得[桃ハート]。',
      selectableOptions: [{ id: 'activate', label: '发动' }],
      confirmSelectionLabel: '发动',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(waiting.activeEffect?.selectableCardIds).toBeUndefined();
    expect(waiting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
  });

  it('declines without moving cards or adding modifiers and continues cleanly', () => {
    const initial = setup({
      ownStage: [{ id: 'own-niji', type: CardType.MEMBER }],
      mainDeckCardIds: ['deck-card'],
    });
    const waitingIds = initial.players[0]!.waitingRoom.cardIds;
    const done = chooseOption(start(initial), null);
    expect(done.players[0]!.waitingRoom.cardIds).toEqual(waitingIds);
    expect(done.players[0]!.mainDeck.cardIds).toEqual(['deck-card']);
    expect(heartModifiers(done)).toEqual([]);
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(lastResolve(done)?.payload.step).toBe('SKIP');
  });

  it('rejects an option that is not the positive action and ignores repeated confirmation', () => {
    const waiting = start(setup());
    const forged = chooseOption(waiting, 'decline');
    expect(forged).toEqual(waiting);

    const done = chooseOption(waiting, 'activate');
    const repeated = confirmActiveEffectStep(
      done,
      P1,
      waiting.activeEffect!.id,
      null,
      null,
      false,
      'activate'
    );
    expect(repeated).toEqual(done);
  });

  it.each([
    ['Nijigasaki LIVE', [{ id: 'only-member', type: CardType.MEMBER }]],
    [
      'Nijigasaki member without BLADE HEART',
      [
        { id: 'only-live', type: CardType.LIVE },
        { id: 'blade-heart-member', type: CardType.MEMBER, bladeHeart: true },
      ],
    ],
    [
      'structured Nijigasaki identity',
      [
        { id: 'aqours-live', type: CardType.LIVE, group: 'Aqours' },
        { id: 'aqours-member', type: CardType.MEMBER, group: 'Aqours' },
      ],
    ],
  ])('consumes without a window when missing %s', (_label, waiting) => {
    const done = start(setup({ waiting }));
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0]!.waitingRoom.cardIds).toEqual(waiting.map(({ id }) => id));
    expect(lastResolve(done)?.payload).toMatchObject({
      step: 'CONDITION_NOT_MET_AT_START',
      conditionMet: false,
    });
  });

  it('accepts structured group aliases and rejects BLADE HEART members for the condition', () => {
    const aliasWindow = start(
      setup({
        waiting: [
          { id: 'alias-live', type: CardType.LIVE, group: '虹咲' },
          { id: 'alias-member', type: CardType.MEMBER, group: 'Nijigasaki' },
        ],
      })
    );
    expect(aliasWindow.activeEffect?.abilityId).toBe(ABILITY_ID);

    const bladeOnly = start(
      setup({
        waiting: [
          { id: 'alias-live', type: CardType.LIVE, group: '虹咲' },
          {
            id: 'alias-member',
            type: CardType.MEMBER,
            group: 'Nijigasaki',
            bladeHeart: true,
          },
        ],
      })
    );
    expect(bladeOnly.activeEffect).toBeNull();
  });

  it('uses the complete current waiting-room snapshot and appends all cards at deck bottom', () => {
    let waiting = start(
      setup({
        waiting: [
          ...defaultConditionCards(),
          { id: 'existing-extra', type: CardType.MEMBER, group: 'Aqours' },
        ],
        mainDeckCardIds: ['deck-top', 'deck-bottom'],
      })
    );
    const lateCard = card({ id: 'late-card', type: CardType.LIVE, group: 'Aqours' });
    waiting = registerCards(waiting, [lateCard]);
    waiting = updatePlayer(waiting, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, lateCard.instanceId],
      },
    }));

    const done = chooseOption(waiting, 'activate');
    expect(done.players[0]!.waitingRoom.cardIds).toEqual([]);
    expect(done.players[0]!.mainDeck.cardIds.slice(0, 2)).toEqual(['deck-top', 'deck-bottom']);
    expect([...done.players[0]!.mainDeck.cardIds.slice(2)].sort()).toEqual(
      ['waiting-niji-live', 'waiting-niji-member', 'existing-extra', 'late-card'].sort()
    );
    expect(lastResolve(done)?.payload.originalWaitingRoomCardIds).toEqual([
      'waiting-niji-live',
      'waiting-niji-member',
      'existing-extra',
      'late-card',
    ]);
  });

  it('revalidates the condition and LIVE source at confirmation without partial movement', () => {
    for (const change of ['condition', 'source'] as const) {
      let waiting = start(setup({ mainDeckCardIds: ['deck-card'] }));
      if (change === 'condition') {
        waiting = updatePlayer(waiting, P1, (player) => ({
          ...player,
          waitingRoom: {
            ...player.waitingRoom,
            cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== 'waiting-niji-live'),
          },
        }));
      } else {
        waiting = updatePlayer(waiting, P1, (player) => ({
          ...player,
          liveZone: { ...player.liveZone, cardIds: [] },
        }));
      }
      const beforeWaiting = waiting.players[0]!.waitingRoom.cardIds;
      const done = chooseOption(waiting, 'activate');
      expect(done.players[0]!.waitingRoom.cardIds).toEqual(beforeWaiting);
      expect(done.players[0]!.mainDeck.cardIds).toEqual(['deck-card']);
      expect(heartModifiers(done)).toEqual([]);
      expect(done.activeEffect).toBeNull();
      expect(lastResolve(done)?.payload.step).toBe(
        change === 'condition' ? 'CONDITION_NOT_MET_AT_CONFIRM' : 'SOURCE_INVALID_AT_CONFIRM'
      );
    }

    const adjacent = start(setup({ sourceCode: 'PL!N-bp7-029-P' }));
    expect(adjacent.activeEffect).toBeNull();
    expect(lastResolve(adjacent)?.payload.step).toBe('SOURCE_INVALID_AT_START');
  });

  it('grants one target-bound pink Heart to every own top-level Nijigasaki member', () => {
    const done = chooseOption(
      start(
        setup({
          ownStage: [
            { id: 'active-niji', type: CardType.MEMBER },
            {
              id: 'waiting-niji',
              type: CardType.MEMBER,
              orientation: OrientationState.WAITING,
            },
            { id: 'own-aqours', type: CardType.MEMBER, group: 'Aqours' },
          ],
          opponentStage: [{ id: 'opponent-niji', type: CardType.MEMBER }],
          below: { id: 'below-niji', type: CardType.MEMBER },
        })
      ),
      'activate'
    );
    expect(heartModifiers(done)).toEqual([
      expect.objectContaining({
        kind: 'HEART',
        playerId: P1,
        target: 'TARGET_MEMBER',
        targetMemberCardId: 'active-niji',
        sourceCardId: SOURCE_ID,
        abilityId: ABILITY_ID,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      }),
      expect.objectContaining({
        kind: 'HEART',
        playerId: P1,
        target: 'TARGET_MEMBER',
        targetMemberCardId: 'waiting-niji',
        sourceCardId: SOURCE_ID,
        abilityId: ABILITY_ID,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      }),
    ]);
    expect(lastResolve(done)?.payload.targetMemberCardIds).toEqual(['active-niji', 'waiting-niji']);
  });

  it('still completes the whole-zone movement when there are no stage Heart targets', () => {
    const done = chooseOption(start(setup()), 'activate');
    expect(done.players[0]!.waitingRoom.cardIds).toEqual([]);
    expect(heartModifiers(done)).toEqual([]);
    expect(lastResolve(done)?.payload).toMatchObject({
      step: 'SHUFFLE_WAITING_ROOM_BOTTOM_AND_GAIN_PINK_HEART',
      targetMemberCardIds: [],
      pinkHeartCountPerMember: 1,
    });
  });

  it('preserves ordered continuation and consumes a later now-failed copy', () => {
    const game = {
      ...setup(),
      pendingAbilities: [pending('ordered-first'), pending('ordered-second')],
    };
    const orderWindow = start(game);
    const firstWindow = confirmActiveEffectStep(
      orderWindow,
      P1,
      orderWindow.activeEffect!.id,
      null,
      null,
      true
    );
    expect(firstWindow.activeEffect?.metadata?.orderedResolution).toBe(true);
    const done = chooseOption(firstWindow, 'activate');
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(
      done.actionHistory
        .filter(
          (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID
        )
        .map((action) => action.payload.step)
    ).toEqual([
      'START_SHUFFLE_WAITING_ROOM_BOTTOM_OPTION',
      'SHUFFLE_WAITING_ROOM_BOTTOM_AND_GAIN_PINK_HEART',
      'CONDITION_NOT_MET_AT_START',
    ]);
  });
});
