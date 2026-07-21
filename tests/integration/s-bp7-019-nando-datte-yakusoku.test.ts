import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP7_019_LIVE_SUCCESS_BOTTOM_UP_TO_TWO_AQOURS_CARDS_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { CardType, HeartColor, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY_ID = S_BP7_019_LIVE_SUCCESS_BOTTOM_UP_TO_TWO_AQOURS_CARDS_ABILITY_ID;

function member(code: string, id: string, groupNames: readonly string[], ownerId = P1) {
  const data: MemberCardData = {
    cardCode: code,
    name: id,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
  return createCardInstance(data, ownerId, id);
}

function live(code: string, id: string, groupNames: readonly string[], ownerId = P1) {
  const data: LiveCardData = {
    cardCode: code,
    name: id,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({}),
  };
  return createCardInstance(data, ownerId, id);
}

function pending(sourceCardId: string, suffix = 'main'): PendingAbilityState {
  return {
    id: `s-bp7-019:${suffix}`,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [],
  };
}

function setup(
  options: { readonly candidateCount?: number; readonly continuation?: boolean } = {}
) {
  let now = 10_000;
  const source = live('PL!S-bp7-019-L', 'source', ['Aqours']);
  const aqoursMember = member('AQOURS-MEMBER', 'aqours-member', ['Aqours']);
  const aqoursLive = live('AQOURS-LIVE', 'aqours-live', ['Aqours']);
  const thirdAqours = member('AQOURS-THIRD', 'aqours-third', ['Aqours']);
  const nonAqours = member('NON-AQOURS', 'non-aqours', ['Liella!']);
  const outsideWaiting = member('AQOURS-HAND', 'aqours-hand', ['Aqours']);
  const opponentAqours = member('OPPONENT-AQOURS', 'opponent-aqours', ['Aqours'], P2);
  const allCandidates = [aqoursMember, aqoursLive, thirdAqours].slice(
    0,
    options.candidateCount ?? 2
  );
  const cards = [
    source,
    aqoursMember,
    aqoursLive,
    thirdAqours,
    nonAqours,
    outsideWaiting,
    opponentAqours,
  ];
  let game = registerCards(createGameState('s-bp7-019', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [...allCandidates.map((card) => card.instanceId), nonAqours.instanceId],
    },
    hand: addCardToStatefulZone(player.hand, outsideWaiting.instanceId),
    successZone: addCardToStatefulZone(player.successZone, source.instanceId),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    waitingRoom: addCardToStatefulZone(player.waitingRoom, opponentAqours.instanceId),
  }));
  game = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(source.instanceId)],
  }).gameState;
  if (options.continuation) {
    game = {
      ...game,
      pendingAbilities: [pending(source.instanceId, 'continuation')],
    };
  }
  const session = createGameSession({ now: () => now });
  session.createGame('s-bp7-019-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    game,
    source,
    candidates: allCandidates,
    thirdAqours,
    nonAqours,
    outsideWaiting,
    opponentAqours,
    setNow: (value: number) => {
      now = value;
    },
  };
}

function select(session: ReturnType<typeof createGameSession>, selectedCardIds: readonly string[]) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      selectedCardIds.length === 0 ? null : undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds.length === 0 ? undefined : selectedCardIds
    )
  );
}

function expire(
  session: ReturnType<typeof createGameSession>,
  setNow: (value: number) => void,
  participantId = P2
) {
  const reveal = session.state!.activeEffect!;
  const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
  setNow(deadline);
  return session.executeCommand(
    createAutoAdvancePublicCardSelectionCommand(participantId, reveal.id, deadline)
  );
}

describe('PL!S-bp7-019-L 「即使千百次也要与你约定！」', () => {
  it('registers only exact L as a queued LIVE_SUCCESS ability from LIVE_CARD', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!S-bp7-019-L')).toContainEqual(
      expect.objectContaining({
        abilityId: ABILITY_ID,
        cardCodes: ['PL!S-bp7-019-L'],
        category: CardAbilityCategory.LIVE_SUCCESS,
        sourceZone: CardAbilitySourceZone.LIVE_CARD,
        triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
        queued: true,
        implemented: true,
        effectText: expect.stringContaining('至多2张'),
      })
    );
    expect(getCardAbilityDefinitionsForCardCode('PL!S-bp7-019-R')).toEqual([]);
  });

  it('offers own waiting-room Aqours MEMBER and LIVE, excluding every other identity/owner/zone', () => {
    const scenario = setup();
    expect(scenario.game.activeEffect).toMatchObject({
      selectableCardIds: scenario.candidates.map((card) => card.instanceId),
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 2,
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      selectionLabel: '按放置顺序选择至多2张『Aqours』卡',
      confirmSelectionLabel: '按此顺序放置于卡组底',
    });
    for (const illegalId of [
      scenario.nonAqours.instanceId,
      scenario.outsideWaiting.instanceId,
      scenario.opponentAqours.instanceId,
    ]) {
      expect(
        confirmActiveEffectStep(
          scenario.game,
          P1,
          scenario.game.activeEffect!.id,
          null,
          null,
          false,
          null,
          [illegalId]
        )
      ).toBe(scenario.game);
    }
  });

  it('accepts 0 without opening a public confirmation and rejects 3, duplicate, or non-candidate input', () => {
    const declined = setup();
    expect(select(declined.session, []).success).toBe(true);
    expect(declined.session.state?.activeEffect).toBeNull();
    expect(declined.session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(declined.session.state?.resolutionZone.revealedCardIds).toEqual([]);

    const invalid = setup({ candidateCount: 3 });
    const ids = invalid.candidates.map((card) => card.instanceId);
    for (const selected of [ids, [ids[0]!, ids[0]!], [invalid.nonAqours.instanceId]]) {
      const result = select(invalid.session, selected);
      expect(result.success).toBe(false);
      expect(invalid.session.state?.activeEffect?.stepId).toBe(
        'S_BP7_019_SELECT_AQOURS_CARDS_TO_DECK_BOTTOM'
      );
    }
  });

  it.each([1, 2])(
    'reveals %i selected card(s) first, then moves in the chosen bottom order',
    (count) => {
      const scenario = setup();
      const selectedIds = scenario.candidates
        .slice(0, count)
        .map((card) => card.instanceId)
        .reverse();
      const originalPendingCount = scenario.session.state!.pendingAbilities.length;
      expect(select(scenario.session, selectedIds).success).toBe(true);
      const reveal = scenario.session.state!.activeEffect!;
      expect(reveal.revealedCardIds).toEqual(selectedIds);
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining(selectedIds)
      );
      expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([]);
      expect(scenario.session.state?.pendingAbilities).toHaveLength(originalPendingCount);
      expect(reveal.publicCardSelectionAutoAdvanceAt).toBe(10_000 + (count === 1 ? 2_000 : 2_300));

      const expectedPublicIds = selectedIds.map(createPublicObjectId);
      for (const viewerId of [P1, P2]) {
        expect(
          projectPlayerViewState(scenario.session.state!, viewerId, { now: 10_000 }).activeEffect
        ).toMatchObject({
          revealedObjectIds: expectedPublicIds,
          publicCardSelectionAutoAdvanceAfterMs: count === 1 ? 2_000 : 2_300,
        });
      }

      const tooEarly = scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          P1,
          reveal.id,
          reveal.publicCardSelectionAutoAdvanceAt! - 1
        )
      );
      expect(tooEarly.success).toBe(false);
      expect(expire(scenario.session, scenario.setNow, P2).success).toBe(true);
      expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(selectedIds);
      expect(scenario.session.state?.activeEffect).toBeNull();
      expect(
        scenario.session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(
            P1,
            reveal.id,
            reveal.publicCardSelectionAutoAdvanceAt!
          )
        ).success
      ).toBe(false);
    }
  );

  it('cancels the whole two-card move when either revealed target is stale at deadline', () => {
    const scenario = setup();
    const selectedIds = scenario.candidates.map((card) => card.instanceId);
    expect(select(scenario.session, selectedIds).success).toBe(true);
    const before = scenario.session.state!;
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      before,
      P1,
      (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((id) => id !== selectedIds[1]),
        },
        hand: addCardToStatefulZone(player.hand, selectedIds[1]!),
      })
    );
    expect(expire(scenario.session, scenario.setNow).success).toBe(true);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(selectedIds[0]);
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(selectedIds[1]);
    expect(scenario.session.state?.activeEffect).toBeNull();
  });

  it('does not gate the already-triggered waiting-room move on the source LIVE remaining in zone', () => {
    const scenario = setup();
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      P1,
      (player) => ({
        ...player,
        successZone: { ...player.successZone, cardIds: [] },
      })
    );
    const selectedId = scenario.candidates[0]!.instanceId;
    expect(select(scenario.session, [selectedId]).success).toBe(true);
    expect(expire(scenario.session, scenario.setNow).success).toBe(true);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([selectedId]);
  });

  it('keeps resolving later pending abilities at the same checkpoint', () => {
    const scenario = setup({ continuation: true });
    const first = scenario.candidates[0]!.instanceId;
    expect(select(scenario.session, [first]).success).toBe(true);
    expect(expire(scenario.session, scenario.setNow).success).toBe(true);
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      selectableCardIds: [scenario.candidates[1]!.instanceId],
    });
  });
});
