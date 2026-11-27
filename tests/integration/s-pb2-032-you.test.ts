import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID as DELEGATE,
  S_PB2_032_ON_ENTER_DISCARD_LOOK_TOP_AQOURS_MEMBER_ABILITY_ID as ABILITY,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { returnStageMemberToHandAndEnqueueTriggers } from '../../src/application/card-effects/runtime/return-stage-member-to-hand';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  type EnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { getNovember20MemberData } from '../helpers/november-20-draft-effects';

const P1 = 'p1';
const P2 = 'p2';
const BASE_CODE = 'PL!S-pb2-032';
const TEXT =
  '【登场】可以将１张手牌放置入休息室：检视自己的卡组顶的５张卡片。可以将其中的１张不持有BLADE HEART的『Aqours』的成员卡公开并加入手牌。其余的放置入休息室。';

function member(id: string) {
  const data: MemberCardData = {
    cardType: CardType.MEMBER,
    cardCode: `TEST-${id}`,
    name: id,
    groupNames: ['Liella!'],
    cost: 4,
    blade: 1,
    hearts: [],
  };
  return createCardInstance(data, P1, id);
}

function exportedMember(code: string, id: string) {
  return createCardInstance(getNovember20MemberData(code), P1, id);
}

function setup(
  options: {
    readonly hand?: readonly string[];
    readonly sourceOnStage?: boolean;
    readonly withDelegator?: boolean;
    readonly noTarget?: boolean;
    readonly energyCount?: number;
  } = {}
) {
  const source = exportedMember(BASE_CODE, 'source');
  const delegator = options.withDelegator ? exportedMember('PL!S-bp7-005', 'delegator') : null;
  const hand = (options.hand ?? ['discard']).map(member);
  const aqoursLive: LiveCardData = {
    cardType: CardType.LIVE,
    cardCode: 'TEST-AQOURS-LIVE',
    name: 'Aqours LIVE',
    groupNames: ['Aqours'],
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
  const topFive = [
    options.noTarget ? member('third-other-group') : exportedMember('PL!S-pb1-014', 'valid'),
    exportedMember('PL!S-bp5-014', 'with-blade-heart'),
    member('other-group'),
    createCardInstance(aqoursLive, P1, 'aqours-live'),
    member('fifth'),
  ];
  const sixth = exportedMember('PL!S-pb1-014', 'sixth');
  const energy = Array.from({ length: options.energyCount ?? 4 }, (_, index) =>
    createCardInstance(
      { cardType: CardType.ENERGY, cardCode: `E-${index}`, name: 'Energy' },
      P1,
      `energy-${index}`
    )
  );
  const game = registerCards(
    {
      ...createGameState('s-pb2-032', P1, 'P1', P2, 'P2'),
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    },
    [source, ...hand, ...topFive, sixth, ...energy, ...(delegator ? [delegator] : [])]
  );
  const state = updatePlayer(game, P1, (player) => {
    let slots = player.memberSlots;
    if (options.sourceOnStage) {
      slots = placeCardInSlot(slots, SlotPosition.RIGHT, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (delegator) {
      slots = placeCardInSlot(slots, SlotPosition.CENTER, delegator.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots: slots,
      hand: {
        ...player.hand,
        cardIds: [
          ...(options.sourceOnStage ? [] : [source.instanceId]),
          ...hand.map((card) => card.instanceId),
        ],
      },
      mainDeck: { ...player.mainDeck, cardIds: [...topFive, sixth].map((card) => card.instanceId) },
      energyZone: {
        ...player.energyZone,
        cardIds: energy.map((card) => card.instanceId),
        cardStates: new Map(
          energy.map(({ instanceId }) => [
            instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
    };
  });
  let now = 1_000;
  const session = createGameSession({ now: () => now });
  session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });

  function confirm(cardId: string | null | undefined, option?: string, cards?: readonly string[]) {
    return session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        session.state!.activeEffect!.id,
        cardId,
        undefined,
        undefined,
        option,
        cards
      )
    );
  }

  return {
    session,
    state,
    topIds: topFive.map((card) => card.instanceId),
    play: () =>
      session.executeCommand(
        createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.RIGHT)
      ),
    confirm,
    advance: (time: number) => {
      const effect = session.state!.activeEffect!;
      now = time;
      return session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          P2,
          effect.id,
          effect.publicRevealAutoAdvanceAt!,
          effect.publicRevealGeneration!
        )
      );
    },
  };
}

describe('PL!S-pb2-032 费用4「渡边曜」', () => {
  it('registers the exact exported paragraph at ON_ENTER for all rarities', () => {
    for (const rarity of ['N', 'UNSEEN']) {
      expect(getCardAbilityDefinitionsForCardCode(`${BASE_CODE}-${rarity}`)).toEqual([
        expect.objectContaining({
          abilityId: ABILITY,
          baseCardCodes: [BASE_CODE],
          category: 'ON_ENTER',
          sourceZone: 'PLAYED_MEMBER',
          triggerCondition: TriggerCondition.ON_ENTER_STAGE,
          implemented: true,
          queued: true,
          effectText: TEXT,
          delegatedOnEnterFromWaitingRoomPolicy: {
            decision: 'ALLOW',
            reason: 'PLAYER_RESOURCE_COST',
          },
        }),
      ]);
    }
  });

  it('pays the real play cost, inspects exactly five, and only reveals the selected card until moving', () => {
    const insufficientEnergy = setup({ energyCount: 3 });
    expect(insufficientEnergy.play().success).toBe(false);
    expect(insufficientEnergy.session.state!.players[0].hand.cardIds).toEqual([
      'source',
      'discard',
    ]);
    expect(insufficientEnergy.session.state!.activeEffect).toBeNull();

    const { session, play, confirm, advance, topIds } = setup();
    expect(play().success).toBe(true);
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe('source');
    expect([...session.state!.players[0].energyZone.cardStates.values()]).toEqual(
      Array.from({ length: 4 }, () => ({
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }))
    );
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: ABILITY,
      effectText: TEXT,
      selectableCardIds: ['discard'],
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    });

    expect(confirm('discard').success).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      effectText: TEXT,
      inspectionCardIds: topIds,
      selectableCardIds: ['valid'],
      confirmSelectionLabel: '公开并加入手牌',
      skipSelectionLabel: '全部放置入休息室',
    });
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['sixth']);
    const opponent = session.getPlayerViewState(P2)!;
    expect(opponent.activeEffect?.selectableObjectIds).toBeUndefined();
    for (const id of topIds) {
      expect(session.getPlayerViewState(P1)!.objects[createPublicObjectId(id)]?.surface).toBe(
        'FRONT'
      );
      expect(opponent.objects[createPublicObjectId(id)]?.surface).toBe('BACK');
    }
    for (const rejected of [...topIds.slice(1), 'sixth']) {
      expect(confirm(rejected).success).toBe(false);
    }

    expect(confirm('valid').success).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
      stepText: '已公开所选Aqours成员卡。展示结束后加入手牌，其余检视牌放置入休息室。',
    });
    expect(session.state!.inspectionZone.revealedCardIds).toEqual(['valid']);
    const opponentDuringReveal = session.getPlayerViewState(P2)!;
    expect(opponentDuringReveal.objects[createPublicObjectId('valid')]?.surface).toBe('FRONT');
    for (const id of topIds.slice(1)) {
      expect(opponentDuringReveal.objects[createPublicObjectId(id)]?.surface).toBe('BACK');
    }
    const deadline = session.state!.activeEffect!.publicRevealAutoAdvanceAt!;
    expect(advance(deadline - 1).success).toBe(false);
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['discard']);
    expect(advance(deadline).success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].hand.cardIds).toEqual(['valid']);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['discard', ...topIds.slice(1)]);
    expect(
      session
        .state!.eventLog.map(({ event }) => event)
        .filter(
          (event): event is EnterWaitingRoomEvent =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
        )
        .map(({ fromZone, cardInstanceIds }) => ({ fromZone, cardInstanceIds }))
    ).toEqual([
      { fromZone: ZoneType.HAND, cardInstanceIds: ['discard'] },
      { fromZone: ZoneType.MAIN_DECK, cardInstanceIds: topIds.slice(1) },
    ]);
  });

  it('can decline before paying and cannot inspect when the played card was the only hand card', () => {
    const decline = setup();
    expect(decline.play().success).toBe(true);
    expect(decline.confirm(null).success).toBe(true);
    expect(decline.session.state!.players[0].hand.cardIds).toEqual(['discard']);
    const noHand = setup({ hand: [] });
    expect(noHand.play().success).toBe(true);
    for (const { session, topIds } of [decline, noHand]) {
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.players[0].mainDeck.cardIds).toEqual([...topIds, 'sixth']);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual([]);
      expect(session.state!.inspectionZone.cardIds).toEqual([]);
    }
  });

  it.each([true, false])(
    'keeps the paid cost and puts all five inspected cards into the waiting room when taking none (no target: %s)',
    (noTarget) => {
      const { session, play, confirm, topIds } = setup({ noTarget });
      expect(play().success).toBe(true);
      expect(confirm('discard').success).toBe(true);
      expect(session.state!.activeEffect?.selectableCardIds).toEqual(noTarget ? [] : ['valid']);
      expect(session.state!.inspectionZone.cardIds).toEqual(topIds);
      expect(confirm(null).success).toBe(true);
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.players[0].hand.cardIds).toEqual([]);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['discard', ...topIds]);
    }
  );

  it('can pay with the original source after it returns to hand before the pending ability starts', () => {
    const { state, session, confirm } = setup({ sourceOnStage: true, hand: [] });
    const stageEvent = createEnterStageEvent('source', ZoneType.HAND, SlotPosition.RIGHT, P1, P1);
    const queued = enqueueTriggeredCardEffects(emitGameEvent(state, stageEvent), [
      TriggerCondition.ON_ENTER_STAGE,
    ]);
    expect(queued.pendingAbilities).toEqual([expect.objectContaining({ abilityId: ABILITY })]);
    const returned = returnStageMemberToHandAndEnqueueTriggers(
      queued,
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!.gameState;
    session.restoreRuntimeState({
      authorityState: resolvePendingCardEffects(returned).gameState,
      currentPublicSeq: 0,
    });
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['source']);
    expect(confirm('source').success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['source']);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['valid']);
    expect(confirm(null).success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
  });

  it('pays the child discard separately when the cost-15 You invokes the ability from the stage', () => {
    const { session, confirm } = setup({
      sourceOnStage: true,
      withDelegator: true,
      hand: ['first', 'second', 'child-cost'],
    });
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, 'delegator', DELEGATE)).success
    ).toBe(true);
    expect(confirm(undefined, undefined, ['first', 'second']).success).toBe(true);
    expect(confirm('source').success).toBe(true);
    expect(confirm(undefined, 'target-first').success).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: 'source',
      selectableCardIds: ['child-cost'],
    });
    expect(session.state!.inspectionZone.cardIds).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['first', 'second']);
    expect(confirm('child-cost').success).toBe(true);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([
      'first',
      'second',
      'child-cost',
    ]);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['valid']);
    expect(confirm(null).success).toBe(true);
    expect(session.state!.activeEffect?.sourceCardId).toBe('delegator');
    expect(confirm('first').success).toBe(true);
    expect(confirm('delegator').success).toBe(true);
    expect(session.state!.delegatedAbilitySequence).toBeNull();
    expect(session.state!.activeEffect).toBeNull();
  });
});
