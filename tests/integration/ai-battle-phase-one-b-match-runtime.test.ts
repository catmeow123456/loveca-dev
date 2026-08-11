import { describe, expect, it } from 'vitest';
import { getAiDecisionWitness } from '../../src/application/ai-decisions/decision-contract';
import { GameCommandType } from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createHeartIcon,
  createHeartRequirement,
  type AnyCardData,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { selectConservativeDecision } from '../../src/server/ai-battle/conservative-decision-policy';
import { SingleMatchSerialExecutor } from '../../src/server/ai-battle/single-match-serial-executor';
import { createAiSystemParticipantBinding } from '../../src/server/ai-battle/system-participant';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import { CardType, GamePhase, HeartColor, SubPhase } from '../../src/shared/types/enums';
import { loadAiBattlePhaseZeroRuntimeDeck } from '../helpers/ai-battle-phase-zero-decks';

const MATCH_ID = 'phase-one-b-match';
const USER_ID = 'phase-one-b-user';
const SYSTEM_BINDING = createAiSystemParticipantBinding('MUSE_STARTER');
const SYSTEM_USER_ID = SYSTEM_BINDING.userId;

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
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
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

async function createHarness(
  options: {
    readonly systemSeat?: 'FIRST' | 'SECOND';
    readonly now?: () => number;
  } = {}
) {
  const serialExecutor = new SingleMatchSerialExecutor();
  const matchService = new OnlineMatchService({
    recorder: null,
    serialExecutor,
    idGenerator: () => MATCH_ID,
    now: options.now ?? (() => 1_000),
  });
  const user = {
    userId: USER_ID,
    displayName: '玩家',
    deck: createDeck('USER'),
    participantKind: 'USER' as const,
  };
  const system = {
    userId: SYSTEM_USER_ID,
    displayName: '机器',
    deck: loadAiBattlePhaseZeroRuntimeDeck('MUSE_STARTER'),
    deckSource: 'AI_CERTIFIED_DECK' as const,
    participantKind: 'SYSTEM' as const,
    systemParticipantBinding: SYSTEM_BINDING,
  };
  const match = await matchService.createMatch({
    roomCode: 'AI1B',
    originKind: 'AI_BATTLE',
    first: options.systemSeat === 'FIRST' ? system : user,
    second: options.systemSeat === 'FIRST' ? user : system,
  });
  return { matchService, serialExecutor, match };
}

describe('AI battle Phase 1B match runtime boundary', () => {
  it('queues player commands behind the shared per-match critical section', async () => {
    const { matchService, serialExecutor, match } = await createHarness();
    let releaseBlocker!: () => void;
    let markStarted!: () => void;
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blocker = serialExecutor.runExclusive(match.matchId, async () => {
      markStarted();
      await blockerGate;
    });
    await blockerStarted;

    const commandResult = matchService.executeCommand(match.matchId, USER_ID, {
      type: GameCommandType.MULLIGAN,
      playerId: 'untrusted-player-id',
      cardIdsToMulligan: [],
      timestamp: 1_000,
    });
    await Promise.resolve();
    expect(match.session.state?.mulliganCompletedPlayers).not.toContain(
      match.participants.FIRST.playerId
    );

    releaseBlocker();
    await blocker;
    await expect(commandResult).resolves.toMatchObject({ success: true });
    expect(match.session.state?.mulliganCompletedPlayers).toContain(
      match.participants.FIRST.playerId
    );
  });

  it('advances the active player phase without reacquiring the same match executor', async () => {
    let now = 1_000;
    const { matchService, serialExecutor, match } = await createHarness({ now: () => now });
    const state = match.session.state;
    if (!state) throw new Error('missing authority state');
    state.currentPhase = GamePhase.MAIN_PHASE;
    state.currentSubPhase = SubPhase.NONE;
    state.activePlayerIndex = 0;
    state.waitingPlayerId = null;

    await matchService.getMatchSnapshot(match.matchId, USER_ID);
    now += 3_000;

    await expect(matchService.advancePhase(match.matchId, USER_ID)).resolves.toMatchObject({
      success: true,
    });
    await Promise.resolve();

    expect(serialExecutor.hasPendingOperations(match.matchId)).toBe(false);
    expect(match.remoteRevision).toBeGreaterThan(0);
  });

  it('runs lease acquisition and SYSTEM command submission through the same executor', async () => {
    const { matchService, match } = await createHarness();
    await expect(
      matchService.executeCommand(match.matchId, USER_ID, {
        type: GameCommandType.MULLIGAN,
        playerId: 'untrusted-player-id',
        cardIdsToMulligan: [],
        timestamp: 1_000,
      })
    ).resolves.toMatchObject({ success: true });
    const acquired = await matchService.acquireMachineDecisionLease({
      matchId: match.matchId,
      systemUserId: SYSTEM_USER_ID,
      ownerId: 'machine-worker',
    });
    if (!acquired.ok) throw new Error(acquired.detail);
    const witness = getAiDecisionWitness({ contract: acquired.contract });
    // A reconstructed handle intentionally has no bindings; use the stable
    // mulligan witness directly while the coordinator retains its real handle.
    expect(acquired.contract.kind).toBe('MULLIGAN');
    expect(witness).toEqual({ kind: 'MULLIGAN', candidateIds: [] });
    const conservative = selectConservativeDecision(acquired.contract);
    if (!conservative.ok) throw new Error(conservative.detail);
    const revisionBefore = match.remoteRevision;

    const submitted = await matchService.submitMachineDecisionSelection({
      matchId: match.matchId,
      leaseId: acquired.lease.leaseId,
      ownerId: 'machine-worker',
      selection: conservative.selection,
    });

    expect(submitted).toMatchObject({
      ok: true,
      authorityRevision: revisionBefore + 1,
    });
    expect(matchService.getMatch(match.matchId)?.session.state?.currentPhase).not.toBe(
      GamePhase.MULLIGAN_PHASE
    );
  });

  it('rejects an old machine lease after a serialized player write', async () => {
    const { matchService, match } = await createHarness({
      systemSeat: 'FIRST',
    });
    const acquired = await matchService.acquireMachineDecisionLease({
      matchId: match.matchId,
      systemUserId: SYSTEM_USER_ID,
      ownerId: 'machine-worker',
    });
    if (!acquired.ok) throw new Error(acquired.detail);

    await expect(
      matchService.executeCommand(match.matchId, USER_ID, {
        type: GameCommandType.SURRENDER,
        playerId: 'untrusted-player-id',
        timestamp: 1_000,
      })
    ).resolves.toMatchObject({ success: true });

    const stale = await matchService.submitMachineDecisionSelection({
      matchId: match.matchId,
      leaseId: acquired.lease.leaseId,
      ownerId: 'machine-worker',
      selection: { kind: 'MULLIGAN', candidateIds: [] },
    });

    expect(stale).toMatchObject({ ok: false, reason: 'AUTHORITY_REVISION_CHANGED' });
    expect(matchService.getMatch(match.matchId)?.session.state?.isEnded).toBe(true);
  });

  it('rejects lease acquisition for a USER participant', async () => {
    const { matchService, match } = await createHarness();

    await expect(
      matchService.acquireMachineDecisionLease({
        matchId: match.matchId,
        systemUserId: USER_ID,
        ownerId: 'forged-worker',
      })
    ).resolves.toMatchObject({
      ok: false,
      reason: 'INVALID_STATE',
    });
  });
});
