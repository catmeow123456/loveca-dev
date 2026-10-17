import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type CardInstance,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID as N_ID,
  SP_PR_016_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID as SP_ID,
  PL_BP8_008_LIVE_SUCCESS_DISCARD_RECOVER_MUSE_CHEER_ABILITY_ID as HANAYO_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

function member(code: string, cost = 13, group = 'μ’s'): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
    groupNames: [group],
  };
}
function setState(session: GameSession, game: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}
function choose(session: GameSession, id: string | null, advance = true) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      'p1',
      session.state!.activeEffect!.id,
      session.state!.activeEffect!.metadata?.confirmOnlyPendingAbility ? undefined : id
    )
  );
  if (result.success && advance) confirmPublicSelectionIfNeeded(session);
  return result;
}
function setup(
  options: {
    code?: string;
    abilityId?: string;
    targets?: CardInstance[];
    handCount?: number;
    sourceOnStage?: boolean;
  } = {}
) {
  const source = createCardInstance(member(options.code ?? 'PL!-bp8-008-P'), 'p1', 'source');
  const discard = createCardInstance(member('DISCARD'), 'p1', 'discard');
  const targets = options.targets ?? [createCardInstance(member('TARGET', 17), 'p1', 'target')];
  let game = registerCards(createGameState('discard-recover-cheer', 'p1', 'P1', 'p2', 'P2'), [
    source,
    discard,
    ...targets,
  ]);
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: options.handCount === 0 ? [] : [discard.instanceId] },
    memberSlots:
      options.sourceOnStage === false
        ? p.memberSlots
        : placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));
  game = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: targets.map((c) => c.instanceId),
      revealedCardIds: targets.map((c) => c.instanceId),
    },
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: targets.map((c) => c.instanceId),
    },
    pendingAbilities: [
      {
        id: 'pending',
        abilityId: options.abilityId ?? HANAYO_ID,
        sourceCardId: source.instanceId,
        controllerId: 'p1',
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: [],
        sourceSlot: SlotPosition.CENTER,
      },
    ],
  };
  const session = createGameSession();
  session.createGame('discard-recover-cheer-session', 'p1', 'P1', 'p2', 'P2');
  setState(session, resolvePendingCardEffects(game).gameState);
  return { session, source, discard, targets, initialGame: game };
}

describe('LIVE success discard to recover revealed cheer family', () => {
  it.each(['R', 'P', 'SEC', 'R＋'])(
    'Hanayo covers %s and recovers a high-cost μ’s member after public selection',
    (rare) => {
      const { session, source, discard, targets } = setup({ code: `PL!-bp8-008-${rare}` });
      expect(choose(session, discard.instanceId).success).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
      expect(choose(session, targets[0]!.instanceId, false).success).toBe(true);
      expect(session.state!.resolutionZone.cardIds).toContain(targets[0]!.instanceId);
      expect(session.state!.players[0].hand.cardIds).not.toContain(targets[0]!.instanceId);
      expect(session.state!.activeEffect?.publicCardSelectionAutoAdvanceAt).toBeTypeOf('number');
      confirmPublicSelectionIfNeeded(session);
      expect(session.state!.players[0].hand.cardIds).toContain(targets[0]!.instanceId);
      expect(session.state!.activeEffect).toBeNull();
      expect(
        session.state!.eventLog.filter(
          (e) => e.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
        )
      ).toHaveLength(1);
      expect(source.instanceId).toBe('source');
    }
  );

  it('uses μ’s identity without imposing a card-type or printed-score cap', () => {
    const targets = [
      createCardInstance(
        {
          cardCode: 'HIGH-SCORE',
          name: 'high',
          groupNames: ['μ’s'],
          cardType: CardType.LIVE,
          score: 10,
          requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
        },
        'p1',
        'high-score'
      ),
      createCardInstance(
        {
          cardCode: 'ENERGY',
          name: 'group energy',
          groupNames: ['μ’s'],
          cardType: CardType.ENERGY,
        },
        'p1',
        'group-energy'
      ),
      createCardInstance(member('OTHER', 1, 'Aqours'), 'p1', 'other'),
    ];
    const { session, discard } = setup({ targets });
    choose(session, discard.instanceId);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['high-score', 'group-energy']);
  });

  it('can decline and can pay even without any recovery target', () => {
    const declined = setup();
    choose(declined.session, null);
    expect(declined.session.state!.players[0].hand.cardIds).toContain(declined.discard.instanceId);
    const empty = setup({ targets: [] });
    expect(choose(empty.session, empty.discard.instanceId).success).toBe(true);
    expect(empty.session.state!.players[0].waitingRoom.cardIds).toContain(empty.discard.instanceId);
    expect(empty.session.state!.activeEffect).toBeNull();
  });

  it('does not create a discard choice when hand is empty', () => {
    const { session } = setup({ handCount: 0 });
    confirmPublicSelectionIfNeeded(session);
    if (session.state!.activeEffect) choose(session, null);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it.each([
    ['PL!N-PR-021-PR', N_ID],
    ['PL!SP-PR-016-PR', SP_ID],
    ['PL!HS-PR-027-PR', N_ID],
    ['PL!-bp8-008-P', HANAYO_ID],
  ])(
    'keeps already-triggered %s payable after source left before resolution',
    (code, abilityId) => {
      const target = createCardInstance(member('LOW', 2), 'p1', 'target');
      const { session, discard } = setup({
        code,
        abilityId,
        targets: [target],
        sourceOnStage: false,
      });
      expect(choose(session, discard.instanceId).success).toBe(true);
      expect(choose(session, target.instanceId).success).toBe(true);
      expect(session.state!.players[0].hand.cardIds).toEqual([target.instanceId]);
    }
  );

  it.each(
    [
      ['PL!N-PR-021-PR', N_ID],
      ['PL!SP-PR-016-PR', SP_ID],
      ['PL!HS-PR-027-PR', N_ID],
      ['PL!-bp8-008-P', HANAYO_ID],
    ].flatMap(([code, abilityId]) => [false, true].map((reenter) => ({ code, abilityId, reenter })))
  )(
    'keeps $code payable when source leaves during the fee choice; reentered=$reenter',
    ({ code, abilityId, reenter }) => {
      const target = createCardInstance(member('LOW', 2), 'p1', 'target');
      const { session, source, discard } = setup({ code, abilityId, targets: [target] });
      let game = updatePlayer(session.state!, 'p1', (p) => ({
        ...p,
        memberSlots: reenter
          ? placeCardInSlot(
              removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
              SlotPosition.CENTER,
              source.instanceId
            )
          : removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      }));
      if (reenter)
        game = emitGameEvent(
          game,
          createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, 'p1', 'p1')
        );
      setState(session, game);
      expect(choose(session, discard.instanceId).success).toBe(true);
      expect(choose(session, target.instanceId).success).toBe(true);
      expect(session.state!.players[0].hand.cardIds).toEqual([target.instanceId]);
    }
  );

  it('rechecks the group predicate after public selection and keeps the already-paid fee', () => {
    const { session, discard, targets } = setup();
    choose(session, discard.instanceId);
    choose(session, targets[0]!.instanceId, false);
    const card = session.state!.cardRegistry.get(targets[0]!.instanceId)!;
    setState(
      session,
      registerCards(session.state!, [{ ...card, data: { ...card.data, groupNames: ['Aqours'] } }])
    );
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(session.state!.resolutionZone.cardIds).toContain(targets[0]!.instanceId);
    expect(session.state!.activeEffect).toBeNull();
  });
});

const CHEER_CASES = [
  ['PL!N-PR-021-PR', N_ID],
  ['PL!SP-PR-016-PR', SP_ID],
  ['PL!HS-PR-027-PR', N_ID],
  ['PL!-bp8-008-P', HANAYO_ID],
] as const;

it.each(
  CHEER_CASES.flatMap(([code, abilityId]) =>
    ['single', 'manual', 'ordered'].map((mode) => ({ code, abilityId, mode }))
  )
)(
  'confirms no-hand $code for $mode resolution without opening a discard choice',
  ({ code, abilityId, mode }) => {
    const { session, initialGame } = setup({ code, abilityId, handCount: 0 });
    let game = initialGame;
    if (mode !== 'single') {
      const second = createCardInstance(member(code), 'p1', 'second-source');
      game = registerCards(game, [second]);
      game = updatePlayer(game, 'p1', (p) => ({
        ...p,
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, second.instanceId),
      }));
      game = {
        ...game,
        pendingAbilities: [
          ...game.pendingAbilities,
          {
            ...game.pendingAbilities[0]!,
            id: 'second-pending',
            sourceCardId: second.instanceId,
            sourceSlot: SlotPosition.LEFT,
          },
        ],
      };
    }
    setState(session, resolvePendingCardEffects(game).gameState);
    if (mode !== 'single') {
      expect(session.state!.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            'p1',
            session.state!.activeEffect!.id,
            mode === 'manual' ? 'source' : undefined,
            undefined,
            mode === 'ordered'
          )
        ).success
      ).toBe(true);
    }
    if (mode !== 'ordered') {
      expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual([]);
      expect(choose(session, null).success).toBe(true);
      if (mode === 'manual') {
        expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
        expect(choose(session, null).success).toBe(true);
      }
    }
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([]);
  }
);

it('rejects forged option or plural inputs instead of treating them as declining the fee', () => {
  for (const input of [
    { selectedOptionId: 'forged' },
    { selectedCardIds: ['discard'] },
    { selectedCardId: 'discard', selectedOptionId: 'forged' },
    { selectedEffectOptionIds: ['forged'] },
  ]) {
    const { session } = setup();
    expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    const before = session.state;
    const command = {
      ...createConfirmEffectStepCommand('p1', session.state!.activeEffect!.id),
      ...input,
    };
    expect(session.executeCommand(command).success).toBe(false);
    expect(session.state).toBe(before);
  }
});
