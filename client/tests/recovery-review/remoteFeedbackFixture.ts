import { useGameStore } from '@/store/gameStore';
import { useAuthStore } from '@/store/authStore';
import {
  prepareEffectFeedbackScenario,
  type FeedbackScenarioId,
} from '../../../tests/helpers/effect-feedback-fixture';
import type { RemoteSnapshot, RemoteSessionSource } from '@/lib/remoteMatchClient';
import type { PublicEventsResponse, Seat } from '@game/online';
import type { AnyCardData } from '@game/domain/entities/card';

// Isolated browser transport fixture. The authority is a real GameSession; no account,
// API, database or model is contacted. The ordinary App and remote snapshot/log readers run.
let fixture: ReturnType<typeof prepareEffectFeedbackScenario>;
let revision = 1;
let source: RemoteSessionSource;
let seat: Seat;
let holdLogs = false;
let pending: (() => void)[] = [];
let eventRequests: RemoteSessionSource[] = [];
const player = () => (seat === 'FIRST' ? 'p1' : 'p2');
const snapshot = (inline = true): RemoteSnapshot => ({
  matchId: fixture.session.state!.gameId,
  seat,
  playerId: player(),
  seq: revision,
  currentPublicSeq: fixture.session.getCurrentPublicEventSeq(),
  playerViewState: fixture.session.getPlayerViewState(player(), { seqOverride: revision })!,
  ...(inline ? { publicEvents: fixture.session.getPublicEventsSince(0) } : {}),
});

export async function prepareRemoteFeedback(input: {
  source: 'ONLINE' | 'SOLITAIRE' | 'AI_DEBUG';
  scenario: FeedbackScenarioId;
  seat?: Seat;
  revision?: number;
}) {
  fixture = prepareEffectFeedbackScenario(input.scenario);
  revision = input.revision ?? 1;
  source = input.source;
  seat = input.seat ?? 'FIRST';
  holdLogs = false;
  pending = [];
  eventRequests = [];
  const store = useGameStore.getState();
  store.disconnectRemoteSession();
  store.loadCardData(fixture.cards.map((card) => card.data as AnyCardData));
  useGameStore.setState({
    remoteSession: { source, matchId: snapshot().matchId, seat, playerId: player() },
    replaySession: null,
  });
  await store.applyRemoteSnapshot(snapshot());
  useAuthStore.getState().enterOfflineMode('远程数值反馈本地验收');
}

export const transport = {
  fetchRemoteSnapshotSyncResult: async () => ({
    matchId: snapshot().matchId,
    seq: revision,
    currentPublicSeq: fixture.session.getCurrentPublicEventSeq(),
    snapshot: null,
  }),
  fetchRemoteSnapshot: async () => snapshot(),
  fetchRemotePublicEvents: async (
    requestedSource: RemoteSessionSource,
    _id: string,
    _seat: Seat,
    afterSeq = 0
  ): Promise<PublicEventsResponse> => {
    eventRequests.push(requestedSource);
    if (holdLogs) await new Promise<void>((resolve) => pending.push(resolve));
    return {
      matchId: snapshot().matchId,
      currentPublicSeq: fixture.session.getCurrentPublicEventSeq(),
      publicEvents: fixture.session.getPublicEventsSince(afterSeq),
    };
  },
};

export function setHoldLogs(value: boolean) {
  holdLogs = value;
}
export async function releaseLogs() {
  holdLogs = false;
  for (const resolve of pending.splice(0)) resolve();
  await Promise.resolve();
}
export async function stepRemoteFeedback() {
  const command = fixture.nextCommand();
  if (!command) throw new Error('No pending real ability command');
  const result = fixture.session.executeCommand(command);
  if (!result.success) throw new Error(result.error);
  revision++;
  await useGameStore.getState().applyRemoteSnapshot(snapshot(false));
  return result;
}
export async function pollLogAgain() {
  await useGameStore.getState().syncPublicBattleLog();
}
export async function reconnect() {
  const store = useGameStore.getState();
  store.disconnectRemoteSession();
  useGameStore.setState({
    remoteSession: { source, matchId: snapshot().matchId, seat, playerId: player() },
  });
  await store.applyRemoteSnapshot(snapshot(false));
}
export function readRemoteFeedback() {
  const state = useGameStore.getState();
  const effect = fixture.session.state!.activeEffect;
  return {
    source: state.remoteSession?.source,
    revision: state.playerViewState!.match.seq,
    publicSeq: state.publicBattleLog.currentPublicSeq,
    events: state.publicBattleLog.events.filter((event) => event.type === 'EffectFeedback'),
    authorityEvents: fixture.session
      .getPublicEventsSince(0)
      .filter((event) => event.type === 'EffectFeedback'),
    eventRequests,
    deadline: effect?.publicCardSelectionAutoAdvanceAt ?? effect?.publicEffectChoiceAutoAdvanceAt,
  };
}
