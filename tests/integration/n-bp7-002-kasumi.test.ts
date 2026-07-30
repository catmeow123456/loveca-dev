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
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import { N_BP7_002_ON_ENTER_THREE_QU4RTZ_RECOVER_CARD_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
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
const EFFECT_TEXT =
  '【登场】自己的舞台上存在大于等于3名『QU4RTZ』的成员的场合，从自己的休息室将1张卡片加入手牌。';

function member(cardCode: string, unitName?: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹咲学園スクールアイドル同好会'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    bladeHearts: [],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'n-bp7-002-pending',
    abilityId: N_BP7_002_ON_ENTER_THREE_QU4RTZ_RECOVER_CARD_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
    eventIds: ['n-bp7-002-enter-event'],
  };
}

function setup(qu4rtzCount: number, withWaitingCard = true) {
  let now = 10_000;
  const source = createCardInstance(member('PL!N-bp7-002-P', 'QU4RTZ'), P1, 'kasumi');
  const otherStageCards = [
    createCardInstance(member('STAGE-LEFT', 'QU4RTZ'), P1, 'stage-left'),
    createCardInstance(
      member('STAGE-RIGHT', qu4rtzCount >= 3 ? 'QU4RTZ' : 'DiverDiva'),
      P1,
      'stage-right'
    ),
  ];
  const waiting = createCardInstance(live('WAITING-LIVE'), P1, 'waiting-live');
  let game = registerCards(createGameState('n-bp7-002', P1, 'P1', P2, 'P2'), [
    source,
    ...otherStageCards,
    waiting,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (qu4rtzCount >= 2) {
      memberSlots = placeCardInSlot(
        memberSlots,
        SlotPosition.LEFT,
        otherStageCards[0]!.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      );
    }
    if (qu4rtzCount >= 3) {
      memberSlots = placeCardInSlot(
        memberSlots,
        SlotPosition.RIGHT,
        otherStageCards[1]!.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      );
    }
    return {
      ...player,
      memberSlots,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: withWaitingCard ? [waiting.instanceId] : [],
      },
    };
  });
  game = { ...game, pendingAbilities: [pending(source.instanceId)] };
  const session = createGameSession({ now: () => now });
  session.createGame('n-bp7-002-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState =
    resolvePendingCardEffects(game).gameState;
  return {
    session,
    waiting,
    setNow(value: number) {
      now = value;
    },
  };
}

describe('PL!N-bp7-002-P 中须霞', () => {
  it('registers one base-family ON_ENTER definition with the full exported Chinese paragraph', () => {
    for (const cardCode of ['PL!N-bp7-002-P', 'PL!N-bp7-002-SEC']) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        abilityId: N_BP7_002_ON_ENTER_THREE_QU4RTZ_RECOVER_CARD_ABILITY_ID,
        baseCardCodes: ['PL!N-bp7-002'],
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
        effectText: EFFECT_TEXT,
      });
    }
  });

  it('requires three current top-level QU4RTZ members and counts WAITING members', () => {
    const belowThree = setup(2);
    expect(belowThree.session.state?.activeEffect).toBeNull();
    expect(belowThree.session.state?.pendingAbilities).toEqual([]);
    expect(belowThree.session.state?.actionHistory.at(-1)?.payload.step).toBe(
      'QU4RTZ_STAGE_MEMBER_COUNT_BELOW_THREE'
    );

    const three = setup(3);
    expect(three.session.state?.activeEffect).toMatchObject({
      abilityId: N_BP7_002_ON_ENTER_THREE_QU4RTZ_RECOVER_CARD_ABILITY_ID,
      effectText: EFFECT_TEXT,
      stepText: '请选择自己的休息室中1张卡片加入手牌。',
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      selectableCardIds: [three.waiting.instanceId],
      canSkipSelection: false,
      metadata: {
        zoneSelection: {
          source: 'WAITING_ROOM',
          destination: 'HAND',
          minCount: 1,
          maxCount: 1,
          optional: false,
        },
      },
    });
  });

  it('consumes the pending safely when the condition holds but the waiting room is empty', () => {
    const { session } = setup(3, false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.actionHistory.at(-1)?.payload.step).toBe('NO_WAITING_ROOM_CARD_TARGET');
  });

  it('uses public-card-selection confirmation and moves the chosen card only after the dwell', () => {
    const context = setup(3);
    const effectId = context.session.state!.activeEffect!.id;
    expect(
      context.session.executeCommand(
        createConfirmEffectStepCommand(P1, effectId, context.waiting.instanceId)
      ).success
    ).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [context.waiting.instanceId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(
      context.waiting.instanceId
    );

    context.setNow(12_000);
    expect(
      context.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
      ).success
    ).toBe(true);
    expect(context.session.state?.players[0].waitingRoom.cardIds).not.toContain(
      context.waiting.instanceId
    );
    expect(context.session.state?.players[0].hand.cardIds).toContain(context.waiting.instanceId);
    expect(context.session.state?.activeEffect).toBeNull();
  });
});
