import type {
  AiDecisionCandidate,
  AiDecisionContract,
  AiDecisionOption,
  AiDecisionSelectionGroup,
  AiEffectDecisionInput,
} from '../../application/ai-decisions/index.js';
import type {
  PlayerViewState,
  Seat,
  ViewFrontCardInfo,
  ViewZoneKey,
  ViewZoneState,
} from '../../online/index.js';
import type { SlotPosition } from '../../shared/types/enums.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';

export const AI_OBSERVATION_SCHEMA_VERSION = AI_BATTLE_PROTOCOL_VERSIONS.decision.observation;

const STAGE_ZONE_SUFFIXES = ['MEMBER_LEFT', 'MEMBER_CENTER', 'MEMBER_RIGHT'] as const;

export interface AiObservedCard {
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: string;
  readonly cost?: number;
  readonly effectiveCost?: number;
  readonly blade?: number;
  readonly score?: number;
  readonly text?: string;
  readonly orientation?: string;
  readonly faceState?: string;
  readonly judgmentResult?: boolean;
  readonly enteredStageThisTurn?: boolean;
  readonly modifierDelta?: ViewFrontCardInfo['modifierDelta'];
  readonly requiredHearts?: ViewFrontCardInfo['requiredHearts'];
  readonly hearts?: ViewFrontCardInfo['hearts'];
  readonly bladeHearts?: ViewFrontCardInfo['bladeHearts'];
  readonly liveScoreDelta?: number;
  readonly requirementDeltas?: readonly {
    readonly color: string;
    readonly countDelta: number;
  }[];
  readonly role?: 'PRIMARY' | 'ENERGY_BELOW' | 'MEMBER_BELOW';
  readonly slot?: string;
}

export interface AiObservedZone {
  readonly zoneKey: string;
  readonly zoneType: string;
  readonly count: number;
  readonly ordered: boolean;
  readonly visibleCards: readonly AiObservedCard[];
}

export interface AiObservedSeat {
  readonly successLiveCount: number;
  readonly successLiveScore: number;
  readonly zones: readonly AiObservedZone[];
}

export interface AiObservedCandidate {
  readonly candidateId: string;
  readonly card?: AiObservedCard;
  readonly location?: AiObservedCardLocation;
  readonly hidden: boolean;
}

export interface AiObservedCardLocation {
  readonly ownerSeat: Seat | null;
  readonly zoneKey: string;
  readonly slot?: string;
  readonly role?: 'PRIMARY' | 'ENERGY_BELOW' | 'MEMBER_BELOW';
}

export interface AiObservedEffectSource {
  readonly controllerSeat: Seat | null;
  /**
   * Present only when the source is currently FRONT in this seat's projected
   * view. It never restores a hidden card identity from authority state.
   */
  readonly card?: AiObservedCard;
  /** A projection-owned snapshot that is legal only after the source was public. */
  readonly publicDisplayCardCode?: string;
  /** Present only together with a currently visible source card. */
  readonly location?: AiObservedCardLocation;
}

export interface AiObservedAction {
  readonly actionId: string;
  readonly kind: string;
  readonly candidateId?: string;
  readonly targetSlot?: SlotPosition;
  readonly relayMode?: string;
  readonly relayReplacementSlots?: readonly SlotPosition[];
  readonly label?: string;
  readonly paymentPreview?: {
    readonly modifiedCost: number;
    readonly energyCost: number;
    readonly relayDiscount: number;
    readonly replacementCount?: number;
  };
}

export interface AiObservedDecisionInput {
  readonly kind: AiEffectDecisionInput['kind'];
  readonly ordered?: boolean;
  readonly minSelections?: number;
  readonly maxSelections?: number;
  readonly canSkip?: boolean;
  readonly requiredCount?: number;
  readonly groups?: readonly AiDecisionSelectionGroup[];
  readonly slots?: readonly SlotPosition[];
  readonly integerOnly?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly members?: readonly {
    readonly candidateId: string;
    readonly originalSlot: SlotPosition;
  }[];
  readonly canResolveInOrder?: boolean;
  readonly deadlineKind?: string;
}

export interface AiObservedDecision {
  readonly decisionRef: 'current-decision';
  readonly kind: AiDecisionContract['kind'];
  readonly mandatory: boolean;
  readonly candidates: readonly AiObservedCandidate[];
  readonly options: readonly AiDecisionOption[];
  readonly actions: readonly AiObservedAction[];
  readonly effectSource?: AiObservedEffectSource;
  readonly input?: AiObservedDecisionInput;
  readonly abilityId?: string;
  readonly stepId?: string;
  readonly effectText?: string;
  readonly stepText?: string;
  readonly authorityScore?: number;
  readonly setCount?: number;
  readonly setLimit?: number;
  readonly specialMemberPlayMode?: string;
  readonly canConfirmSpecialMemberPlay?: boolean;
  readonly canCancelSpecialMemberPlay?: boolean;
}

export interface AiObservation {
  readonly schemaVersion: typeof AI_OBSERVATION_SCHEMA_VERSION;
  readonly decisionContractSchemaVersion: AiDecisionContract['schemaVersion'];
  readonly commandAdapterVersion: AiDecisionContract['commandAdapterVersion'];
  readonly authorityRevision: number;
  readonly viewerSeat: Seat;
  readonly turn: {
    readonly count: number;
    readonly phase: string;
    readonly subPhase: string;
    readonly firstSeat: Seat;
    readonly activeSeat: Seat | null;
    readonly prioritySeat: Seat | null;
  };
  readonly window: {
    readonly type: string;
    readonly status: string;
    readonly actingSeat: Seat | null;
    readonly waitingSeats: readonly Seat[];
  } | null;
  readonly liveResult: {
    readonly scores: Readonly<Record<Seat, number>>;
    readonly scoreModifiers: Readonly<Record<Seat, number>>;
    readonly winnerSeats: readonly Seat[];
    readonly confirmedSeats: readonly Seat[];
  } | null;
  readonly endInfo: {
    readonly reason: string;
    readonly winnerSeat: Seat | null;
    readonly loserSeat: Seat | null;
  } | null;
  readonly seats: Readonly<Record<Seat, AiObservedSeat>>;
  readonly sharedZones: readonly AiObservedZone[];
  readonly decision: AiObservedDecision;
}

/**
 * Phase 2 allowlist boundary.
 *
 * This adapter deliberately accepts only the already-projected player view and
 * the authority-built, contract-local decision contract. It cannot read
 * GameState, match runtime records, chat, private events, or sealed audit.
 */
export function buildAiObservation(
  view: PlayerViewState,
  contract: AiDecisionContract
): AiObservation {
  assertObservationInputs(view, contract);
  const candidateObjects = resolveCandidateObjects(view, contract);

  return {
    schemaVersion: AI_OBSERVATION_SCHEMA_VERSION,
    decisionContractSchemaVersion: contract.schemaVersion,
    commandAdapterVersion: contract.commandAdapterVersion,
    authorityRevision: contract.authorityRevision,
    viewerSeat: view.match.viewerSeat,
    turn: {
      count: view.match.turnCount,
      phase: view.match.phase,
      subPhase: view.match.subPhase,
      firstSeat: view.match.firstSeat,
      activeSeat: view.match.activeSeat,
      prioritySeat: view.match.prioritySeat,
    },
    window: view.match.window
      ? {
          type: view.match.window.windowType,
          status: view.match.window.status,
          actingSeat: view.match.window.actingSeat ?? null,
          waitingSeats: [...view.match.window.waitingSeats],
        }
      : null,
    liveResult: view.match.liveResult
      ? {
          scores: { ...view.match.liveResult.scores },
          scoreModifiers: { ...view.match.liveResult.scoreModifiers },
          winnerSeats: [...view.match.liveResult.winnerSeats],
          confirmedSeats: [...view.match.liveResult.confirmedSeats],
        }
      : null,
    endInfo: view.match.endInfo
      ? {
          reason: view.match.endInfo.reason,
          winnerSeat: view.match.endInfo.winnerSeat,
          loserSeat: view.match.endInfo.loserSeat,
        }
      : null,
    seats: {
      FIRST: observeSeat(view, 'FIRST'),
      SECOND: observeSeat(view, 'SECOND'),
    },
    sharedZones: Object.entries(view.table.zones)
      .filter(([, zone]) => zone.ownerSeat === undefined)
      .map(([zoneKey, zone]) => observeZone(view, zoneKey as ViewZoneKey, zone))
      .sort((left, right) => compareText(left.zoneKey, right.zoneKey)),
    decision: observeDecision(view, contract, candidateObjects),
  };
}

function assertObservationInputs(view: PlayerViewState, contract: AiDecisionContract): void {
  if (view.match.viewerSeat !== contract.seat) {
    throw new Error(
      `AI observation seat mismatch: view=${view.match.viewerSeat}, contract=${contract.seat}`
    );
  }
  if (view.match.seq !== contract.authorityRevision) {
    throw new Error(
      `AI observation revision mismatch: view=${String(view.match.seq)}, contract=${String(contract.authorityRevision)}`
    );
  }
  if (view.match.manualOperation.mode !== 'RULES') {
    throw new Error('AI observation only supports RULES mode');
  }
}

function observeSeat(view: PlayerViewState, seat: Seat): AiObservedSeat {
  const zones = Object.entries(view.table.zones)
    .filter(([zoneKey]) => zoneKey.startsWith(`${seat}_`))
    .map(([zoneKey, zone]) => observeZone(view, zoneKey as ViewZoneKey, zone))
    .sort((left, right) => compareText(left.zoneKey, right.zoneKey));
  const successZone = zones.find((zone) => zone.zoneKey === 'SUCCESS_ZONE');

  return {
    successLiveCount: successZone?.count ?? 0,
    successLiveScore:
      successZone?.visibleCards.reduce((sum, card) => sum + (card.score ?? 0), 0) ?? 0,
    zones,
  };
}

function observeZone(
  view: PlayerViewState,
  zoneKey: ViewZoneKey,
  zone: ViewZoneState
): AiObservedZone {
  const seatPrefix = zone.ownerSeat ? `${zone.ownerSeat}_` : '';
  const safeZoneKey = zoneKey.startsWith(seatPrefix) ? zoneKey.slice(seatPrefix.length) : zone.zone;
  const visibleCards: AiObservedCard[] = [];

  for (const objectId of zone.objectIds ?? []) {
    const card = observeFrontCard(view, objectId);
    if (card) visibleCards.push(card);
  }
  for (const [slot, objectId] of Object.entries(zone.slotMap ?? {})) {
    if (!objectId) continue;
    const card = observeFrontCard(view, objectId);
    if (card) visibleCards.push({ ...card, role: 'PRIMARY', slot });
  }
  for (const [slot, objectIds] of Object.entries(zone.overlays ?? {})) {
    for (const objectId of objectIds) {
      const card = observeFrontCard(view, objectId);
      if (card) visibleCards.push({ ...card, role: 'ENERGY_BELOW', slot });
    }
  }
  for (const [slot, objectIds] of Object.entries(zone.memberBelow ?? {})) {
    for (const objectId of objectIds) {
      const card = observeFrontCard(view, objectId);
      if (card) visibleCards.push({ ...card, role: 'MEMBER_BELOW', slot });
    }
  }

  return {
    zoneKey: safeZoneKey,
    zoneType: zone.zone,
    count: zone.count,
    ordered: zone.ordered,
    visibleCards,
  };
}

function observeFrontCard(view: PlayerViewState, objectId: string): AiObservedCard | undefined {
  const object = view.objects[objectId];
  if (object?.surface !== 'FRONT' || !object.frontInfo) return undefined;
  const front = object.frontInfo;
  const requirementDeltas = view.match.liveResult?.requirementModifiers[objectId];

  return {
    cardCode: front.cardCode,
    name: front.nameCn ?? front.nameJp ?? front.cardCode,
    cardType: front.cardType,
    cost: front.cost,
    effectiveCost: front.effectiveCost,
    blade: front.blade,
    score: front.score,
    text: front.cardTextCn ?? front.cardTextJp,
    orientation: object.orientation,
    faceState: object.faceState,
    judgmentResult: object.judgmentResult,
    enteredStageThisTurn: object.enteredStageThisTurn,
    modifierDelta: front.modifierDelta,
    requiredHearts: front.requiredHearts,
    hearts: front.hearts,
    bladeHearts: front.bladeHearts,
    liveScoreDelta: view.match.liveResult?.liveCardScoreModifiers[objectId],
    requirementDeltas: requirementDeltas?.map((modifier) => ({ ...modifier })),
  };
}

function observeDecision(
  view: PlayerViewState,
  contract: AiDecisionContract,
  candidateObjects: ReadonlyMap<string, string>
): AiObservedDecision {
  const candidates = getContractCandidates(contract).map((candidate) =>
    observeCandidate(view, candidate, candidateObjects)
  );
  const common = {
    decisionRef: 'current-decision' as const,
    kind: contract.kind,
    mandatory: contract.mandatory,
    candidates,
    options: getContractOptions(contract),
    actions: getContractActions(contract),
  };

  switch (contract.kind) {
    case 'SCORE_CONFIRMATION':
      return { ...common, authorityScore: contract.authorityScore };
    case 'LIVE_SET':
      return { ...common, setCount: contract.setCount, setLimit: contract.setLimit };
    case 'SPECIAL_MEMBER_PLAY':
      return {
        ...common,
        specialMemberPlayMode: contract.mode,
        canConfirmSpecialMemberPlay: contract.canConfirm,
        canCancelSpecialMemberPlay: contract.canCancel,
        input: {
          kind: 'CARD_SELECTION',
          minSelections: contract.minSelections,
          maxSelections: contract.maxSelections,
          canSkip: contract.canCancel,
        },
      };
    case 'ACTIVE_EFFECT':
      return {
        ...common,
        abilityId: contract.abilityId,
        stepId: contract.stepId,
        effectSource: observeActiveEffectSource(view),
        effectText: view.activeEffect?.effectText,
        stepText: view.activeEffect?.stepText,
        input: observeEffectInput(contract.input),
      };
    case 'COST_PAYMENT':
      return {
        ...common,
        input: { kind: 'CARD_SELECTION', requiredCount: contract.requiredCount },
      };
    case 'MULLIGAN':
      return {
        ...common,
        input: {
          kind: 'CARD_SELECTION',
          minSelections: contract.minSelections,
          maxSelections: contract.maxSelections,
        },
      };
    default:
      return common;
  }
}

function observeCandidate(
  view: PlayerViewState,
  candidate: AiDecisionCandidate,
  candidateObjects: ReadonlyMap<string, string>
): AiObservedCandidate {
  const objectId = candidateObjects.get(candidate.candidateId);
  const card = objectId ? observeFrontCard(view, objectId) : undefined;
  const location = objectId && card ? findVisibleObjectLocation(view, objectId) : undefined;
  return {
    candidateId: candidate.candidateId,
    card,
    ...(location ? { location } : {}),
    hidden: card === undefined,
  };
}

function observeActiveEffectSource(view: PlayerViewState): AiObservedEffectSource | undefined {
  const effect = view.activeEffect;
  if (!effect) return undefined;
  const card = observeFrontCard(view, effect.sourceObjectId);
  const location = card ? findVisibleObjectLocation(view, effect.sourceObjectId) : undefined;
  return {
    controllerSeat: effect.controllerSeat,
    ...(card ? { card } : {}),
    ...(location ? { location } : {}),
    ...(effect.sourceCardDisplayCode
      ? { publicDisplayCardCode: effect.sourceCardDisplayCode }
      : {}),
  };
}

function findVisibleObjectLocation(
  view: PlayerViewState,
  objectId: string
): AiObservedCardLocation | undefined {
  for (const [rawZoneKey, zone] of Object.entries(view.table.zones)) {
    const seatPrefix = zone.ownerSeat ? `${zone.ownerSeat}_` : '';
    const zoneKey = rawZoneKey.startsWith(seatPrefix)
      ? rawZoneKey.slice(seatPrefix.length)
      : zone.zone;
    if (zone.objectIds?.includes(objectId)) {
      return { ownerSeat: zone.ownerSeat ?? null, zoneKey };
    }
    for (const [slot, candidateObjectId] of Object.entries(zone.slotMap ?? {})) {
      if (candidateObjectId === objectId) {
        return { ownerSeat: zone.ownerSeat ?? null, zoneKey, slot, role: 'PRIMARY' };
      }
    }
    for (const [slot, objectIds] of Object.entries(zone.overlays ?? {})) {
      if (objectIds.includes(objectId)) {
        return { ownerSeat: zone.ownerSeat ?? null, zoneKey, slot, role: 'ENERGY_BELOW' };
      }
    }
    for (const [slot, objectIds] of Object.entries(zone.memberBelow ?? {})) {
      if (objectIds.includes(objectId)) {
        return { ownerSeat: zone.ownerSeat ?? null, zoneKey, slot, role: 'MEMBER_BELOW' };
      }
    }
  }
  return undefined;
}

function getContractCandidates(contract: AiDecisionContract): readonly AiDecisionCandidate[] {
  switch (contract.kind) {
    case 'MULLIGAN':
    case 'COST_PAYMENT':
    case 'SUCCESS_LIVE_SELECTION':
    case 'MAIN_PHASE':
    case 'SPECIAL_MEMBER_PLAY':
      return contract.candidates;
    case 'LIVE_SET':
      return [...contract.handCandidates, ...contract.liveZoneCandidates];
    case 'ACTIVE_EFFECT':
      switch (contract.input.kind) {
        case 'CARD_SELECTION':
        case 'ABILITY_ORDER':
          return contract.input.candidates;
        case 'STAGE_FORMATION':
          return contract.input.members.map((member, projectedIndex) => ({
            candidateId: member.candidateId,
            projectedIndex,
          }));
        default:
          return [];
      }
    default:
      return [];
  }
}

function getContractOptions(contract: AiDecisionContract): readonly AiDecisionOption[] {
  if (contract.kind !== 'ACTIVE_EFFECT') return [];
  return contract.input.kind === 'OPTION_SELECTION' || contract.input.kind === 'ABILITY_ORDER'
    ? contract.input.options.map((option) => ({ ...option }))
    : [];
}

function getContractActions(contract: AiDecisionContract): readonly AiObservedAction[] {
  if (contract.kind === 'MAIN_PHASE') {
    return contract.actions.map((action) => ({
      actionId: action.actionId,
      kind: action.kind,
      candidateId: action.sourceCandidateId,
      targetSlot: action.targetSlot,
      relayMode: action.relayMode,
      relayReplacementSlots: action.relayReplacementSlots,
      label: action.label,
      paymentPreview: action.paymentPreview ? { ...action.paymentPreview } : undefined,
    }));
  }
  if (contract.kind === 'LIVE_SET') {
    return contract.actions.map((action) => ({
      actionId: action.actionId,
      kind: action.kind,
      candidateId: action.candidateId,
    }));
  }
  return [];
}

function observeEffectInput(input: AiEffectDecisionInput): AiObservedDecisionInput {
  switch (input.kind) {
    case 'CONFIRM':
      return { kind: input.kind };
    case 'CARD_SELECTION':
      return {
        kind: input.kind,
        ordered: input.ordered,
        minSelections: input.minSelections,
        maxSelections: input.maxSelections,
        canSkip: input.canSkip,
        groups: input.groups.map((group) => ({
          ...group,
          candidateIds: [...group.candidateIds],
        })),
      };
    case 'OPTION_SELECTION':
      return {
        kind: input.kind,
        minSelections: input.minSelections,
        maxSelections: input.maxSelections,
        canSkip: input.canSkip,
      };
    case 'SLOT_SELECTION':
      return { kind: input.kind, slots: [...input.slots], canSkip: input.canSkip };
    case 'NUMBER_INPUT':
      return {
        kind: input.kind,
        min: input.min,
        max: input.max,
        integerOnly: input.integerOnly,
      };
    case 'STAGE_FORMATION':
      return {
        kind: input.kind,
        members: input.members.map((member) => ({ ...member })),
        slots: [...input.slots],
        canSkip: input.canSkip,
      };
    case 'ABILITY_ORDER':
      return { kind: input.kind, canResolveInOrder: input.canResolveInOrder };
    case 'DEADLINE_CONFIRMATION':
      return { kind: input.kind, deadlineKind: input.deadlineKind };
  }
}

function resolveCandidateObjects(
  view: PlayerViewState,
  contract: AiDecisionContract
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const ownHand = getZoneObjectIds(view, `${contract.seat}_HAND`);
  const ownLive = getZoneObjectIds(view, `${contract.seat}_LIVE_ZONE`);
  const ownStage = STAGE_ZONE_SUFFIXES.flatMap((suffix) =>
    getZoneObjectIds(view, `${contract.seat}_${suffix}`)
  );

  switch (contract.kind) {
    case 'MULLIGAN':
      bindByProjectedIndex(result, contract.candidates, ownHand);
      break;
    case 'COST_PAYMENT':
      bindByProjectedIndex(
        result,
        contract.candidates,
        view.pendingCostPayment?.payableEnergyObjectIds ?? []
      );
      break;
    case 'SUCCESS_LIVE_SELECTION':
      bindByProjectedIndex(
        result,
        contract.candidates,
        view.match.liveResult?.successLiveSelection?.candidateObjectIds ?? []
      );
      break;
    case 'MAIN_PHASE':
      for (const action of contract.actions) {
        if (!('sourceCandidateId' in action) || !action.sourceCandidateId) continue;
        const candidate = contract.candidates.find(
          (item) => item.candidateId === action.sourceCandidateId
        );
        if (!candidate) continue;
        const source = action.kind === 'ACTIVATE_ABILITY' ? ownStage : ownHand;
        const objectId = source[candidate.projectedIndex];
        if (objectId) result.set(candidate.candidateId, objectId);
      }
      break;
    case 'LIVE_SET':
      bindByProjectedIndex(result, contract.handCandidates, ownHand);
      bindByProjectedIndex(result, contract.liveZoneCandidates, ownLive);
      break;
    case 'SPECIAL_MEMBER_PLAY':
      bindByPosition(
        result,
        contract.candidates,
        view.pendingSpecialMemberPlay?.candidateObjectIds ?? []
      );
      break;
    case 'ACTIVE_EFFECT': {
      const selectableObjects = view.activeEffect?.selectableObjectIds ?? [];
      if (contract.input.kind === 'STAGE_FORMATION') {
        bindByPosition(
          result,
          contract.input.members.map((member, projectedIndex) => ({
            candidateId: member.candidateId,
            projectedIndex,
          })),
          view.activeEffect?.stageFormation?.slots.flatMap((slot) =>
            slot.objectId ? [slot.objectId] : []
          ) ?? []
        );
      } else if (
        contract.input.kind === 'CARD_SELECTION' ||
        contract.input.kind === 'ABILITY_ORDER'
      ) {
        bindByPosition(result, contract.input.candidates, selectableObjects);
      }
      break;
    }
  }

  return result;
}

function bindByProjectedIndex(
  target: Map<string, string>,
  candidates: readonly AiDecisionCandidate[],
  objectIds: readonly string[]
): void {
  for (const candidate of candidates) {
    const objectId = objectIds[candidate.projectedIndex];
    if (objectId) target.set(candidate.candidateId, objectId);
  }
}

function bindByPosition(
  target: Map<string, string>,
  candidates: readonly AiDecisionCandidate[],
  objectIds: readonly string[]
): void {
  candidates.forEach((candidate, index) => {
    const objectId = objectIds[index];
    if (objectId) target.set(candidate.candidateId, objectId);
  });
}

function getZoneObjectIds(view: PlayerViewState, zoneKey: string): readonly string[] {
  const zone = view.table.zones[zoneKey as ViewZoneKey];
  if (!zone) return [];
  if (zone.objectIds) return zone.objectIds;
  return Object.values(zone.slotMap ?? {}).filter((value): value is string => value !== null);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
