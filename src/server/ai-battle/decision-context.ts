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
> & { readonly stageMemberCount: number; readonly handCardCount: number };

export interface AiAcceptedDecision {
  readonly turn: number;
  readonly purpose: AiDecisionInput['purpose'];
  readonly source: 'MODEL' | 'MECHANICAL' | 'FALLBACK';
  readonly actions: readonly string[];
  /** Historical identities, not reusable current hand cards or stage contributions. */
  readonly selectedCards: readonly Pick<
    ViewFrontCardInfo,
    'cardCode' | 'nameJp' | 'nameCn' | 'cardType' | 'cost' | 'score'
  >[];
  readonly effect?: AiDecisionInput['effect'];
  /** Command-level observations, not the ability's promised outcome or the model's rationale. */
  readonly resultSummary?: string;
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
  stageMemberCount: value.stageMembers.length,
  handCardCount: value.handCards.length,
});

function describeObservedResult(
  before: Resources,
  after: Resources,
  events: readonly PublicEvent[]
) {
  const changes = [
    `舞台成员 ${before.stageMemberCount}→${after.stageMemberCount}`,
    `手牌 ${before.handCardCount}→${after.handCardCount}`,
    `手中 LIVE ${before.handLiveCount}→${after.handLiveCount}`,
    `活跃能量 ${before.activeEnergyCount}→${after.activeEnergyCount}`,
    `舞台 HEART ${before.stageHeartTotal}→${after.stageHeartTotal}`,
    `活跃 BLADE ${before.activeMemberBladeTotal}→${after.activeMemberBladeTotal}`,
  ];
  const completed = events
    .filter(
      (event): event is Extract<PublicEvent, { type: 'CardEffectSummary' }> =>
        event.type === 'CardEffectSummary' && event.summaryStatus === 'COMPLETED'
    )
    .slice(-4)
    .map((event) => {
      const source = event.sourceCard?.cardCode ?? '来源未公开';
      if (event.effectKind === 'SELF_SACRIFICE_RECOVER_FROM_WAITING_ROOM')
        return `${source} 回收结算完成：实际回手 ${event.recoveredCards.length + event.hiddenRecoveredCardCount} 张`;
      const selected =
        event.selectedCards !== undefined || event.hiddenSelectedCardCount !== undefined
          ? `：实际选牌 ${(event.selectedCards?.length ?? 0) + (event.hiddenSelectedCardCount ?? 0)} 张`
          : '';
      return `${source} ${event.effectKind === 'ARRANGE_INSPECTED_DECK_TOP' ? '置顶' : '检视选牌'}结算完成${selected}`;
    });
  return `本次命令后：${changes.join('；')}${completed.length ? `。已完成卡效：${completed.join('；')}` : ''}`;
}

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
    after?: PlayerViewState,
    observation?: AiPublicObservation
  ): void {
    this.startTurn(input.state.turn);
    const refs = selection.kind === 'ACTION' ? [selection.actionRef] : selection.cardRefs;
    const selected = refs.map((ref) =>
      input.space.candidates.find((candidate) => candidate.ref === ref)!
    );
    const beforeResources = resources(input.state.selfResources);
    const afterResources = after
      ? resources(summarizeAiSelfResources(after, this.seat))
      : undefined;
    // A queue observation may overlap earlier events. Do not attribute an old/opponent result
    // to this command, or claim complete effect results across a public-event gap.
    const newOwnEvents =
      observation && observation.droppedEventCount === 0
        ? observation.events.filter(
            (event) =>
              event.seq > this.publicSeq &&
              event.seq <= observation.throughPublicSeq &&
              event.actorSeat === this.seat
          )
        : [];
    const action: AiAcceptedDecision = {
      turn: input.state.turn,
      purpose: input.purpose,
      source,
      actions:
        input.purpose === 'MULLIGAN'
          ? selected.length
            ? selected.map((candidate) => `换回卡组：${candidate.description.split('；')[0]}`)
            : ['起手换牌：全部保留']
          : selected.map((candidate) => candidate.description.split('；')[0]),
      selectedCards: selected.flatMap((candidate) => {
        const card = candidate.objectId
          ? input.state.objects[candidate.objectId]?.frontInfo
          : undefined;
        if (!card) return [];
        const { cardCode, nameJp, nameCn, cardType, cost, score } = card;
        return [{ cardCode, nameJp, nameCn, cardType, cost, score }];
      }),
      ...(input.effect ? { effect: input.effect } : {}),
      resourcesBefore: beforeResources,
      ...(afterResources
        ? {
            resourcesAfter: afterResources,
            resultSummary: describeObservedResult(beforeResources, afterResources, newOwnEvents),
          }
        : {}),
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
