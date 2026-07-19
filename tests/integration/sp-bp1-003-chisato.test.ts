import { describe, expect, it } from 'vitest';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createMoveMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { enqueueTriggeredCardEffects } from '../../src/application/card-effect-runner';
import { SP_BP1_003_ACTIVATED_REVEAL_HAND_MEMBERS_COST_TOTAL_GAIN_SCORE_ABILITY_ID as ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { stackMemberCardBelowStageMember } from '../../src/application/card-effects/runtime/actions';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addPlayerScoreLiveModifierForTargetMember } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const EFFECT_TEXT =
  '【起动】【1回合1次】公开任意张存在于手牌的成员卡：公开的卡片的费用的合计为，10、20、30、40、50中的任意值的场合，LIVE结束时为止，获得「【常时】LIVE的合计[スコア]+1。」。';

function member(
  cardCode: string,
  id: string,
  cost: number,
  ownerId = P1
): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode,
      name: id,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    ownerId,
    id
  );
}

function live(id: string, ownerId = P1, score = 3): CardInstance<LiveCardData> {
  return createCardInstance(
    {
      cardCode: `LIVE-${id}`,
      name: id,
      cardType: CardType.LIVE,
      score,
      requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    },
    ownerId,
    id
  );
}

function energy(id: string, ownerId = P1): CardInstance<EnergyCardData> {
  return createCardInstance(
    { cardCode: `ENERGY-${id}`, name: id, cardType: CardType.ENERGY },
    ownerId,
    id
  );
}

function setup(
  options: {
    readonly sourceCode?: string;
    readonly sourceOwnerId?: string;
    readonly sourceSlot?: SlotPosition | null;
    readonly sourceOrientation?: OrientationState;
    readonly activePlayerIndex?: number;
    readonly phase?: GamePhase;
    readonly subPhase?: SubPhase;
    readonly handCards?: readonly CardInstance[];
    readonly waitingCards?: readonly CardInstance[];
    readonly otherStageCards?: readonly {
      readonly card: CardInstance<MemberCardData>;
      readonly slot: SlotPosition;
    }[];
  } = {}
) {
  const source = member(
    options.sourceCode ?? 'PL!SP-bp1-003-P',
    'chisato-source',
    10,
    options.sourceOwnerId ?? P1
  );
  const handCards = [...(options.handCards ?? [member('HAND-10', 'hand-10', 10)])];
  const waitingCards = [...(options.waitingCards ?? [])];
  const otherStageCards = [...(options.otherStageCards ?? [])];
  let game = registerCards(createGameState('sp-bp1-003', P1, 'P1', P2, 'P2'), [
    source,
    ...handCards,
    ...waitingCards,
    ...otherStageCards.map(({ card }) => card),
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceSlot !== null) {
      memberSlots = placeCardInSlot(
        memberSlots,
        options.sourceSlot ?? SlotPosition.CENTER,
        source.instanceId,
        {
          orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      );
    }
    for (const { card, slot } of otherStageCards) {
      memberSlots = placeCardInSlot(memberSlots, slot, card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingCards.map((card) => card.instanceId),
      },
      memberSlots,
    };
  });
  game = {
    ...game,
    currentPhase: options.phase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: options.subPhase ?? SubPhase.NONE,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
  };
  const session = createGameSession();
  session.createGame('sp-bp1-003-session', P1, 'P1', P2, 'P2');
  setSessionState(session, game);
  return { session, source, handCards, waitingCards, otherStageCards };
}

function setSessionState(session: ReturnType<typeof createGameSession>, game: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}

function activate(context: ReturnType<typeof setup>, playerId = P1) {
  return context.session.executeCommand(
    createActivateAbilityCommand(playerId, context.source.instanceId, ABILITY_ID)
  );
}

function submitSelection(context: ReturnType<typeof setup>, selectedCardIds: readonly string[]) {
  return context.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      context.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
}

function confirmReveal(context: ReturnType<typeof setup>) {
  return context.session.executeCommand(
    createConfirmEffectStepCommand(P1, context.session.state!.activeEffect!.id)
  );
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

function resolveSelection(context: ReturnType<typeof setup>, selectedCardIds: readonly string[]) {
  expect(activate(context).success).toBe(true);
  expect(submitSelection(context, selectedCardIds).success).toBe(true);
  expect(confirmReveal(context).success).toBe(true);
}

describe('PL!SP-bp1-003 Chisato activated hand-member reveal', () => {
  it.each(['PL!SP-bp1-003-P', 'PL!SP-bp1-003-P＋', 'PL!SP-bp1-003-R＋', 'PL!SP-bp1-003-SEC'])(
    '%s has the one complete activated definition and exact player text',
    (cardCode) => {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        abilityId: ABILITY_ID,
        baseCardCodes: ['PL!SP-bp1-003'],
        category: CardAbilityCategory.ACTIVATED,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
        perTurnLimit: 1,
        effectText: EFFECT_TEXT,
        activatedUi: { abilityId: ABILITY_ID, text: EFFECT_TEXT },
      });
      expect(definitions[0]).not.toHaveProperty('triggerCondition');
    }
  );

  it.each([
    [SlotPosition.LEFT, OrientationState.ACTIVE],
    [SlotPosition.CENTER, OrientationState.WAITING],
    [SlotPosition.RIGHT, OrientationState.ACTIVE],
  ])('starts from %s while %s and shows exact private 0..all copy', (slot, orientation) => {
    const first = member('HAND-4', 'hand-4', 4);
    const second = member('HAND-6', 'hand-6', 6);
    const context = setup({
      sourceSlot: slot,
      sourceOrientation: orientation,
      handCards: [first, second],
    });
    expect(activate(context).success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      effectText: EFFECT_TEXT,
      stepText: '请选择要公开的任意张手牌成员卡。',
      selectableCardIds: ['hand-4', 'hand-6'],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 2,
      selectionLabel: '选择要公开的手牌成员卡',
      confirmSelectionLabel: '公开所选成员卡',
      canSkipSelection: false,
    });
  });

  it.each([
    ['opponent turn', { activePlayerIndex: 1 }],
    ['non-main phase', { phase: GamePhase.ACTIVE_PHASE }],
    ['non-none subphase', { subPhase: SubPhase.EFFECT_WINDOW }],
    ['source off stage', { sourceSlot: null }],
    ['wrong base code', { sourceCode: 'PL!SP-bp1-004-P' }],
    ['wrong owner', { sourceOwnerId: P2 }],
  ] as const)('rejects %s without opening or consuming the ability', (_label, options) => {
    const context = setup(options);
    expect(activate(context).success).toBe(false);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(abilityUseCount(context.session.state!)).toBe(0);
  });

  it('filters candidates to own hand MEMBER cards and keeps pre-submit candidates private', () => {
    const ownMember = member('OWN-MEMBER', 'own-member', 10);
    const ownLive = live('own-live');
    const ownEnergy = energy('own-energy');
    const wrongOwner = member('WRONG-OWNER', 'wrong-owner', 10, P2);
    const otherZone = member('OTHER-ZONE', 'other-zone', 10);
    const context = setup({
      handCards: [ownMember, ownLive, ownEnergy, wrongOwner],
      waitingCards: [otherZone],
    });
    expect(activate(context).success).toBe(true);
    expect(context.session.state?.activeEffect?.selectableCardIds).toEqual(['own-member']);
    const ownView = projectPlayerViewState(context.session.state!, P1);
    const opponentView = projectPlayerViewState(context.session.state!, P2);
    expect(ownView.activeEffect?.selectableObjectIds).toEqual([createPublicObjectId('own-member')]);
    expect(opponentView.activeEffect?.selectableObjectIds).toBeUndefined();
  });

  it('publishes only the submitted cards, preserves hand order, and clears old selection fields', () => {
    const cards = [
      member('HAND-4', 'hand-4', 4),
      member('HAND-6', 'hand-6', 6),
      member('HAND-9', 'hand-9', 9),
    ];
    const context = setup({ handCards: cards });
    expect(activate(context).success).toBe(true);
    expect(submitSelection(context, ['hand-6', 'hand-4']).success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({
      stepText: '已公开所选手牌。确认后，根据公开卡片的费用合计结算。',
      revealedCardIds: ['hand-6', 'hand-4'],
      selectionLabel: '公开的卡片',
      confirmSelectionLabel: '确认公开结果',
      metadata: {
        revealedHandMemberCardIds: ['hand-6', 'hand-4'],
        effectiveCosts: [
          { cardId: 'hand-6', effectiveCost: 6 },
          { cardId: 'hand-4', effectiveCost: 4 },
        ],
        effectiveCostTotal: 10,
        conditionMet: true,
      },
    });
    expect(context.session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    expect(context.session.state?.activeEffect?.selectableCardMode).toBeUndefined();
    expect(context.session.state?.activeEffect?.minSelectableCards).toBeUndefined();
    expect(context.session.state?.activeEffect?.maxSelectableCards).toBeUndefined();
    expect(context.session.state?.players[0].hand.cardIds).toEqual(['hand-4', 'hand-6', 'hand-9']);
    for (const playerId of [P1, P2]) {
      expect(
        projectPlayerViewState(context.session.state!, playerId).activeEffect?.revealedObjectIds
      ).toEqual([createPublicObjectId('hand-6'), createPublicObjectId('hand-4')]);
    }
  });

  it('accepts 0, 1, multiple, and all choices; legal zero consumes turn1 but grants no SCORE', () => {
    const zero = setup({ handCards: [] });
    expect(activate(zero).success).toBe(true);
    expect(zero.session.state?.activeEffect).toMatchObject({
      selectableCardIds: [],
      minSelectableCards: 0,
      maxSelectableCards: 0,
    });
    expect(submitSelection(zero, []).success).toBe(true);
    expect(zero.session.state?.activeEffect?.revealedCardIds).toEqual([]);
    expect(abilityUseCount(zero.session.state!)).toBe(1);
    expect(confirmReveal(zero).success).toBe(true);
    expect(zero.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(activate(zero).success).toBe(false);

    for (const costs of [[10], [4, 6], [4, 6, 10]]) {
      const cards = costs.map((cost, index) =>
        member(`HAND-${cost}-${index}`, `card-${index}`, cost)
      );
      const context = setup({ handCards: cards });
      resolveSelection(
        context,
        cards.map((card) => card.instanceId)
      );
      expect(context.session.state?.players[0].hand.cardIds).toEqual(
        cards.map((card) => card.instanceId)
      );
      expect(abilityUseCount(context.session.state!)).toBe(1);
    }
  });

  it.each([10, 20, 30, 40, 50])(
    'effective total %i grants exactly one source-bound player SCORE modifier',
    (cost) => {
      const card = member(`HAND-${cost}`, `hand-${cost}`, cost);
      const context = setup({ handCards: [card] });
      resolveSelection(context, [card.instanceId]);
      expect(context.session.state?.liveResolution.liveModifiers).toEqual([
        {
          kind: 'SCORE',
          playerId: P1,
          countDelta: 1,
          targetMemberCardId: context.source.instanceId,
          sourceCardId: context.source.instanceId,
          abilityId: ABILITY_ID,
        },
      ]);
      expect(context.session.state?.liveResolution.playerScores.size).toBe(0);
    }
  );

  it.each([9, 11, 19, 21, 51])(
    'effective total %i grants no SCORE but still consumes the legal reveal',
    (cost) => {
      const card = member(`HAND-${cost}`, `hand-${cost}`, cost);
      const context = setup({ handCards: [card] });
      resolveSelection(context, [card.instanceId]);
      expect(context.session.state?.liveResolution.liveModifiers).toEqual([]);
      expect(abilityUseCount(context.session.state!)).toBe(1);
    }
  );

  it('uses one complete hand snapshot for LL-bp2-001 effective costs (Q129)', () => {
    const dynamic = member('LL-bp2-001-R＋', 'll-bp2-001', 20);
    const fillers = Array.from({ length: 4 }, (_, index) =>
      member(`FILLER-${index}`, `filler-${index}`, 1)
    );
    const context = setup({ handCards: [dynamic, ...fillers] });
    expect(activate(context).success).toBe(true);
    expect(submitSelection(context, [dynamic.instanceId]).success).toBe(true);
    expect(context.session.state?.activeEffect?.metadata).toMatchObject({
      effectiveCosts: [{ cardId: dynamic.instanceId, effectiveCost: 16 }],
      effectiveCostTotal: 16,
      conditionMet: false,
    });
    expect(confirmReveal(context).success).toBe(true);
    expect(context.session.state?.liveResolution.liveModifiers).toEqual([]);

    const first = member('LL-bp2-001-R＋', 'dynamic-first', 20);
    const second = member('LL-bp2-001-R＋', 'dynamic-second', 20);
    const sameSnapshot = setup({
      handCards: [first, second, ...fillers.slice(0, 3)],
    });
    expect(activate(sameSnapshot).success).toBe(true);
    expect(submitSelection(sameSnapshot, [first.instanceId, second.instanceId]).success).toBe(true);
    expect(sameSnapshot.session.state?.activeEffect?.metadata).toMatchObject({
      effectiveCosts: [
        { cardId: first.instanceId, effectiveCost: 16 },
        { cardId: second.instanceId, effectiveCost: 16 },
      ],
      effectiveCostTotal: 32,
    });
  });

  it('rejects duplicate, forged, non-MEMBER, wrong-owner, stale, and source-stale submissions without use', () => {
    const ownMember = member('OWN-MEMBER', 'own-member', 10);
    const ownLive = live('own-live');
    const wrongOwner = member('WRONG-OWNER', 'wrong-owner', 10, P2);
    for (const selectedCardIds of [
      ['own-member', 'own-member'],
      ['forged'],
      [ownLive.instanceId],
      [wrongOwner.instanceId],
    ]) {
      const context = setup({ handCards: [ownMember, ownLive, wrongOwner] });
      expect(activate(context).success).toBe(true);
      expect(submitSelection(context, selectedCardIds).success).toBe(false);
      expect(abilityUseCount(context.session.state!)).toBe(0);
      expect(context.session.state?.liveResolution.liveModifiers).toEqual([]);
    }

    const stale = setup({ handCards: [ownMember] });
    expect(activate(stale).success).toBe(true);
    setSessionState(
      stale.session,
      updatePlayer(stale.session.state!, P1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: [] },
      }))
    );
    expect(submitSelection(stale, [ownMember.instanceId]).success).toBe(false);
    expect(abilityUseCount(stale.session.state!)).toBe(0);

    const sourceStale = setup({ handCards: [ownMember] });
    expect(activate(sourceStale).success).toBe(true);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      sourceStale.session.state!,
      P1,
      sourceStale.source.instanceId,
      enqueueTriggeredCardEffects
    )!;
    setSessionState(sourceStale.session, left.gameState);
    expect(submitSelection(sourceStale, [ownMember.instanceId]).success).toBe(false);
    expect(abilityUseCount(sourceStale.session.state!)).toBe(0);
  });

  it('does not recompute the accepted cost snapshot and does not stack on repeated confirmation', () => {
    const card = member('HAND-10', 'hand-10', 10);
    const context = setup({ handCards: [card] });
    expect(activate(context).success).toBe(true);
    expect(submitSelection(context, [card.instanceId]).success).toBe(true);
    const effectId = context.session.state!.activeEffect!.id;
    setSessionState(
      context.session,
      updatePlayer(context.session.state!, P1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: [] },
      }))
    );
    expect(confirmReveal(context).success).toBe(true);
    expect(context.session.state?.liveResolution.liveModifiers).toHaveLength(1);
    expect(
      context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId)).success
    ).toBe(false);
    expect(context.session.state?.liveResolution.liveModifiers).toHaveLength(1);
  });

  it('preserves other SCORE modifiers and real LIVE result scoring reads the +1', () => {
    const other = member('OTHER', 'other-stage', 1);
    const card = member('HAND-10', 'hand-10', 10);
    const context = setup({
      handCards: [card],
      otherStageCards: [{ card: other, slot: SlotPosition.LEFT }],
    });
    const existing = addPlayerScoreLiveModifierForTargetMember(context.session.state!, {
      playerId: P1,
      targetMemberCardId: other.instanceId,
      sourceCardId: other.instanceId,
      abilityId: 'other-score',
      countDelta: 2,
    })!;
    setSessionState(context.session, existing.gameState);
    resolveSelection(context, [card.instanceId]);
    expect(context.session.state?.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ abilityId: 'other-score', countDelta: 2 }),
        expect.objectContaining({ abilityId: ABILITY_ID, countDelta: 1 }),
      ])
    );

    const liveCard = live('scoring-live', P1, 3);
    let judgmentState = registerCards(context.session.state!, [liveCard]);
    judgmentState = updatePlayer(judgmentState, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, liveCard.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    judgmentState = {
      ...judgmentState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      liveResolution: {
        ...judgmentState.liveResolution,
        liveResults: new Map([[liveCard.instanceId, true]]),
        playerScores: new Map(),
      },
    };
    const result = new GameService().executeLiveResultPhase(judgmentState);
    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.playerScores.get(P1)).toBe(6);
  });

  it('keeps the modifier through LEFT/CENTER/RIGHT movement and removes only the member that leaves (Q78)', () => {
    const other = member('OTHER', 'other-stage', 1);
    const card = member('HAND-10', 'hand-10', 10);
    const context = setup({
      handCards: [card],
      sourceSlot: SlotPosition.LEFT,
      otherStageCards: [{ card: other, slot: SlotPosition.CENTER }],
    });
    resolveSelection(context, [card.instanceId]);

    expect(
      context.session.executeCommand(
        createMoveMemberToSlotCommand(
          P1,
          context.source.instanceId,
          SlotPosition.LEFT,
          SlotPosition.RIGHT
        )
      ).success
    ).toBe(true);
    expect(context.session.state?.liveResolution.liveModifiers).toHaveLength(1);
    expect(
      context.session.executeCommand(
        createMoveMemberToSlotCommand(
          P1,
          context.source.instanceId,
          SlotPosition.RIGHT,
          SlotPosition.CENTER
        )
      ).success
    ).toBe(true);
    expect(context.session.state?.liveResolution.liveModifiers).toHaveLength(1);

    const otherLeaves = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      context.session.state!,
      P1,
      other.instanceId,
      enqueueTriggeredCardEffects
    )!;
    expect(otherLeaves.gameState.liveResolution.liveModifiers).toHaveLength(1);
    const sourceLeaves = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      otherLeaves.gameState,
      P1,
      context.source.instanceId,
      enqueueTriggeredCardEffects
    )!;
    expect(sourceLeaves.gameState.liveResolution.liveModifiers).toEqual([]);
  });

  it('remains gone when the source becomes memberBelow after the standard leave-stage path', () => {
    const host = member('PL!SP-pb2-005-P', 'special-host', 10);
    const card = member('HAND-10', 'hand-10', 10);
    const context = setup({
      handCards: [card],
      otherStageCards: [{ card: host, slot: SlotPosition.LEFT }],
    });
    resolveSelection(context, [card.instanceId]);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      context.session.state!,
      P1,
      context.source.instanceId,
      enqueueTriggeredCardEffects
    )!;
    expect(left.gameState.liveResolution.liveModifiers).toEqual([]);
    const stacked = stackMemberCardBelowStageMember(left.gameState, {
      playerId: P1,
      movedCardId: context.source.instanceId,
      hostCardId: host.instanceId,
      targetSlot: SlotPosition.LEFT,
      sourceZone: ZoneType.WAITING_ROOM,
    });
    expect(stacked).not.toBeNull();
    expect(stacked?.gameState.players[0].memberSlots.memberBelow[SlotPosition.LEFT]).toContain(
      context.source.instanceId
    );
    expect(stacked?.gameState.liveResolution.liveModifiers).toEqual([]);
  });

  it.each([
    ['normal LIVE', true],
    ['no LIVE this turn (Q171)', false],
  ] as const)('clears at LIVE result settlement after %s', (_label, withLive) => {
    const card = member('HAND-10', 'hand-10', 10);
    const context = setup({ handCards: [card] });
    resolveSelection(context, [card.instanceId]);
    let state = context.session.state!;
    if (withLive) {
      const liveCard = live('settlement-live');
      state = registerCards(state, [liveCard]);
      state = updatePlayer(state, P1, (player) => ({
        ...player,
        liveZone: addCardToStatefulZone(player.liveZone, liveCard.instanceId),
      }));
      state = {
        ...state,
        liveResolution: {
          ...state.liveResolution,
          liveResults: new Map([[liveCard.instanceId, true]]),
        },
      };
    }
    const finalized = new GameService().finalizeLiveResult({
      ...state,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
    });
    expect(finalized.success).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
  });
});
