import { describe, expect, it, vi } from 'vitest';
import { registerActiveEffectStepHandler } from '../../src/application/card-effects/runtime/step-registry';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  moveSelectedCardsFromZone,
} from '../../src/application/effects/zone-selection';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type AnyCardData,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import type { OnlineMatchState } from '../../src/server/services/online-match-service';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import type { ServerDeadlineTimerHandle } from '../../src/server/ai-battle/server-deadline-owner';
import { CardType, HeartColor } from '../../src/shared/types/enums';

const MATCH_ID = 'phase-one-b-deadline-match';
const USER_ID = 'phase-one-b-deadline-user';
const OPPONENT_ID = 'phase-one-b-deadline-opponent';
const ABILITY_ID = 'phase-one-b:server-deadline';
const STEP_ID = 'SELECT_WAITING_ROOM_CARD';

interface ManualTimerHandle extends ServerDeadlineTimerHandle {
  readonly id: number;
}

function createManualTimers() {
  let sequence = 0;
  const jobs = new Map<number, { readonly callback: () => void; cancelled: boolean }>();
  return {
    scheduleTimer: (callback: () => void): ManualTimerHandle => {
      const id = ++sequence;
      jobs.set(id, { callback, cancelled: false });
      return { id };
    },
    cancelTimer: (handle: ServerDeadlineTimerHandle) => {
      const job = jobs.get((handle as ManualTimerHandle).id);
      if (job) job.cancelled = true;
    },
    fire: (id: number, options: { readonly evenIfCancelled?: boolean } = {}) => {
      const job = jobs.get(id);
      if (!job) throw new Error(`missing timer ${id}`);
      if (!job.cancelled || options.evenIfCancelled) job.callback();
    },
    isCancelled: (id: number) => jobs.get(id)?.cancelled ?? false,
    count: () => sequence,
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function createDeck(prefix: string): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];
  for (let index = 0; index < 48; index += 1) {
    mainDeck.push(createMember(`${prefix}-MEMBER-${index}`));
  }
  for (let index = 0; index < 12; index += 1) {
    mainDeck.push(createLive(`${prefix}-LIVE-${index}`));
    energyDeck.push(createEnergy(`${prefix}-ENERGY-${index}`));
  }
  return { mainDeck, energyDeck };
}

async function createHarness(input: {
  readonly now: () => number;
  readonly timers: ReturnType<typeof createManualTimers>;
  readonly runtimeEpoch: string;
}) {
  const service = new OnlineMatchService({
    recorder: null,
    now: input.now,
    idGenerator: () => MATCH_ID,
    deadlineRuntimeEpoch: input.runtimeEpoch,
    deadlineIdGenerator: () => 'deadline-1',
    deadlineScheduleTimer: input.timers.scheduleTimer,
    deadlineCancelTimer: input.timers.cancelTimer,
  });
  const match = await service.createMatch({
    roomCode: 'AI1BD',
    first: {
      userId: USER_ID,
      displayName: '玩家',
      deck: createDeck('USER'),
    },
    second: {
      userId: OPPONENT_ID,
      displayName: '对手',
      deck: createDeck('OPPONENT'),
    },
  });
  const targetId = installPublicSelectionFixture(match);
  return { service, match, targetId };
}

function installPublicSelectionFixture(match: OnlineMatchState): string {
  const first = match.participants.FIRST;
  const second = match.participants.SECOND;
  const target = createCardInstance(
    createMember('DEADLINE-TARGET'),
    first.playerId,
    'deadline-target'
  );
  let game = registerCards(
    createGameState(
      match.matchId,
      first.playerId,
      first.displayName,
      second.playerId,
      second.displayName
    ),
    [target]
  );
  game = updatePlayer(game, first.playerId, (player) => ({
    ...player,
    waitingRoom: { ...player.waitingRoom, cardIds: [target.instanceId] },
  }));
  game = {
    ...game,
    activeEffect: createWaitingRoomToHandEffectState({
      id: 'deadline-effect',
      abilityId: ABILITY_ID,
      sourceCardId: target.instanceId,
      controllerId: first.playerId,
      effectText: '从休息室加入手牌。',
      stepId: STEP_ID,
      stepText: '选择要加入手牌的卡。',
      awaitingPlayerId: first.playerId,
      selectableCardIds: [target.instanceId],
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
  registerActiveEffectStepHandler(ABILITY_ID, STEP_ID, (state, effectInput) => {
    const effect = state.activeEffect;
    if (!effect) return state;
    const selected =
      effectInput.selectedCardIds ??
      (effectInput.selectedCardId ? [effectInput.selectedCardId] : []);
    const moved = moveSelectedCardsFromZone(
      state,
      effect.controllerId,
      selected,
      getZoneSelectionConfig(effect)
    );
    return moved ? { ...moved, activeEffect: null } : state;
  });
  (match.session as unknown as { authorityState: GameState }).authorityState = game;
  return target.instanceId;
}

async function selectAndReveal(
  service: OnlineMatchService,
  match: OnlineMatchState,
  targetId: string
) {
  const result = await service.executeCommand(
    match.matchId,
    USER_ID,
    createConfirmEffectStepCommand(match.participants.FIRST.playerId, 'deadline-effect', targetId)
  );
  expect(result?.success).toBe(true);
  return service.deadlineOwner.getCurrent(match.matchId);
}

describe('AI battle Phase 1B server deadline owner integration', () => {
  it('advances an authoritative public display without a browser request', async () => {
    let now = 10_000;
    const timers = createManualTimers();
    const { service, match, targetId } = await createHarness({
      now: () => now,
      timers,
      runtimeEpoch: 'epoch-a',
    });
    const registration = await selectAndReveal(service, match, targetId);
    if (!registration) throw new Error('missing deadline registration');
    const revisionBeforeDeadline = match.remoteRevision;

    now = registration.autoAdvanceAt;
    timers.fire(1);
    await vi.waitFor(() => {
      expect(match.session.state?.activeEffect).toBeNull();
    });

    expect(match.session.state?.players[0].hand.cardIds).toContain(targetId);
    expect(match.session.state?.players[0].waitingRoom.cardIds).not.toContain(targetId);
    expect(match.remoteRevision).toBe(revisionBeforeDeadline + 1);
    expect(service.deadlineOwner.getCurrent(match.matchId)).toBeNull();
  });

  it('keeps client and server expiry submissions idempotent under a race', async () => {
    let now = 10_000;
    const timers = createManualTimers();
    const { service, match, targetId } = await createHarness({
      now: () => now,
      timers,
      runtimeEpoch: 'epoch-a',
    });
    const registration = await selectAndReveal(service, match, targetId);
    if (!registration) throw new Error('missing deadline registration');
    const revisionBeforeDeadline = match.remoteRevision;
    now = registration.autoAdvanceAt;

    timers.fire(1);
    const clientResult = service.executeCommand(
      match.matchId,
      USER_ID,
      createAutoAdvancePublicCardSelectionCommand(
        match.participants.FIRST.playerId,
        registration.effectId,
        registration.autoAdvanceAt
      )
    );
    await expect(clientResult).resolves.toMatchObject({ success: true });
    await vi.waitFor(() => {
      expect(service.serialExecutor.hasPendingOperations(match.matchId)).toBe(false);
    });

    expect(match.remoteRevision).toBe(revisionBeforeDeadline + 1);
    expect(match.session.state?.players[0].hand.cardIds).toEqual([targetId]);
    expect(service.deadlineOwner.getCurrent(match.matchId)).toBeNull();
  });

  it('rescans a restored match and rejects a late timer from the disposed runtime', async () => {
    let now = 10_000;
    const firstTimers = createManualTimers();
    const {
      service: firstService,
      match,
      targetId,
    } = await createHarness({
      now: () => now,
      timers: firstTimers,
      runtimeEpoch: 'epoch-a',
    });
    const firstRegistration = await selectAndReveal(firstService, match, targetId);
    if (!firstRegistration) throw new Error('missing first registration');
    firstService.deadlineOwner.dispose();

    const secondTimers = createManualTimers();
    const secondService = new OnlineMatchService({
      recorder: null,
      now: () => now,
      deadlineRuntimeEpoch: 'epoch-b',
      deadlineIdGenerator: () => 'deadline-2',
      deadlineScheduleTimer: secondTimers.scheduleTimer,
      deadlineCancelTimer: secondTimers.cancelTimer,
    });
    await secondService.restoreMatch(match);
    const recoveredRegistration = secondService.deadlineOwner.getCurrent(match.matchId);
    if (!recoveredRegistration) throw new Error('missing recovered registration');

    expect(recoveredRegistration.runtimeEpoch).toBe('epoch-b');
    expect(recoveredRegistration.registrationId).not.toBe(firstRegistration.registrationId);
    expect(firstTimers.isCancelled(1)).toBe(true);
    now = recoveredRegistration.autoAdvanceAt;
    firstTimers.fire(1, { evenIfCancelled: true });
    await Promise.resolve();
    expect(match.session.state?.activeEffect).not.toBeNull();

    secondTimers.fire(1);
    await vi.waitFor(() => {
      expect(match.session.state?.activeEffect).toBeNull();
    });
    expect(match.session.state?.players[0].hand.cardIds).toContain(targetId);
  });
});
