import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { HS_CL1_008_ACTIVATED_SELF_SACRIFICE_RECOVER_HASUNOSORA_CARD_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  cost: number,
  groupName = '蓮ノ空',
  name = cardCode
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, groupName = '蓮ノ空'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupIzumiScenario(options: {
  readonly includeHasunosoraMember?: boolean;
  readonly includeHasunosoraLive?: boolean;
  readonly includeNonHasunosoraMember?: boolean;
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly hasunosoraMemberId: string | null;
  readonly hasunosoraLiveId: string | null;
  readonly nonHasunosoraMemberId: string | null;
} {
  const session = createGameSession();
  session.createGame('hs-cl1-008-izumi', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(
    createMemberCard('PL!HS-cl1-008-CL', 4, '蓮ノ空', '桂城 泉'),
    PLAYER1,
    'p1-izumi'
  );
  const hasunosoraMember =
    options.includeHasunosoraMember === true
      ? createCardInstance(
          createMemberCard('PL!HS-test-member', 3),
          PLAYER1,
          'p1-hasunosora-member'
        )
      : null;
  const hasunosoraLive =
    options.includeHasunosoraLive === true
      ? createCardInstance(createLiveCard('PL!HS-test-live'), PLAYER1, 'p1-hasunosora-live')
      : null;
  const nonHasunosoraMember =
    options.includeNonHasunosoraMember === true
      ? createCardInstance(
          createMemberCard('PL!N-test-member', 3, '虹ヶ咲'),
          PLAYER1,
          'p1-non-hasunosora-member'
        )
      : null;

  let game = registerCards(session.state!, [
    source,
    ...(hasunosoraMember ? [hasunosoraMember] : []),
    ...(hasunosoraLive ? [hasunosoraLive] : []),
    ...(nonHasunosoraMember ? [nonHasunosoraMember] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...(hasunosoraMember ? [hasunosoraMember.instanceId] : []),
        ...(hasunosoraLive ? [hasunosoraLive.instanceId] : []),
        ...(nonHasunosoraMember ? [nonHasunosoraMember.instanceId] : []),
      ],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;

  const activateResult = session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      source.instanceId,
      HS_CL1_008_ACTIVATED_SELF_SACRIFICE_RECOVER_HASUNOSORA_CARD_ABILITY_ID
    )
  );
  expect(activateResult.success, activateResult.error).toBe(true);

  return {
    session,
    sourceId: source.instanceId,
    hasunosoraMemberId: hasunosoraMember?.instanceId ?? null,
    hasunosoraLiveId: hasunosoraLive?.instanceId ?? null,
    nonHasunosoraMemberId: nonHasunosoraMember?.instanceId ?? null,
  };
}

describe('PL!HS-cl1-008-CL Izumi activated workflow', () => {
  it.each([
    { label: 'member', selectedKey: 'hasunosoraMemberId' },
    { label: 'LIVE', selectedKey: 'hasunosoraLiveId' },
  ] as const)('pays self-sacrifice cost and recovers a Hasunosora $label', ({ selectedKey }) => {
    const { session, sourceId, hasunosoraMemberId, hasunosoraLiveId, nonHasunosoraMemberId } =
      setupIzumiScenario({
        includeHasunosoraMember: true,
        includeHasunosoraLive: true,
        includeNonHasunosoraMember: true,
      });
    const selectedCardId =
      selectedKey === 'hasunosoraMemberId' ? hasunosoraMemberId! : hasunosoraLiveId!;

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_CL1_008_ACTIVATED_SELF_SACRIFICE_RECOVER_HASUNOSORA_CARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 1,
      maxCount: 1,
      optional: false,
    });
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([sourceId, hasunosoraMemberId, hasunosoraLiveId])
    );
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(nonHasunosoraMemberId);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
    );

    expect(confirmResult.success, confirmResult.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
  });

  it('rejects a non-Hasunosora waiting-room card without moving it', () => {
    const { session, nonHasunosoraMemberId } = setupIzumiScenario({
      includeHasunosoraMember: true,
      includeHasunosoraLive: false,
      includeNonHasunosoraMember: true,
    });

    const rejectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        nonHasunosoraMemberId
      )
    );

    expect(rejectResult.success).toBe(false);
    expect(rejectResult.error).toBe('选择的卡牌不能用于当前效果');
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(nonHasunosoraMemberId);
  });

  it('uses the paid source as the only legal target when no other Hasunosora card exists', () => {
    const { session, sourceId } = setupIzumiScenario({
      includeHasunosoraMember: false,
      includeHasunosoraLive: false,
      includeNonHasunosoraMember: true,
    });

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([sourceId]);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
      ).success
    ).toBe(false);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, sourceId)
    );

    expect(confirmResult.success, confirmResult.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([sourceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(sourceId);
  });
});
