import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { GameCommand } from '../../application/game-commands.js';
import type { DeckConfig } from '../../application/game-service.js';
import { loadDeckFromYaml } from '../../domain/card-data/deck-loader-node.js';
import type {
  OnlineCommandResult,
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  PublicEventsResponse,
} from '../../online/index.js';
import { getPublishedCardRegistry } from './card-registry-service.js';
import {
  loadOwnedDeckForOnlineMatch,
  loadUserProfileForOnlineMatch,
  type OwnedDeckSummary,
  type UserProfileSummary,
} from './online-room-service.js';
import {
  onlineMatchService,
  type OnlineMatchService,
  type RemoteUndoInput,
} from './online-match-service.js';

const DEFAULT_SOLITAIRE_OPPONENT_DECK_PATH =
  process.env.SOLITAIRE_DEFAULT_OPPONENT_DECK_PATH ?? 'assets/decks/缪预组.yaml';
const SOLITAIRE_SYSTEM_USER_ID = 'system:solitaire-opponent';
const SOLITAIRE_SYSTEM_DISPLAY_NAME = '对手 (AI)';

interface SolitaireMatchServiceDeps {
  readonly now?: () => number;
  readonly matchService?: OnlineMatchService;
  readonly idGenerator?: () => string;
  readonly opponentDeckPath?: string;
  readonly loadUserProfile?: (userId: string) => Promise<UserProfileSummary>;
  readonly loadOwnedDeck?: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;
  readonly loadOpponentDeck?: (deckPath: string) => Promise<DeckConfig>;
}

export interface CreateSolitaireMatchInput {
  readonly userId: string;
  readonly deckId: string;
}

export interface CreateSolitaireMatchResult {
  readonly matchId: string;
  readonly snapshot: OnlineMatchSnapshot;
}

export class SolitaireMatchServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'SolitaireMatchServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class SolitaireMatchService {
  private readonly now: () => number;
  private readonly matchService: OnlineMatchService;
  private readonly idGenerator: () => string;
  private readonly opponentDeckPath: string;
  private readonly loadUserProfile: (userId: string) => Promise<UserProfileSummary>;
  private readonly loadOwnedDeck: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;
  private readonly loadOpponentDeck: (deckPath: string) => Promise<DeckConfig>;

  constructor(deps: SolitaireMatchServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.matchService = deps.matchService ?? onlineMatchService;
    this.idGenerator = deps.idGenerator ?? randomUUID;
    this.opponentDeckPath = deps.opponentDeckPath ?? DEFAULT_SOLITAIRE_OPPONENT_DECK_PATH;
    this.loadUserProfile = deps.loadUserProfile ?? loadUserProfileForOnlineMatch;
    this.loadOwnedDeck = deps.loadOwnedDeck ?? loadOwnedDeckForOnlineMatch;
    this.loadOpponentDeck = deps.loadOpponentDeck ?? loadDefaultOpponentDeck;
  }

  async createMatch(input: CreateSolitaireMatchInput): Promise<CreateSolitaireMatchResult> {
    const [profile, userDeck, opponentDeck] = await Promise.all([
      this.loadUserProfile(input.userId),
      this.loadOwnedDeck(input.userId, input.deckId.trim()),
      this.loadOpponentDeck(this.opponentDeckPath),
    ]);
    const roomCode = `SOL-${this.idGenerator()}`;

    const match = await this.matchService.createMatch({
      roomCode,
      matchMode: 'SOLITAIRE',
      automationGameMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
      originLabel: '对墙打',
      startedAt: this.now(),
      first: {
        userId: profile.userId,
        displayName: profile.displayName,
        deck: cloneDeck(userDeck.runtimeDeck),
        deckId: userDeck.deckId,
        deckName: userDeck.deckName,
        deckSource: 'PUBLISHED_CARDS_SNAPSHOT',
        lockedAt: this.now(),
        participantKind: 'USER',
        ownerUserId: null,
      },
      second: {
        userId: SOLITAIRE_SYSTEM_USER_ID,
        displayName: SOLITAIRE_SYSTEM_DISPLAY_NAME,
        deck: cloneDeck(opponentDeck),
        deckId: null,
        deckName: path.basename(this.opponentDeckPath),
        deckSource: 'SOLITAIRE_DEFAULT_DECK',
        lockedAt: this.now(),
        participantKind: 'SYSTEM',
        ownerUserId: profile.userId,
      },
    });

    const snapshot = await this.matchService.getMatchSnapshot(match.matchId, input.userId);
    if (!snapshot || 'modified' in snapshot) {
      throw new SolitaireMatchServiceError(
        'SOLITAIRE_MATCH_SNAPSHOT_FAILED',
        '对墙打对局已创建，但初始快照读取失败',
        500
      );
    }

    return {
      matchId: match.matchId,
      snapshot,
    };
  }

  async getMatchSnapshot(
    matchId: string,
    userId: string,
    options: { readonly sinceSeq?: number } = {}
  ): Promise<OnlineMatchSnapshotResponse | null> {
    const match = this.getPlayableSolitaireMatch(matchId, userId);
    if (!match) {
      return null;
    }
    return this.matchService.getMatchSnapshot(matchId, userId, options);
  }

  async getMatchPublicEvents(
    matchId: string,
    userId: string,
    options: { readonly afterSeq?: number } = {}
  ): Promise<PublicEventsResponse | null> {
    const match = this.getPlayableSolitaireMatch(matchId, userId);
    if (!match) {
      return null;
    }
    return this.matchService.getMatchPublicEvents(matchId, userId, options);
  }

  async executeCommand(
    matchId: string,
    userId: string,
    command: GameCommand
  ): Promise<OnlineCommandResult | null> {
    const match = this.getPlayableSolitaireMatch(matchId, userId);
    if (!match) {
      return null;
    }
    return this.matchService.executeCommand(matchId, userId, command);
  }

  async advancePhase(matchId: string, userId: string): Promise<OnlineCommandResult | null> {
    const match = this.getPlayableSolitaireMatch(matchId, userId);
    if (!match) {
      return null;
    }
    return this.matchService.advancePhase(matchId, userId);
  }

  async undoLatest(
    matchId: string,
    userId: string,
    input: RemoteUndoInput
  ): Promise<OnlineCommandResult | null> {
    const match = this.getPlayableSolitaireMatch(matchId, userId);
    if (!match) {
      return null;
    }
    return this.matchService.undoLatest(matchId, userId, input);
  }

  async leaveMatch(matchId: string, userId: string): Promise<boolean | null> {
    const match = this.getPlayableSolitaireMatch(matchId, userId);
    if (!match) {
      return null;
    }
    return this.matchService.deleteMatch(matchId, { reason: 'SOLITAIRE_PLAYER_LEFT' });
  }

  private getPlayableSolitaireMatch(matchId: string, userId: string) {
    const match = this.matchService.getMatch(matchId);
    if (!match || match.matchMode !== 'SOLITAIRE') {
      return null;
    }

    const participant = match.participants.FIRST;
    if (participant.userId !== userId || participant.participantKind !== 'USER') {
      return null;
    }

    return match;
  }
}

export const solitaireMatchService = new SolitaireMatchService();

async function loadDefaultOpponentDeck(deckPath: string): Promise<DeckConfig> {
  const registry = await getPublishedCardRegistry();
  const resolvedPath = path.isAbsolute(deckPath) ? deckPath : path.resolve(process.cwd(), deckPath);
  const result = loadDeckFromYaml(resolvedPath, registry);
  if (!result.success || !result.deck) {
    throw new SolitaireMatchServiceError(
      'SOLITAIRE_DEFAULT_DECK_INVALID',
      result.errors[0] ?? '默认对手卡组加载失败',
      500
    );
  }
  return {
    mainDeck: [...result.deck.mainDeck],
    energyDeck: [...result.deck.energyDeck],
  };
}

function cloneDeck(deck: DeckConfig): DeckConfig {
  return {
    mainDeck: [...deck.mainDeck],
    energyDeck: [...deck.energyDeck],
  };
}
