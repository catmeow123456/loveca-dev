import { describe, expect, it } from 'vitest';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_BP7_004_LIVE_START_BOTTOM_THREE_LIELLA_MEMBERS_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
import { clearPreviousStageMemberInstanceState } from '../../src/application/effects/member-state';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY_ID = SP_BP7_004_LIVE_START_BOTTOM_THREE_LIELLA_MEMBERS_GAIN_TWO_BLADE_ABILITY_ID;

function member(
  code: string,
  id: string,
  options: {
    readonly groupNames?: readonly string[];
    readonly hasBladeHeart?: boolean;
    readonly ownerId?: string;
  } = {}
) {
  const data: MemberCardData = {
    cardCode: code,
    name: id,
    groupNames: options.groupNames ?? ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    bladeHearts: options.hasBladeHeart ? [{ effect: BladeHeartEffect.DRAW }] : [],
  };
  return createCardInstance(data, options.ownerId ?? P1, id);
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp7-004:pending',
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  candidateCount = 3,
  options: {
    readonly allSelectedHaveBladeHeart?: boolean;
    readonly includeUnselectedWithoutBladeHeart?: boolean;
  } = {}
) {
  let now = 20_000;
  const source = member('PL!SP-bp7-004-P', 'sumire', { hasBladeHeart: true });
  const candidates = Array.from({ length: candidateCount }, (_, index) =>
    member(`LIELLA-${index}`, `liella-${index}`, {
      hasBladeHeart: options.allSelectedHaveBladeHeart === true || index !== 0,
    })
  );
  if (options.allSelectedHaveBladeHeart === false && candidates[0]) {
    candidates[0] = member('LIELLA-0', 'liella-0', { hasBladeHeart: false });
  }
  const unselectedNoBladeHeart = member('LIELLA-UNSELECTED', 'liella-unselected', {
    hasBladeHeart: false,
  });
  const nonLiella = member('NON-LIELLA', 'non-liella', { groupNames: ['Aqours'] });
  const opponent = member('OPPONENT-LIELLA', 'opponent-liella', { ownerId: P2 });
  const cards = [source, ...candidates, unselectedNoBladeHeart, nonLiella, opponent];
  let game = registerCards(createGameState('sp-bp7-004', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...candidates.map((card) => card.instanceId),
        ...(options.includeUnselectedWithoutBladeHeart ? [unselectedNoBladeHeart.instanceId] : []),
        nonLiella.instanceId,
      ],
    },
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    waitingRoom: addCardToStatefulZone(player.waitingRoom, opponent.instanceId),
  }));
  game = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(source.instanceId)],
  }).gameState;
  const session = createGameSession({ now: () => now });
  session.createGame('sp-bp7-004-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    game,
    source,
    candidates,
    unselectedNoBladeHeart,
    nonLiella,
    opponent,
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

function modifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === ABILITY_ID
  );
}

describe('PL!SP-bp7-004-P 「平安名堇」', () => {
  it('registers only exact P as a queued LIVE_START stage-member ability', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-004-P')).toContainEqual(
      expect.objectContaining({
        abilityId: ABILITY_ID,
        cardCodes: ['PL!SP-bp7-004-P'],
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      })
    );
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-004-R')).toEqual([]);
  });

  it('no-ops without a window when fewer than three legal cards exist', () => {
    const scenario = setup(2);
    expect(scenario.game.activeEffect).toBeNull();
    expect(scenario.game.pendingAbilities).toEqual([]);
    expect(scenario.game.players[0].mainDeck.cardIds).toEqual([]);
    expect(modifiers(scenario.game)).toEqual([]);
  });

  it.each([3, 4])(
    'requires exactly three from %i legal candidates and exposes optional ordered copy',
    (count) => {
      const scenario = setup(count);
      expect(scenario.game.activeEffect).toMatchObject({
        selectableCardIds: scenario.candidates.map((card) => card.instanceId),
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 3,
        maxSelectableCards: 3,
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        confirmSelectionLabel: '按此顺序放置于卡组底',
      });
      for (const invalid of [
        [scenario.candidates[0]!.instanceId],
        scenario.candidates.slice(0, 2).map((card) => card.instanceId),
        [
          scenario.candidates[0]!.instanceId,
          scenario.candidates[0]!.instanceId,
          scenario.candidates[1]!.instanceId,
        ],
        [
          scenario.candidates[0]!.instanceId,
          scenario.candidates[1]!.instanceId,
          scenario.nonLiella.instanceId,
        ],
      ]) {
        expect(select(scenario.session, invalid).success).toBe(false);
        expect(scenario.session.state?.activeEffect?.stepId).toBe(
          'SP_BP7_004_SELECT_THREE_LIELLA_MEMBERS_TO_DECK_BOTTOM'
        );
      }
    }
  );

  it('treats zero cards as decline without reveal, movement, or BLADE', () => {
    const scenario = setup(3);
    expect(select(scenario.session, []).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.resolutionZone.revealedCardIds).toEqual([]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(modifiers(scenario.session.state!)).toEqual([]);
  });

  it('reveals to both players until the dynamic deadline, then moves once in selected order', () => {
    const scenario = setup(4, { allSelectedHaveBladeHeart: false });
    const selectedIds = scenario.candidates
      .slice(0, 3)
      .map((card) => card.instanceId)
      .reverse();
    expect(select(scenario.session, selectedIds).success).toBe(true);
    const reveal = scenario.session.state!.activeEffect!;
    expect(reveal.revealedCardIds).toEqual(selectedIds);
    expect(reveal.publicCardSelectionAutoAdvanceAt).toBe(22_600);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([]);
    const publicIds = selectedIds.map(createPublicObjectId);
    for (const viewerId of [P1, P2]) {
      expect(
        projectPlayerViewState(scenario.session.state!, viewerId, { now: 20_000 }).activeEffect
      ).toMatchObject({
        revealedObjectIds: publicIds,
        publicCardSelectionAutoAdvanceAfterMs: 2_600,
      });
    }
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P1, reveal.id, 22_599)
      ).success
    ).toBe(false);
    expect(expire(scenario.session, scenario.setNow).success).toBe(true);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(selectedIds);
    expect(modifiers(scenario.session.state!)).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.source.instanceId,
        countDelta: 2,
        abilityId: ABILITY_ID,
      }),
    ]);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P1, reveal.id, 22_600)
      ).success
    ).toBe(false);
  });

  it('cancels all three cards and the reward when one revealed target becomes stale', () => {
    const scenario = setup(3, { allSelectedHaveBladeHeart: false });
    const ids = scenario.candidates.map((card) => card.instanceId);
    expect(select(scenario.session, ids).success).toBe(true);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      P1,
      (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((id) => id !== ids[1]),
        },
        hand: addCardToStatefulZone(player.hand, ids[1]!),
      })
    );
    expect(expire(scenario.session, scenario.setNow).success).toBe(true);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(ids[0]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(ids[2]);
    expect(modifiers(scenario.session.state!)).toEqual([]);
  });

  it('checks only actual moved cards: all BLADE HEART means no reward even with an unselected no-heart candidate', () => {
    const scenario = setup(3, {
      allSelectedHaveBladeHeart: true,
      includeUnselectedWithoutBladeHeart: true,
    });
    const ids = scenario.candidates.map((card) => card.instanceId);
    expect(select(scenario.session, ids).success).toBe(true);
    expect(expire(scenario.session, scenario.setNow, P1).success).toBe(true);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(ids);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(
      scenario.unselectedNoBladeHeart.instanceId
    );
    expect(modifiers(scenario.session.state!)).toEqual([]);
  });

  it('keeps the three-card move but safely skips BLADE if Sumire is no longer a top-stage member', () => {
    const scenario = setup(3, { allSelectedHaveBladeHeart: false });
    const ids = scenario.candidates.map((card) => card.instanceId);
    expect(select(scenario.session, ids).success).toBe(true);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      P1,
      (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      })
    );
    expect(expire(scenario.session, scenario.setNow).success).toBe(true);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(ids);
    expect(modifiers(scenario.session.state!)).toEqual([]);
  });

  it('binds the reward to the current Sumire instance and clears it when that instance leaves or is replaced', () => {
    const scenario = setup(3, { allSelectedHaveBladeHeart: false });
    const ids = scenario.candidates.map((card) => card.instanceId);
    expect(select(scenario.session, ids).success).toBe(true);
    expect(expire(scenario.session, scenario.setNow).success).toBe(true);
    expect(modifiers(scenario.session.state!)).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.source.instanceId,
        abilityId: ABILITY_ID,
        countDelta: 2,
      }),
    ]);
    const cleared = clearPreviousStageMemberInstanceState(
      scenario.session.state!,
      P1,
      scenario.source.instanceId
    );
    expect(modifiers(cleared)).toEqual([]);
  });
});
