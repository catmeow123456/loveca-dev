import { describe, expect, it } from 'vitest';
import type { MemberCardData, PendingAbilityState } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
  BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
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
  name: string,
  options: {
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: options.groupNames ?? ["μ's"],
    unitName: options.groupNames?.[0] ?? "μ's",
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupKotoriGame(options: {
  readonly sourceSlot?: SlotPosition;
  readonly handCandidates?: readonly ReturnType<typeof createCardInstance>[];
  readonly memberBelowCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly pendingAbilityId: string;
}): GameState {
  const source = createCardInstance(
    createMember('PL!-bp6-003-P', '南ことり', { cost: 15 }),
    PLAYER1,
    'kotori-source'
  );
  const handCandidates = options.handCandidates ?? [];
  const memberBelowCards = options.memberBelowCards ?? [];
  let game = createGameState('bp6-003-kotori', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...handCandidates, ...memberBelowCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      options.sourceSlot ?? SlotPosition.CENTER,
      source.instanceId,
      activeFaceUp()
    );
    for (const card of memberBelowCards) {
      memberSlots = addMemberBelowMember(
        memberSlots,
        options.sourceSlot ?? SlotPosition.CENTER,
        card.instanceId
      );
    }
    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds: handCandidates.map((card) => card.instanceId),
      },
      memberSlots,
    };
  });
  return {
    ...game,
    pendingAbilities: [
      createPendingAbility(
        options.pendingAbilityId,
        source.instanceId,
        options.sourceSlot ?? SlotPosition.CENTER
      ),
    ],
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  sourceSlot: SlotPosition
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: false,
    timingId: abilityId.includes('live-start')
      ? TriggerCondition.ON_LIVE_START
      : TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`event:${abilityId}`],
    sourceSlot,
  };
}

function createSessionWithState(game: GameState) {
  const session = createGameSession();
  session.createGame('bp6-003-kotori-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmEffect(
  session: ReturnType<typeof createSessionWithState>,
  selectedCardId?: string | null,
  selectedSlot?: SlotPosition | null,
  selectedOptionId?: string | null
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      selectedCardId,
      selectedSlot,
      undefined,
      selectedOptionId
    )
  );
}

function activeFaceUp() {
  return {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  };
}

describe('PL!-bp6-003 Kotori memberBelow workflow', () => {
  it('reveals a low-cost Muse hand member, stacks it below, and gains exactly one selected Heart', () => {
    const handMember = createCardInstance(
      createMember('PL!-bp1-test-low-cost', '低费μ成员', { cost: 2 }),
      PLAYER1,
      'hand-low-cost-muse'
    );
    const existingBelow = createCardInstance(
      createMember('PL!-existing-below', '既有下方成员', { cost: 2 }),
      PLAYER1,
      'existing-below'
    );
    const game = setupKotoriGame({
      handCandidates: [handMember],
      memberBelowCards: [existingBelow],
      pendingAbilityId:
        BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
    });
    const session = createSessionWithState(resolvePendingCardEffects(game).gameState);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId:
        BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
      selectableCardIds: [handMember.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });

    expect(confirmEffect(session, handMember.instanceId).success).toBe(true);
    expect(session.state?.activeEffect?.revealedCardIds).toEqual([handMember.instanceId]);

    expect(confirmEffect(session, undefined, undefined, HeartColor.BLUE).success).toBe(true);
    const player = session.state!.players[0]!;
    expect(player.hand.cardIds).not.toContain(handMember.instanceId);
    expect(player.memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      existingBelow.instanceId,
      handMember.instanceId,
    ]);
    expect(
      session.state?.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.abilityId ===
            BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID
      )
    ).toEqual([
      {
        kind: 'HEART',
        playerId: PLAYER1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        sourceCardId: 'kotori-source',
        abilityId:
          BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
        target: 'SOURCE_MEMBER',
      },
    ]);
  });

  it('skips live start outside center or when no legal hand candidate exists', () => {
    const leftGame = setupKotoriGame({
      sourceSlot: SlotPosition.LEFT,
      handCandidates: [
        createCardInstance(createMember('PL!-low-cost', 'low', { cost: 2 }), PLAYER1, 'low'),
      ],
      pendingAbilityId:
        BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
    });
    const leftResult = resolvePendingCardEffects(leftGame).gameState;
    expect(leftResult.activeEffect).toBeNull();
    expect(leftResult.actionHistory.some((action) => action.payload.step === 'SOURCE_NOT_CENTER')).toBe(
      true
    );

    const noCandidate = setupKotoriGame({
      handCandidates: [
        createCardInstance(
          createMember('PL!-high-cost', 'high', { cost: 3 }),
          PLAYER1,
          'high-cost'
        ),
      ],
      pendingAbilityId:
        BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
    });
    const noCandidateResult = resolvePendingCardEffects(noCandidate).gameState;
    expect(noCandidateResult.activeEffect).toBeNull();
    expect(
      noCandidateResult.actionHistory.some(
        (action) => action.payload.step === 'NO_HAND_LOW_COST_MUSE_MEMBER'
      )
    ).toBe(true);
  });

  it('plays a low-cost Muse member from below to an empty slot and records enter-stage event', () => {
    const belowMember = createCardInstance(
      createMember('PL!-below-low-cost', 'below', { cost: 2 }),
      PLAYER1,
      'below-low-cost'
    );
    const game = setupKotoriGame({
      memberBelowCards: [belowMember],
      pendingAbilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    });
    const session = createSessionWithState(resolvePendingCardEffects(game).gameState);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([belowMember.instanceId]);
    expect(confirmEffect(session, belowMember.instanceId).success).toBe(true);
    expect(confirmEffect(session, undefined, SlotPosition.RIGHT).success).toBe(true);

    const player = session.state!.players[0]!;
    expect(player.memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(player.memberSlots.slots[SlotPosition.RIGHT]).toBe(belowMember.instanceId);
    expect(player.memberSlots.cardStates.get(belowMember.instanceId)).toEqual(activeFaceUp());
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === belowMember.instanceId &&
          entry.event.fromZone === 'MEMBER_SLOT'
      )
    ).toBe(true);
  });

  it('skips live success when there is no legal below member or no empty member slot', () => {
    const highCostBelow = createCardInstance(
      createMember('PL!-below-high-cost', 'below high', { cost: 3 }),
      PLAYER1,
      'below-high-cost'
    );
    const noLegal = setupKotoriGame({
      memberBelowCards: [highCostBelow],
      pendingAbilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    });
    const noLegalResult = resolvePendingCardEffects(noLegal).gameState;
    expect(noLegalResult.actionHistory.some((action) => action.payload.step === 'NO_LOW_COST_MUSE_MEMBER_BELOW')).toBe(
      true
    );

    const legalBelow = createCardInstance(
      createMember('PL!-below-legal', 'below legal', { cost: 2 }),
      PLAYER1,
      'below-legal'
    );
    const leftBlocker = createCardInstance(
      createMember('PL!-left-blocker', 'left blocker', { cost: 2 }),
      PLAYER1,
      'left-blocker'
    );
    const rightBlocker = createCardInstance(
      createMember('PL!-right-blocker', 'right blocker', { cost: 2 }),
      PLAYER1,
      'right-blocker'
    );
    let noEmptySlot = setupKotoriGame({
      memberBelowCards: [legalBelow],
      pendingAbilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    });
    noEmptySlot = registerCards(noEmptySlot, [leftBlocker, rightBlocker]);
    noEmptySlot = updatePlayer(noEmptySlot, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, leftBlocker.instanceId, activeFaceUp()),
        SlotPosition.RIGHT,
        rightBlocker.instanceId,
        activeFaceUp()
      ),
    }));
    const noEmptySlotResult = resolvePendingCardEffects(noEmptySlot).gameState;
    expect(noEmptySlotResult.actionHistory.some((action) => action.payload.step === 'NO_EMPTY_MEMBER_SLOT')).toBe(
      true
    );
  });
});
