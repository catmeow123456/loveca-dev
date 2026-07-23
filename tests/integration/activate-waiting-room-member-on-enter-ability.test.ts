import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { addCardToZone } from '../../src/domain/entities/zone';
import {
  CardType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import { delegateWaitingRoomMemberOnEnterAbility, getWaitingRoomOnEnterTarget } from '../../src/application/card-effects/workflows/shared/activate-waiting-room-member-on-enter-ability';
import { countMemberEntriesThisTurn } from '../../src/domain/rules/member-turn-state';
import { createGameSession } from '../../src/application/game-session';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';

const member: MemberCardData = { cardCode: 'PL!N-bp3-012-R', name: '鐘 嵐珠', groupNames: ['虹ヶ咲学園スクールアイドル同好会'], unitName: 'R3BIRTH', cardType: CardType.MEMBER, cost: 4, blade: 1, hearts: [createHeartIcon(HeartColor.PURPLE, 1)] };

describe('activate waiting-room member ON_ENTER ability', () => {
  it('keeps the member in waiting room and delegates with no source slot or enter-stage event', () => {
    const target = createCardInstance(member, 'p1', 'target');
    let game = registerCards(createGameState('delegation', 'p1', 'P1', 'p2', 'P2'), [target]);
    game = updatePlayer(game, 'p1', (p) => ({ ...p, waitingRoom: addCardToZone(p.waitingRoom, target.instanceId) }));
    let delegated: PendingAbilityState | null = null;
    const result = delegateWaitingRoomMemberOnEnterAbility(game, { controllerId: 'p1', parentAbilityId: 'parent', parentSourceCardId: 'host', parentEffectId: 'effect', targetCardId: target.instanceId, delegatedAbilityId: 'PL!N-bp3-012:on-enter-discard-look-top-nijigasaki-card', orderedResolution: false }, (state, ability) => { delegated = ability; return state; });
    expect(getWaitingRoomOnEnterTarget(result, 'p1', target.instanceId)).not.toBeNull();
    expect(delegated?.sourceCardId).toBe(target.instanceId);
    expect(delegated?.sourceSlot).toBeUndefined();
    expect(delegated?.metadata).toMatchObject({ delegatedOnEnterFromWaitingRoom: true, originalSourceZone: ZoneType.WAITING_ROOM, delegatedBySourceCardId: 'host' });
    expect(result.eventLog).toEqual([]);
    expect(result.players[0].movedToStageThisTurn).not.toContain(target.instanceId);
    expect(countMemberEntriesThisTurn(result, 'p1')).toBe(0);
  });

  it('delegates the N-pb1 named-member workflow from waiting room through inspection, reveal, and continuation', () => {
    const session = createGameSession();
    const deckMember = (cardCode: string): MemberCardData => ({
      cardCode,
      name: cardCode,
      groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    });
    const deck: DeckConfig = {
      mainDeck: Array.from({ length: 61 }, (_, index) => deckMember(`DELEGATION-MEM-${index}`)),
      energyDeck: Array.from({ length: 12 }, (_, index) => ({
        cardCode: `DELEGATION-ENE-${index}`,
        name: `Energy ${index}`,
        cardType: CardType.ENERGY,
      })),
    };
    session.createGame('n-pb1-waiting-room-delegation', 'p1', 'P1', 'p2', 'P2');
    session.initializeGame(deck, deck);
    const rawState = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      currentTurnType: TurnType;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    rawState.currentPhase = GamePhase.MAIN_PHASE;
    rawState.currentSubPhase = SubPhase.MAIN_FREE;
    rawState.currentTurnType = TurnType.NORMAL;
    rawState.activePlayerIndex = 0;
    rawState.waitingPlayerId = null;

    const parent = createCardInstance(
      { ...deckMember('PL!N-bp3-003-R'), name: '桜坂しずく', cost: 4 },
      'p1',
      'delegation-parent'
    );
    const delegatedSource = createCardInstance(
      { ...deckMember('PL!N-pb1-016-R'), name: '朝香果林', cost: 2 },
      'p1',
      'delegated-karin-source'
    );
    const selected = createCardInstance(
      { ...deckMember('PL!N-test-karin'), name: '朝香果林' },
      'p1',
      'delegated-karin-selected'
    );
    const remainder = createCardInstance(
      { ...deckMember('PL!N-test-other'), name: '上原歩夢' },
      'p1',
      'delegated-karin-remainder'
    );
    const deckFiller = createCardInstance(
      { ...deckMember('PL!N-test-deck-filler'), name: 'Deck Filler' },
      'p1',
      'delegated-deck-filler'
    );
    let state = registerCards(session.state!, [
      parent,
      delegatedSource,
      selected,
      remainder,
      deckFiller,
    ]);
    state = updatePlayer(state, 'p1', (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [parent.instanceId] },
      mainDeck: {
        ...player.mainDeck,
        cardIds: [selected.instanceId, remainder.instanceId, deckFiller.instanceId],
      },
      waitingRoom: { ...player.waitingRoom, cardIds: [delegatedSource.instanceId] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map(),
      },
    }));
    (session as unknown as { authorityState: typeof state }).authorityState = state;

    session.setManualOperationMode('FREE');
    const play = session.executeCommand(
      createPlayMemberToSlotCommand('p1', parent.instanceId, SlotPosition.CENTER, { freePlay: true })
    );
    expect(play.success, play.error).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([delegatedSource.instanceId]);

    const delegate = session.executeCommand(
      createConfirmEffectStepCommand(
        'p1',
        session.state!.activeEffect!.id,
        delegatedSource.instanceId
      )
    );
    expect(delegate.success, delegate.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: 'PL!N-pb1-016:on-enter-look-top-two-karin-member',
      sourceCardId: delegatedSource.instanceId,
      selectableCardIds: [selected.instanceId],
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(delegatedSource.instanceId);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === delegatedSource.instanceId
      )
    ).toBe(false);

    const reveal = session.executeCommand(
      createConfirmEffectStepCommand('p1', session.state!.activeEffect!.id, selected.instanceId)
    );
    expect(reveal.success, reveal.error).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([selected.instanceId]);
    const finish = session.executeCommand(
      createConfirmEffectStepCommand('p1', session.state!.activeEffect!.id)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([selected.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      delegatedSource.instanceId,
      remainder.instanceId,
    ]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(
      session.state?.eventLog.map((entry) => entry.event).find(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.cardInstanceIds?.includes(remainder.instanceId)
      )
    ).toMatchObject({
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      cardInstanceIds: [remainder.instanceId],
    });
  });
});
