import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  getPlayerById,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { S_BP3_021_LIVE_START_WAITING_MEMBER_TO_DECK_TOP_GRANT_STAGE_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
const live = (): LiveCardData => ({
  cardCode: 'PL!S-bp3-021-L',
  name: '想いよひとつになれ',
  cardType: CardType.LIVE,
  score: 4,
  requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
});
const member = (code: string, cost = 4): MemberCardData => ({
  cardCode: code,
  name: code,
  cardType: CardType.MEMBER,
  cost,
  blade: 1,
  hearts: [],
});
const pending = (sourceCardId: string): PendingAbilityState => ({
  id: 'pending-021',
  abilityId: S_BP3_021_LIVE_START_WAITING_MEMBER_TO_DECK_TOP_GRANT_STAGE_BLADE_ABILITY_ID,
  sourceCardId,
  controllerId: P1,
  mandatory: true,
  timingId: TriggerCondition.ON_LIVE_START,
  eventIds: ['live-start'],
});

function setup(
  options: { waitingMember?: boolean; stageMember?: boolean; sourceLive?: boolean } = {}
): { game: GameState; sourceId: string; waitingId: string; stageId: string } {
  const source = createCardInstance(live(), P1, 'source-021');
  const waiting = createCardInstance(member('waiting-member'), P1, 'waiting-member');
  const waitingLive = createCardInstance(
    { ...live(), cardCode: 'waiting-live' },
    P1,
    'waiting-live'
  );
  const opponentMember = createCardInstance(member('opponent-member'), P2, 'opponent-member');
  const stage = createCardInstance(member('stage-member'), P1, 'stage-member');
  let game = registerCards(createGameState('021', P1, 'P1', P2, 'P2'), [
    source,
    waiting,
    waitingLive,
    opponentMember,
    stage,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone:
      options.sourceLive === false
        ? player.liveZone
        : addCardToStatefulZone(player.liveZone, source.instanceId),
    waitingRoom: [
      ...(options.waitingMember === false ? [] : [waiting.instanceId]),
      waitingLive.instanceId,
    ].reduce((zone, id) => addCardToStatefulZone(zone, id), player.waitingRoom),
    memberSlots:
      options.stageMember === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.LEFT, stage.instanceId, {
            orientation: OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    waitingRoom: addCardToStatefulZone(player.waitingRoom, opponentMember.instanceId),
  }));
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    sourceId: source.instanceId,
    waitingId: waiting.instanceId,
    stageId: stage.instanceId,
  };
}

function createSession(game: GameState) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('021-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    setNow(value: number) {
      now = value;
    },
    authority(state: GameState) {
      (session as unknown as { authorityState: GameState }).authorityState = state;
    },
  };
}

describe('PL!S-bp3-021-L 想いよひとつになれ', () => {
  it('offers only own waiting-room members and skipping neither reveals, moves, nor grants BLADE', () => {
    const { game, waitingId } = setup();
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: [waitingId],
      canSkipSelection: true,
      selectionLabel: '选择放置于卡组顶的成员卡',
      confirmSelectionLabel: '放置于卡组顶',
      skipSelectionLabel: '不放置',
    });
    const skipped = confirmActiveEffectStep(started, P1, started.activeEffect!.id, null);
    expect(skipped.activeEffect).toBeNull();
    expect(getPlayerById(skipped, P1)!.waitingRoom.cardIds).toContain(waitingId);
    expect(skipped.liveResolution.liveModifiers).toEqual([]);
  });

  it('first reveals without moving, then moves exactly one and grants BLADE only after choosing an own main-stage member', () => {
    const { game, waitingId, stageId } = setup();
    const started = resolvePendingCardEffects(game).gameState;
    const revealed = confirmActiveEffectStep(started, P1, started.activeEffect!.id, waitingId);
    expect(revealed.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [waitingId],
    });
    expect(getPlayerById(revealed, P1)!.waitingRoom.cardIds).toContain(waitingId);
    expect(revealed.liveResolution.liveModifiers).toEqual([]);
    expect(revealed.pendingAbilities).toEqual([]);
    const moved = confirmActiveEffectStepThroughPublicReveal(
      started,
      P1,
      started.activeEffect!.id,
      waitingId
    );
    expect(getPlayerById(moved, P1)!.mainDeck.cardIds[0]).toBe(waitingId);
    expect(moved.activeEffect).toMatchObject({
      selectableCardIds: [stageId],
      stepText: '请选择自己舞台上1名成员，使其获得[BLADE]。',
      confirmSelectionLabel: '获得[BLADE]',
    });
    const resolved = confirmActiveEffectStep(moved, P1, moved.activeEffect!.id, stageId);
    expect(resolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        playerId: P1,
        sourceCardId: stageId,
        abilityId: S_BP3_021_LIVE_START_WAITING_MEMBER_TO_DECK_TOP_GRANT_STAGE_BLADE_ABILITY_ID,
        countDelta: 1,
      })
    );
  });

  it('does not create an empty selection and preserves a successful deck-top move when no stage target exists', () => {
    const none = setup({ waitingMember: false });
    const noTarget = resolvePendingCardEffects(none.game).gameState;
    expect(noTarget.activeEffect).toBeNull();
    const { game, waitingId } = setup({ stageMember: false });
    const started = resolvePendingCardEffects(game).gameState;
    const resolved = confirmActiveEffectStepThroughPublicReveal(
      started,
      P1,
      started.activeEffect!.id,
      waitingId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(getPlayerById(resolved, P1)!.mainDeck.cardIds[0]).toBe(waitingId);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('waits for the authoritative deadline, then places exactly the selected instance on deck top and ignores duplicate resume', () => {
    const { game, waitingId } = setup();
    const started = resolvePendingCardEffects(game).gameState;
    const { session, setNow } = createSession(started);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, started.activeEffect!.id, waitingId)
      ).success
    ).toBe(true);
    const reveal = session.state!.activeEffect!;
    const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
    expect(deadline).toBe(12_000);
    expect(getPlayerById(session.state!, P1)!.waitingRoom.cardIds).toContain(waitingId);
    expect(getPlayerById(session.state!, P1)!.mainDeck.cardIds).not.toContain(waitingId);
    setNow(deadline - 1);
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, deadline - 1)
      ).success
    ).toBe(false);
    expect(getPlayerById(session.state!, P1)!.waitingRoom.cardIds).toContain(waitingId);
    setNow(deadline);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, deadline))
        .success
    ).toBe(true);
    expect(getPlayerById(session.state!, P1)!.mainDeck.cardIds[0]).toBe(waitingId);
    const afterFirstResume = session.state!;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P1, reveal.id, deadline))
        .success
    ).toBe(false);
    expect(session.state).toEqual(afterFirstResume);
    expect(
      getPlayerById(session.state!, P1)!.mainDeck.cardIds.filter((id) => id === waitingId)
    ).toHaveLength(1);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
  });

  it('safely ends when the source LIVE leaves or the exact selected card disappears during public display', () => {
    for (const staleKind of ['source', 'selected'] as const) {
      const { game, sourceId, waitingId } = setup();
      const duplicate = createCardInstance(member('waiting-member'), P1, `duplicate-${staleKind}`);
      let started = registerCards(resolvePendingCardEffects(game).gameState, [duplicate]);
      started = updatePlayer(started, P1, (player) => ({
        ...player,
        waitingRoom: addCardToStatefulZone(player.waitingRoom, duplicate.instanceId),
      }));
      const { session, authority } = createSession(started);
      session.executeCommand(
        createConfirmEffectStepCommand(P1, started.activeEffect!.id, waitingId)
      );
      const reveal = session.state!.activeEffect!;
      authority(
        updatePlayer(
          { ...session.state!, activeEffect: { ...reveal, publicCardSelectionAutoAdvanceAt: 0 } },
          P1,
          (player) => ({
            ...player,
            liveZone:
              staleKind === 'source'
                ? removeCardFromStatefulZone(player.liveZone, sourceId)
                : player.liveZone,
            waitingRoom:
              staleKind === 'selected'
                ? removeCardFromStatefulZone(player.waitingRoom, waitingId)
                : player.waitingRoom,
          })
        )
      );
      expect(
        session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, 0))
          .success
      ).toBe(true);
      expect(session.state?.activeEffect).toBeNull();
      expect(getPlayerById(session.state!, P1)!.mainDeck.cardIds).not.toContain(waitingId);
      expect(getPlayerById(session.state!, P1)!.mainDeck.cardIds).not.toContain(
        duplicate.instanceId
      );
      expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    }
  });

  it('second step excludes opponent and memberBelow, and a stale selected target keeps the completed deck-top move without BLADE', () => {
    const { game, waitingId, stageId } = setup();
    const opponentTop = createCardInstance(member('opponent-top'), P2, 'opponent-top');
    const ownBelow = createCardInstance(member('own-below'), P1, 'own-below');
    let expanded = registerCards(game, [opponentTop, ownBelow]);
    expanded = updatePlayer(expanded, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.LEFT]: [ownBelow.instanceId],
        },
      },
    }));
    expanded = updatePlayer(expanded, P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        opponentTop.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    const started = resolvePendingCardEffects(expanded).gameState;
    const moved = confirmActiveEffectStepThroughPublicReveal(
      started,
      P1,
      started.activeEffect!.id,
      waitingId
    );
    expect(moved.activeEffect?.selectableCardIds).toEqual([stageId]);
    expect(moved.activeEffect?.selectableCardIds).not.toContain(opponentTop.instanceId);
    expect(moved.activeEffect?.selectableCardIds).not.toContain(ownBelow.instanceId);
    const stale = updatePlayer(moved, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    const resolved = confirmActiveEffectStep(stale, P1, stale.activeEffect!.id, stageId);
    expect(resolved.activeEffect).toBeNull();
    expect(getPlayerById(resolved, P1)!.mainDeck.cardIds[0]).toBe(waitingId);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });
});
