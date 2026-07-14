import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  HS_SD1_014_ON_ENTER_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
  HS_SD1_017_LIVE_SUCCESS_HASUNOSORA_STAGE_DRAW_DISCARD_ABILITY_ID,
  HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createHasunosoraMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createOtherMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
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
  return registerCards(createGameState('hs-sd1-014-017-018', PLAYER1, 'P1', PLAYER2, 'P2'), cards);
}

function putCards(options: {
  readonly game: GameState;
  readonly hand?: readonly string[];
  readonly deck?: readonly string[];
  readonly waiting?: readonly string[];
  readonly liveZone?: readonly string[];
  readonly stage?: readonly { readonly cardId: string; readonly slot: SlotPosition }[];
  readonly playerScore?: number;
}): GameState {
  return updatePlayer(
    {
      ...options.game,
      liveResolution: {
        ...options.game.liveResolution,
        performingPlayerId: PLAYER1,
        playerScores:
          options.playerScore === undefined
            ? options.game.liveResolution.playerScores
            : new Map([[PLAYER1, options.playerScore]]),
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
        waitingRoom: (options.waiting ?? []).reduce(
          (zone, cardId) => addCardToZone(zone, cardId),
          { ...player.waitingRoom, cardIds: [] }
        ),
        liveZone: (options.liveZone ?? []).reduce(
          (zone, cardId) =>
            addCardToStatefulZone(zone, cardId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
          { ...player.liveZone, cardIds: [] }
        ),
        memberSlots,
      };
    }
  );
}

function start014(options: {
  readonly hand: readonly ReturnType<typeof createCardInstance>[];
  readonly waiting: readonly ReturnType<typeof createCardInstance>[];
  readonly extraStage?: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
  }[];
}): GameState {
  const source = createCardInstance(
    createHasunosoraMember('PL!HS-sd1-014-SD', '安養寺 姫芽'),
    PLAYER1,
    'sd1-014-source'
  );
  const game = putCards({
    game: createState([
      source,
      ...options.hand,
      ...options.waiting,
      ...(options.extraStage ?? []).map((stage) => stage.card),
    ]),
    hand: options.hand.map((card) => card.instanceId),
    waiting: options.waiting.map((card) => card.instanceId),
    stage: [
      { cardId: source.instanceId, slot: SlotPosition.CENTER },
      ...(options.extraStage ?? []).map((stage) => ({
        cardId: stage.card.instanceId,
        slot: stage.slot,
      })),
    ],
  });
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pending(
        HS_SD1_014_ON_ENTER_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_ENTER_STAGE
      ),
    ],
  }).gameState;
}

function confirm(game: GameState, selectedCardId?: string | null): GameState {
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

describe('PL!HS-sd1-014/017/018 workflows', () => {
  it('allows PL!HS-sd1-014-SD to skip its optional discard', () => {
    const hand = createCardInstance(createOtherMember('PL!SP-test-hand'), PLAYER1, 'skip-hand');
    const state = confirm(start014({ hand: [hand], waiting: [] }), null);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0]!.hand.cardIds).toEqual([hand.instanceId]);
    expect(state.players[0]!.waitingRoom.cardIds).toEqual([]);
  });

  it('lets PL!HS-sd1-014-SD recover the just-discarded Hasunosora card', () => {
    const discard = createCardInstance(
      createHasunosoraLive('PL!HS-test-discard-live', 'Discard Live'),
      PLAYER1,
      'discard-hasu-live'
    );
    let state = confirm(start014({ hand: [discard], waiting: [] }), discard.instanceId);

    expect(state.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);
    state = confirm(state, discard.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0]!.hand.cardIds).toEqual([discard.instanceId]);
    expect(state.players[0]!.waitingRoom.cardIds).toEqual([]);
  });

  it('keeps PL!HS-sd1-014-SD paid discard when no Hasunosora target exists', () => {
    const discard = createCardInstance(createOtherMember('PL!SP-test-discard'), PLAYER1, 'discard-other');
    const state = confirm(start014({ hand: [discard], waiting: [] }), discard.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0]!.hand.cardIds).toEqual([]);
    expect(state.players[0]!.waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_SD1_014_ON_ENTER_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID &&
          action.payload.step === 'DISCARD_RECOVER_UNIT_CARD_NO_TARGET'
      )
    ).toBe(true);
  });

  it('consumes PL!HS-sd1-014-SD with no hand cards', () => {
    const state = start014({ hand: [], waiting: [] });

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.reason === 'NO_HAND'
      )
    ).toBe(true);
  });

  it('enqueues hand-to-waiting-room triggers for PL!HS-sd1-014-SD discard cost', () => {
    const discard = createCardInstance(
      createOtherMember('PL!SP-test-trigger-discard'),
      PLAYER1,
      'discard-trigger-card'
    );
    const triggerSource = createCardInstance(
      createHasunosoraMember('PL!HS-pb1-003-R', '大沢瑠璃乃'),
      PLAYER1,
      'pb1-003-trigger-source'
    );
    const target = createCardInstance(
      createHasunosoraLive('PL!HS-test-target-live', 'Target Live'),
      PLAYER1,
      'recover-target-live'
    );
    const state = confirm(
      start014({
        hand: [discard],
        waiting: [target],
        extraStage: [{ card: triggerSource, slot: SlotPosition.LEFT }],
      }),
      discard.instanceId
    );

    expect(state.pendingAbilities.some(
      (ability) =>
        ability.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
        ability.sourceCardId === triggerSource.instanceId
    )).toBe(true);
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(discard.instanceId) === true
      )
    ).toBe(true);
  });

  function start017(options: {
    readonly hasHasunosoraStageMember: boolean;
  }): {
    readonly state: GameState;
    readonly hand: ReturnType<typeof createCardInstance>;
    readonly draw: ReturnType<typeof createCardInstance>;
    readonly live: ReturnType<typeof createCardInstance>;
  } {
    const live = createCardInstance(
      createHasunosoraLive('PL!HS-sd1-017-SD', '夏めきペイン', 2),
      PLAYER1,
      'sd1-017-live'
    );
    const stageMember = createCardInstance(
      options.hasHasunosoraStageMember
        ? createHasunosoraMember('PL!HS-test-stage', 'Stage Hasu')
        : createOtherMember('PL!SP-test-stage', 'Stage Other'),
      PLAYER1,
      'stage-member'
    );
    const hand = createCardInstance(createOtherMember('PL!SP-test-hand'), PLAYER1, '017-hand');
    const draw = createCardInstance(createOtherMember('PL!SP-test-draw'), PLAYER1, '017-draw');
    const game = putCards({
      game: createState([live, stageMember, hand, draw]),
      hand: [hand.instanceId],
      deck: [draw.instanceId],
      liveZone: [live.instanceId],
      stage: [{ cardId: stageMember.instanceId, slot: SlotPosition.CENTER }],
    });
    return {
      state: resolvePendingCardEffects({
        ...game,
        pendingAbilities: [
        pending(
          HS_SD1_017_LIVE_SUCCESS_HASUNOSORA_STAGE_DRAW_DISCARD_ABILITY_ID,
          live.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
        ],
      }).gameState,
      hand,
      draw,
      live,
    };
  }

  it('draws one then discards one for PL!HS-sd1-017-SD with a Hasunosora stage member', () => {
    const { state, hand, draw } = start017({ hasHasunosoraStageMember: true });

    expect(state.activeEffect?.abilityId).toBe(
      HS_SD1_017_LIVE_SUCCESS_HASUNOSORA_STAGE_DRAW_DISCARD_ABILITY_ID
    );
    expect(state.activeEffect?.selectableCardIds).toEqual([hand.instanceId, draw.instanceId]);

    const resolved = confirm(state, hand.instanceId);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0]!.hand.cardIds).toEqual([draw.instanceId]);
    expect(resolved.players[0]!.waitingRoom.cardIds).toEqual([hand.instanceId]);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(hand.instanceId) === true
      )
    ).toBe(true);
  });

  it('consumes PL!HS-sd1-017-SD as no-op without a Hasunosora stage member', () => {
    const { state } = start017({ hasHasunosoraStageMember: false });

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_SD1_017_LIVE_SUCCESS_HASUNOSORA_STAGE_DRAW_DISCARD_ABILITY_ID &&
          action.payload.step === 'DRAW_DISCARD_CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('continues pending effects after PL!HS-sd1-017-SD discard resolution', () => {
    const secondLive = createCardInstance(
      createHasunosoraLive('PL!HS-sd1-017-SD', '夏めきペイン', 2),
      PLAYER1,
      'sd1-017-second-live'
    );
    const setup = start017({ hasHasunosoraStageMember: true });
    const stateWithSecondLive = {
      ...registerCards(setup.state, [secondLive]),
      pendingAbilities: [
        ...setup.state.pendingAbilities,
        pending(
          HS_SD1_017_LIVE_SUCCESS_HASUNOSORA_STAGE_DRAW_DISCARD_ABILITY_ID,
          secondLive.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'second'
        ),
      ],
    };
    const resolved = confirm(stateWithSecondLive, setup.hand.instanceId);

    expect(resolved.activeEffect?.sourceCardId).toBe(secondLive.instanceId);
  });

  function setup018(options: {
    readonly sourceCode?: string;
    readonly stageMemberCount: number;
    readonly waitingLiveName?: string;
    readonly score?: number;
  }): {
    readonly game: GameState;
    readonly live: ReturnType<typeof createCardInstance>;
  } {
    const live = createCardInstance(
      createHasunosoraLive(
        options.sourceCode ?? 'PL!HS-sd1-018-SD',
        'Dream Believers（105期Ver.）',
        3
      ),
      PLAYER1,
      `${options.sourceCode ?? 'sd'}-live`
    );
    const stageMembers = Array.from({ length: options.stageMemberCount }, (_, index) =>
      createCardInstance(
        createHasunosoraMember(`PL!HS-stage-${index}`, `Stage ${index}`),
        PLAYER1,
        `stage-${index}`
      )
    );
    const waitingLive = options.waitingLiveName
      ? createCardInstance(
          createHasunosoraLive('PL!HS-waiting-dream', options.waitingLiveName),
          PLAYER1,
          `waiting-${options.waitingLiveName}`
        )
      : null;
    const game = putCards({
      game: createState([live, ...stageMembers, ...(waitingLive ? [waitingLive] : [])]),
      liveZone: [live.instanceId],
      waiting: waitingLive ? [waitingLive.instanceId] : [],
      stage: stageMembers.map((card, index) => ({
        cardId: card.instanceId,
        slot: [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
      })),
      playerScore: options.score ?? 3,
    });
    return { game, live };
  }

  function resolve018(options: Parameters<typeof setup018>[0]): GameState {
    const { game, live } = setup018(options);
    const preview = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
          live.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    }).gameState;
    return preview.activeEffect?.metadata?.confirmOnlyPendingAbility === true
      ? confirm(preview)
      : preview;
  }

  for (const sourceCode of ['PL!HS-sd1-018-SD', 'PL!HS-sd1-018-SECL'] as const) {
    it(`adds score for ${sourceCode} when stage and waiting-room Dream Believers conditions are met`, () => {
      const state = resolve018({
        sourceCode,
        stageMemberCount: 3,
        waitingLiveName: 'Dream Believers',
        score: 3,
      });

      expect(state.liveResolution.liveModifiers).toContainEqual({
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: `${sourceCode}-live`,
        sourceCardId: `${sourceCode}-live`,
        abilityId: HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
      });
      expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    });
  }

  it('does not add PL!HS-sd1-018 score with fewer than three Hasunosora stage members', () => {
    const state = resolve018({ stageMemberCount: 2, waitingLiveName: 'Dream Believers' });
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3);
  });

  it('does not add PL!HS-sd1-018 score without a Dream Believers LIVE in waiting room', () => {
    const state = resolve018({ stageMemberCount: 3 });
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3);
  });

  for (const name of [
    'Dream Believers',
    'Dream Believers（104期Ver.）',
    'Dream Believers（105期Ver.）',
  ] as const) {
    it(`matches waiting-room card name variant ${name}`, () => {
      const state = resolve018({ stageMemberCount: 3, waitingLiveName: name });
      expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
      expect(
        state.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId ===
              HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID &&
            action.payload.conditionMet === true &&
            action.payload.scoreBonus === 1
        )
      ).toBe(true);
    });
  }

  it('shows PL!HS-sd1-018 realtime condition text for single manual confirm-only pending', () => {
    const { game, live } = setup018({ stageMemberCount: 3, waitingLiveName: 'Dream Believers' });
    const preview = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
          live.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    }).gameState;

    expect(preview.activeEffect).toMatchObject({
      abilityId: HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('当前莲之空成员 3名');
    expect(preview.activeEffect?.effectText).toContain('满足条件，分数+1');
  });

  it('resolves PL!HS-sd1-018 in order without extra confirm-only prompts', () => {
    const first = setup018({
      sourceCode: 'PL!HS-sd1-018-SD',
      stageMemberCount: 3,
      waitingLiveName: 'Dream Believers',
      score: 3,
    });
    const secondLive = createCardInstance(
      createHasunosoraLive('PL!HS-sd1-018-SECL', 'Dream Believers（105期Ver.）'),
      PLAYER1,
      'PL!HS-sd1-018-SECL-live'
    );
    const game = updatePlayer(registerCards(first.game, [secondLive]), PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, secondLive.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const orderSelection = resolvePendingCardEffects({
      ...addCheckTimingRuleSentinel(game, PLAYER1, 'hs-sd1-018-ordered'),
      pendingAbilities: [
        pending(
          HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
          first.live.instanceId,
          TriggerCondition.ON_LIVE_START,
          'first'
        ),
        pending(
          HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
          secondLive.instanceId,
          TriggerCondition.ON_LIVE_START,
          'second'
        ),
      ],
    }).gameState;

    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const resolved = confirmActiveEffectStepThroughPublicReveal(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID
      )
    ).toHaveLength(2);
  });
});
