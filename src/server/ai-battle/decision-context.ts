import type { PlayerViewState, PublicEvent, Seat, ViewFrontCardInfo } from '../../online/types.js';
import type { AiDecisionInput, AiSelection } from './protocol.js';
import { summarizeAiSelfResources } from './visible-resources.js';

export interface AiPublicObservation {
  readonly events: readonly PublicEvent[];
  readonly throughPublicSeq: number;
  readonly droppedEventCount: number;
}

type Resources = Pick<
  AiDecisionInput['state']['selfResources'],
  | 'activeEnergyCount'
  | 'stageHeartTotal'
  | 'stageHeartCounts'
  | 'activeMemberBladeTotal'
  | 'handLiveCount'
>;

export interface AiAcceptedDecision {
  readonly turn: number;
  readonly purpose: AiDecisionInput['purpose'];
  readonly source: 'MODEL' | 'MECHANICAL' | 'FALLBACK';
  readonly actions: readonly string[];
  readonly selectedCards: readonly ViewFrontCardInfo[];
  readonly effect?: AiDecisionInput['effect'];
  /** The model's earlier intention, not an authority assertion or a reusable command. */
  readonly modelIntent?: string;
  readonly resourcesBefore: Resources;
  readonly resourcesAfter?: Resources;
}

export interface AiDecisionContextInput {
  readonly recentDecisions: readonly AiAcceptedDecision[];
  readonly lastAction?: AiAcceptedDecision;
  readonly knownDeckTop?: {
    readonly frontInfo: ViewFrontCardInfo;
    readonly learnedAtPublicSeq: number;
  };
}

const resources = (value: AiDecisionInput['state']['selfResources']): Resources => ({
  activeEnergyCount: value.activeEnergyCount,
  stageHeartTotal: value.stageHeartTotal,
  stageHeartCounts: value.stageHeartCounts,
  activeMemberBladeTotal: value.activeMemberBladeTotal,
  handLiveCount: value.handLiveCount,
});

/** A bounded player memory. Only observed fronts/public movements and accepted selections enter it. */
export class AiDecisionContext {
  publicSeq = 0;
  private turn: number | null = null;
  private recentDecisions: AiAcceptedDecision[] = [];
  private lastAction: AiAcceptedDecision | undefined;
  private knownDeckTop: AiDecisionContextInput['knownDeckTop'];
  private previous: {
    objects: Record<string, ViewFrontCardInfo>;
    zones: Record<string, readonly (ViewFrontCardInfo | null)[]>;
  } | null = null;

  constructor(private readonly seat: Seat) {}

  observe(view: PlayerViewState, observation?: AiPublicObservation): void {
    this.startTurn(view.match.turnCount);
    if (observation) {
      const gap =
        observation.droppedEventCount > 0 || observation.throughPublicSeq < this.publicSeq;
      if (gap) {
        this.knownDeckTop = undefined;
        this.previous = null;
      }
      const events = observation.events.filter((event) => gap || event.seq > this.publicSeq);
      const resetDeck = events.some(
        (event) =>
          (event.type === 'DeckRefreshed' && event.ownerSeat === this.seat) ||
          (event.type === 'PlayerDeclared' &&
            event.actorSeat === this.seat &&
            (event.declarationType === 'MULLIGAN' || event.declarationType.includes('SHUFFLE')))
      );
      for (const event of events) {
        if (event.type !== 'CardMovedPublic' && event.type !== 'CardRevealedAndMoved') continue;
        const fromDeck = event.from?.ownerSeat === this.seat && event.from.zone === 'MAIN_DECK';
        const toDeck = event.to?.ownerSeat === this.seat && event.to.zone === 'MAIN_DECK';
        // Conservatively discard position knowledge on every own deck movement, including a draw.
        if (fromDeck || toDeck) this.knownDeckTop = undefined;
        if (!toDeck || event.to?.index !== 0 || resetDeck || gap) continue;
        if (event.type === 'CardMovedPublic' && (event.count ?? 1) !== 1) continue;
        let front = event.card ? this.previous?.objects[event.card.publicObjectId] : undefined;
        // A private inspection return need not expose card identity in the public log. Its source
        // index refers to the pre-command visible inspection, never to a facedown deck instance.
        if (!front && event.from?.ownerSeat === this.seat && event.from.index !== undefined) {
          front =
            this.previous?.zones[`${this.seat}_${event.from.zone}`]?.[event.from.index] ??
            undefined;
        }
        if (front) this.knownDeckTop = { frontInfo: front, learnedAtPublicSeq: event.seq };
      }
      if (resetDeck) this.knownDeckTop = undefined;
      this.publicSeq = observation.throughPublicSeq;
    }
    this.previous = {
      objects: Object.fromEntries(
        Object.entries(view.objects).flatMap(([id, card]) =>
          card.surface === 'FRONT' && card.frontInfo ? [[id, card.frontInfo]] : []
        )
      ),
      zones: Object.fromEntries(
        Object.entries(view.table.zones).map(([id, zone]) => [
          id,
          (zone.objectIds ?? []).map((oid) => {
            const card = view.objects[oid];
            return card?.surface === 'FRONT' ? (card.frontInfo ?? null) : null;
          }),
        ])
      ),
    };
    // Keep snapshots independent from callers and subsequent mutable test fixtures.
    this.previous = globalThis.structuredClone(this.previous);
  }

  accepted(
    input: AiDecisionInput,
    selection: AiSelection,
    source: AiAcceptedDecision['source'],
    modelIntent?: string,
    after?: PlayerViewState
  ): void {
    this.startTurn(input.state.turn);
    const refs = selection.kind === 'ACTION' ? [selection.actionRef] : selection.cardRefs;
    const selected = refs.map((ref) =>
      input.space.candidates.find((candidate) => candidate.ref === ref)!
    );
    const action: AiAcceptedDecision = {
      turn: input.state.turn,
      purpose: input.purpose,
      source,
      actions: selected.map((candidate) => candidate.description.split('；')[0]),
      selectedCards: selected.flatMap((candidate) => {
        const card = candidate.objectId
          ? input.state.objects[candidate.objectId]?.frontInfo
          : undefined;
        return card ? [card] : [];
      }),
      ...(input.effect ? { effect: input.effect } : {}),
      ...(modelIntent ? { modelIntent } : {}),
      resourcesBefore: resources(input.state.selfResources),
      ...(after ? { resourcesAfter: resources(summarizeAiSelfResources(after, this.seat)) } : {}),
    };
    this.lastAction = globalThis.structuredClone(action);
    if (source !== 'MECHANICAL')
      this.recentDecisions = [...this.recentDecisions, this.lastAction].slice(-4);
  }

  input(turn: number): AiDecisionContextInput {
    this.startTurn(turn);
    return globalThis.structuredClone({
      recentDecisions: this.recentDecisions,
      ...(this.lastAction ? { lastAction: this.lastAction } : {}),
      ...(this.knownDeckTop ? { knownDeckTop: this.knownDeckTop } : {}),
    });
  }

  private startTurn(turn: number): void {
    if (this.turn !== turn) {
      this.turn = turn;
      this.recentDecisions = [];
      this.lastAction = undefined;
    }
  }
}
