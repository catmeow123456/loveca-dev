import { describe, expect, it } from 'vitest';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createCardInstance } from '../../src/domain/entities/card';
import { registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import { getCardEntranceProfile } from '../../client/src/lib/cardEntranceProfiles';
import { getOctober29MemberData } from '../helpers/october-29-draft-effects';
import { syntheticLive, syntheticMember } from '../helpers/edelnote-effect-fixture';

function setup(owner: 'p1' | 'p2', rare = 'SEC', energyCount = 18, now = () => 1000) {
  const session = createGameSession({ cardEntrance: 'REMOTE', now });
  const source = createCardInstance(
    {
      ...getOctober29MemberData('PL!HS-bp8-007'),
      cardCode: `PL!HS-bp8-007-${rare}`,
    },
    owner,
    'seras'
  );
  const inspected = [
    syntheticLive('purple'),
    syntheticMember('member'),
    syntheticLive('purple2'),
    syntheticMember('fourth'),
    syntheticMember('fifth'),
    syntheticMember('deck-tail'), // Keep the deck nonempty so this case does not trigger refresh.
  ].map((card) => createCardInstance(card.data, owner, card.instanceId));
  const energy = Array.from({ length: energyCount }, (_, i) =>
    createCardInstance(
      {
        cardCode: 'QA-ENERGY',
        name: '能量',
        cardType: CardType.ENERGY,
      },
      owner,
      `energy-${i}`
    )
  );
  let game = registerCards(session.createGame('seras-entry', 'p1', 'P1', 'p2', 'P2'), [
    source,
    ...inspected,
    ...energy,
  ]);
  game = updatePlayer(game, owner, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['seras'] },
    mainDeck: { ...p.mainDeck, cardIds: inspected.map((c) => c.instanceId) },
    energyZone: {
      ...p.energyZone,
      cardIds: energy.map((c) => c.instanceId),
      cardStates: new Map(
        energy.map((c) => [
          c.instanceId,
          { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE },
        ])
      ),
    },
  }));
  session.restoreRuntimeState({
    authorityState: {
      ...game,
      isStarted: true,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      currentTurnType: TurnType.NORMAL,
      activePlayerIndex: owner === 'p1' ? 0 : 1,
      waitingForInput: false,
      waitingPlayerId: null,
      manualOperationMode: 'RULES',
    },
    currentPublicSeq: 0,
  });
  return session;
}
function ack(session: GameSession, playerId: string, entranceId: string) {
  return session.executeCommand({
    type: GameCommandType.ACK_CARD_ENTRANCE,
    playerId,
    entranceId,
    timestamp: 1000,
  });
}

describe('13费赛拉丝：人物登场先于私密检视，全罕度共用', () => {
  it.each(['p1', 'p2'] as const)('%s 真实付费登场，两席确认后才检视五张并只结算一次', (owner) => {
    const other = owner === 'p1' ? 'p2' : 'p1';
    let now = 1000;
    const session = setup(owner, 'SEC', 18, () => now);
    const played = session.executeCommand(
      createPlayMemberToSlotCommand(owner, 'seras', SlotPosition.CENTER)
    );
    expect(played.success, played.error).toBe(true);
    const pending = session.state!.entranceRuntime!.pending!;
    expect(pending.cardIds).toEqual(['seras']);
    const player = session.state!.players.find((p) => p.id === owner)!;
    expect(
      [...player.energyZone.cardStates.values()].filter(
        (s) => s.orientation === OrientationState.WAITING
      )
    ).toHaveLength(13);
    expect(session.state!.activeEffect).toBeNull();
    expect(player.mainDeck.cardIds).toHaveLength(6);
    for (const viewer of [owner, other]) {
      const view = session.getPlayerViewState(viewer)!;
      expect(view.match.entrance?.objectIds).toEqual(['obj_seras']);
      expect(view.match.entranceAssetIds).toContain('seras-bp8');
      expect(view.objects.obj_purple?.frontInfo).toBeUndefined();
    }
    expect(ack(session, owner, pending.id).success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(ack(session, other, pending.id).success).toBe(true);
    const effect = session.state!.activeEffect!;
    expect(effect.inspectionCardIds).toHaveLength(5);
    for (const id of effect.inspectionCardIds!) {
      expect(session.getPlayerViewState(owner)!.objects[`obj_${id}`]?.surface).toBe('FRONT');
      const hidden = session.getPlayerViewState(other)!.objects[`obj_${id}`];
      expect(hidden?.surface).toBe('BACK');
      expect(hidden?.frontInfo).toBeUndefined();
    }
    expect(ack(session, other, pending.id).success).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(owner, effect.id, 'purple')).success
    ).toBe(true);
    expect(session.state!.inspectionZone.revealedCardIds).toEqual(['purple']);
    const reveal = session.state!.activeEffect!;
    now = reveal.publicRevealAutoAdvanceAt!;
    expect(
      session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          owner,
          reveal.id,
          reveal.publicRevealAutoAdvanceAt!,
          reveal.publicRevealGeneration!
        )
      ).success
    ).toBe(true);
    const settled = session.state!.players.find((p) => p.id === owner)!;
    expect(settled.hand.cardIds).toEqual(['purple']);
    expect(settled.waitingRoom.cardIds).toEqual(['member', 'purple2', 'fourth', 'fifth']);
    session.restoreRuntimeState({
      authorityState: session.state!,
      currentPublicSeq: session.getCurrentPublicEventSeq(),
    });
    expect(session.getPlayerViewState(owner)!.match.entrance).toBeUndefined();
    expect(session.state!.activeEffect).toBeNull();
  });

  it.each(['R', 'SEC', 'PP'])(
    '%s shares the new portrait; old 15-cost Seras stays separate',
    (rare) => {
      const session = setup('p1', rare);
      expect(
        session.executeCommand(createPlayMemberToSlotCommand('p1', 'seras', SlotPosition.CENTER))
          .success
      ).toBe(true);
      expect(session.state!.entranceRuntime!.pending!.cardIds).toEqual(['seras']);
      expect(getCardEntranceProfile(`PL!HS-bp8-007-${rare}`)?.id).toBe('seras-bp8');
      expect(getCardEntranceProfile('PL!HS-bp6-007-SEC')?.id).toBe('seras');
    }
  );

  it('failed payment does not play; deadline resumes inspection once without any ACK', () => {
    const failed = setup('p1', 'SEC', 12);
    expect(
      failed.executeCommand(createPlayMemberToSlotCommand('p1', 'seras', SlotPosition.CENTER))
        .success
    ).toBe(false);
    expect(failed.state!.entranceRuntime!.pending).toBeNull();
    expect(failed.state!.activeEffect).toBeNull();
    let now = 1000;
    const session = setup('p1', 'SEC', 18, () => now);
    session.executeCommand(createPlayMemberToSlotCommand('p1', 'seras', SlotPosition.CENTER));
    const pending = session.state!.entranceRuntime!.pending!;
    now = pending.deadlineAt;
    expect(session.expireCardEntrance()).toBe(true);
    const effect = session.state!.activeEffect;
    expect(effect?.inspectionCardIds).toHaveLength(5);
    expect(session.expireCardEntrance()).toBe(false);
    expect(ack(session, 'p1', pending.id).success).toBe(false);
    expect(session.state!.activeEffect).toBe(effect);
  });
});
