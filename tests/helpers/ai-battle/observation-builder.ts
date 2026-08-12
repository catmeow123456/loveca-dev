import {
  AI_DECISION_COMMAND_ADAPTER_VERSION,
  AI_DECISION_CONTRACT_SCHEMA_VERSION,
} from '../../../src/application/ai-decisions';
import {
  AI_OBSERVATION_SCHEMA_VERSION,
  type AiObservation,
  type AiObservedCard,
  type AiObservedDecision,
  type AiObservedSeat,
  type AiObservedZone,
} from '../../../src/server/ai-battle/ai-observation';

export interface AiObservedZoneFixtureInput {
  readonly zoneKey: string;
  readonly zoneType?: string;
  readonly count?: number;
  readonly ordered?: boolean;
  readonly visibleCards?: readonly AiObservedCard[];
}

export interface AiObservedSeatFixtureInput {
  readonly successLiveCount?: number;
  readonly successLiveScore?: number;
  readonly zones?: readonly AiObservedZone[];
}

export interface AiObservationFixtureInput {
  readonly authorityRevision?: number;
  readonly viewerSeat?: AiObservation['viewerSeat'];
  readonly turn?: Partial<AiObservation['turn']>;
  readonly window?: AiObservation['window'];
  readonly liveResult?: AiObservation['liveResult'];
  readonly endInfo?: AiObservation['endInfo'];
  readonly firstSeat?: AiObservedSeatFixtureInput;
  readonly secondSeat?: AiObservedSeatFixtureInput;
  readonly sharedZones?: readonly AiObservedZone[];
  readonly decision?: AiObservedDecision;
}

export function createAiObservedZone(input: AiObservedZoneFixtureInput): AiObservedZone {
  const visibleCards = input.visibleCards ?? [];
  return {
    zoneKey: input.zoneKey,
    zoneType: input.zoneType ?? input.zoneKey,
    count: input.count ?? visibleCards.length,
    ordered: input.ordered ?? false,
    visibleCards: [...visibleCards],
  };
}

export function createAiObservedSeat(input: AiObservedSeatFixtureInput = {}): AiObservedSeat {
  return {
    successLiveCount: input.successLiveCount ?? 0,
    successLiveScore: input.successLiveScore ?? 0,
    zones: [...(input.zones ?? [])],
  };
}

export function replaceAiObservedZone(seat: AiObservedSeat, zone: AiObservedZone): AiObservedSeat {
  const existingIndex = seat.zones.findIndex((candidate) => candidate.zoneKey === zone.zoneKey);
  const zones = [...seat.zones];
  if (existingIndex >= 0) zones.splice(existingIndex, 1, zone);
  else zones.push(zone);
  return { ...seat, zones };
}

export function createAiObservationFixture(input: AiObservationFixtureInput = {}): AiObservation {
  const viewerSeat = input.viewerSeat ?? 'FIRST';
  return {
    schemaVersion: AI_OBSERVATION_SCHEMA_VERSION,
    decisionContractSchemaVersion: AI_DECISION_CONTRACT_SCHEMA_VERSION,
    commandAdapterVersion: AI_DECISION_COMMAND_ADAPTER_VERSION,
    authorityRevision: input.authorityRevision ?? 1,
    viewerSeat,
    turn: {
      count: 1,
      phase: 'MAIN_PHASE',
      subPhase: 'FREE_ACTION',
      firstSeat: 'FIRST',
      activeSeat: viewerSeat,
      prioritySeat: viewerSeat,
      ...input.turn,
    },
    window: input.window ?? null,
    liveResult: input.liveResult ?? null,
    endInfo: input.endInfo ?? null,
    seats: {
      FIRST: createAiObservedSeat(input.firstSeat),
      SECOND: createAiObservedSeat(input.secondSeat),
    },
    sharedZones: [...(input.sharedZones ?? [])],
    decision: input.decision ?? {
      decisionRef: 'current-decision',
      kind: 'PHASE_CONFIRMATION',
      mandatory: true,
      candidates: [],
      options: [],
      actions: [],
    },
  };
}
