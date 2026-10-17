import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type CardInstance,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { queryActivatedAbilityResources } from '../../src/application/card-effects/runtime/ability-resource-query';
import { S_CL1_003_ACTIVATED_SELF_SACRIFICE_RECOVER_AQOURS_CARD_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

function member(code: string, group = 'Aqours'): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    groupNames: [group],
    cost: 4,
    blade: 1,
    hearts: [],
  };
}
function setState(session: GameSession, game: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}
function setup(
  code = 'PL!S-cl1-003-CL',
  orientation = OrientationState.ACTIVE,
  targets: CardInstance[] = []
) {
  const session = createGameSession();
  session.createGame('s-cl1-003-session', 'p1', 'P1', 'p2', 'P2');
  const source = createCardInstance(member(code), 'p1', 'kanan');
  let state = registerCards(session.state!, [source, ...targets]);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: [] },
    waitingRoom: { ...p.waitingRoom, cardIds: targets.map((c) => c.instanceId) },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation,
    }),
  }));
  setState(session, {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
  });
  return { session, source };
}
function activate(session: GameSession, sourceId = 'kanan') {
  return session.executeCommand(createActivateAbilityCommand('p1', sourceId, ABILITY));
}
function choose(session: GameSession, target: string | null, advance = true) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand('p1', session.state!.activeEffect!.id, target)
  );
  if (result.success && advance) confirmPublicSelectionIfNeeded(session);
  return result;
}

describe('PL!S-cl1-003 费用4「松浦果南」 self sacrifice recovery', () => {
  it.each(['CL', 'R', 'SEC'])(
    'covers %s, pays the source first and can recover that same source',
    (rare) => {
      const { session, source } = setup(`PL!S-cl1-003-${rare}`);
      expect(
        queryActivatedAbilityResources(session.state!, 'p1', source.instanceId, ABILITY)
          ?.targetCardIds
      ).toContain(source.instanceId);
      expect(activate(session).success).toBe(true);
      expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(source.instanceId);
      expect(session.state!.activeEffect?.canSkipSelection).toBe(false);
      expect(choose(session, source.instanceId, false).success).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(source.instanceId);
      confirmPublicSelectionIfNeeded(session);
      expect(session.state!.players[0].hand.cardIds).toEqual([source.instanceId]);
      expect(
        session.state!.eventLog.filter((e) => e.event.eventType === TriggerCondition.ON_LEAVE_STAGE)
      ).toHaveLength(1);
    }
  );

  it('accepts a waiting source and filters any Aqours card without type restrictions', () => {
    const targets = [
      createCardInstance(member('MEMBER'), 'p1', 'member'),
      createCardInstance(
        {
          cardCode: 'LIVE',
          name: 'live',
          cardType: CardType.LIVE,
          groupNames: ['Aqours'],
          score: 10,
          requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
        },
        'p1',
        'live'
      ),
      createCardInstance(member('OTHER', 'Liella!'), 'p1', 'other'),
      createCardInstance(member('OPPONENT'), 'p2', 'opponent'),
    ];
    const { session } = setup('PL!S-cl1-003-CL', OrientationState.WAITING, targets);
    expect(activate(session).success).toBe(true);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['member', 'live', 'kanan']);
    expect(choose(session, 'live').success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['live']);
  });

  it('does not impose turn-one or once-per-turn restrictions after a new entry', () => {
    const { session, source } = setup();
    activate(session);
    choose(session, source.instanceId);
    let state = updatePlayer(session.state!, 'p1', (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: [] },
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId),
    }));
    setState(session, state);
    expect(activate(session).success).toBe(true);
    expect(choose(session, source.instanceId).success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual([source.instanceId]);
  });

  it('rejects skipping the mandatory recovery and rechecks group after public display', () => {
    const { session, source } = setup();
    activate(session);
    expect(choose(session, null).success).toBe(false);
    choose(session, source.instanceId, false);
    setState(
      session,
      registerCards(session.state!, [
        { ...source, data: { ...source.data, groupNames: ['Liella!'] } },
      ])
    );
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([source.instanceId]);
    expect(session.state!.activeEffect).toBeNull();
  });
});
