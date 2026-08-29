import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { PB1_019_ACTIVATED_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getActivatedAbilityUiConfig } from '../../src/application/card-effects/runtime/activated-ability-ui';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const CARD_CODE = 'PL!-pb2-022-N';
const UNSEEN_RARITY_CARD_CODE = 'PL!-pb2-022-SEC';
const EFFECT_TEXT = '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。';

function createMemberCard(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['μ’s'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function setAuthorityState(session: ReturnType<typeof createGameSession>, state: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function setupScenario(
  options: {
    readonly phase?: GamePhase;
    readonly sourceInStage?: boolean;
    readonly includeWaitingMember?: boolean;
  } = {}
): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly waitingMemberId: string | null;
} {
  const session = createGameSession();
  session.createGame('pl-pb2-022-umi', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(createMemberCard(CARD_CODE, '园田海未'), PLAYER1, 'umi');
  const waitingMember =
    options.includeWaitingMember === true
      ? createCardInstance(
          createMemberCard('PL!-pb2-test-member-N', '测试成员'),
          PLAYER1,
          'waiting-member'
        )
      : null;
  let game = registerCards(session.state!, [source, ...(waitingMember ? [waitingMember] : [])]);

  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...(options.sourceInStage === false ? [source.instanceId] : []),
        ...(waitingMember ? [waitingMember.instanceId] : []),
      ],
    },
    memberSlots:
      options.sourceInStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));
  game = {
    ...game,
    currentPhase: options.phase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  setAuthorityState(session, game);

  return {
    session,
    sourceId: source.instanceId,
    waitingMemberId: waitingMember?.instanceId ?? null,
  };
}

describe('PL!-pb2-022 园田海未', () => {
  it('reuses the shared definition and exact activated UI text for every rarity', () => {
    for (const cardCode of [CARD_CODE, UNSEEN_RARITY_CARD_CODE]) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      const definition = definitions.find(
        (candidate) => candidate.abilityId === PB1_019_ACTIVATED_ABILITY_ID
      );

      expect(definitions).toHaveLength(1);
      expect(definition).toMatchObject({
        abilityId: PB1_019_ACTIVATED_ABILITY_ID,
        category: CardAbilityCategory.ACTIVATED,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
        effectText: EFFECT_TEXT,
      });
      expect(definition?.baseCardCodes).toContain('PL!-pb2-022');
      expect(getActivatedAbilityUiConfig(cardCode)).toMatchObject({
        abilityId: PB1_019_ACTIVATED_ABILITY_ID,
        text: EFFECT_TEXT,
      });
      expect(definition?.activatedUi?.text).toBe(definition?.effectText);
    }
  });

  it('pays the self-sacrifice cost before selecting and can recover the source itself', () => {
    const { session, sourceId } = setupScenario();
    const beforeSeq = session.getCurrentPublicEventSeq();

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, sourceId, PB1_019_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success, activateResult.error).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([sourceId]);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: PB1_019_ACTIVATED_ABILITY_ID,
      effectText: EFFECT_TEXT,
      selectableCardIds: [sourceId],
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
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, sourceId)
    );
    expect(confirmResult.success, confirmResult.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingCardEffects ?? []).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([sourceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    const summary = session
      .getPublicEventsSince(beforeSeq)
      .find((event) => event.type === 'CardEffectSummary');
    expect(summary).toMatchObject({
      type: 'CardEffectSummary',
      abilityId: PB1_019_ACTIVATED_ABILITY_ID,
      effectKind: 'SELF_SACRIFICE_RECOVER_FROM_WAITING_ROOM',
      noRecoveredCards: false,
    });
  });

  it('requires one recovery target when legal targets exist and keeps the paid cost while rejecting skip', () => {
    const { session, sourceId, waitingMemberId } = setupScenario({ includeWaitingMember: true });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, sourceId, PB1_019_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success, activateResult.error).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([sourceId, waitingMemberId!])
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([sourceId, waitingMemberId!])
    );
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toMatchObject({
      minCount: 1,
      maxCount: 1,
      optional: false,
    });
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    const activeEffectId = session.state!.activeEffect!.id;

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId, null)
    );

    expect(skipResult.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(activeEffectId);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([sourceId, waitingMemberId!])
    );

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId, waitingMemberId)
    );
    expect(confirmResult.success, confirmResult.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingCardEffects ?? []).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([waitingMemberId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
  });

  it('rejects activation outside the main phase without paying the cost', () => {
    const { session, sourceId } = setupScenario({ phase: GamePhase.LIVE_SET_PHASE });

    const result = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, sourceId, PB1_019_ACTIVATED_ABILITY_ID)
    );

    expect(result.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('rejects activation when the source is not on stage', () => {
    const { session, sourceId } = setupScenario({ sourceInStage: false });

    const result = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, sourceId, PB1_019_ACTIVATED_ABILITY_ID)
    );

    expect(result.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([sourceId]);
  });
});
