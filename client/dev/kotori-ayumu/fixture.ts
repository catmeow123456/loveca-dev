import { useGameStore } from '@/store/gameStore';
import { createGameSession } from '@game/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
} from '@game/domain/entities/card';
import { registerCards, updatePlayer, emitGameEvent } from '@game/domain/entities/game';
import { createLiveSuccessEvent } from '@game/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '@game/application/card-effect-runner';
import {
  CardType,
  FaceState,
  GamePhase,
  GameMode,
  OrientationState,
  SubPhase,
  TurnType,
  TriggerCondition,
} from '@game/shared/types/enums';
import type { CareEffectCue, CareEffectKind } from '@/lib/kotoriAyumuEffects';
import rows from './cards.json';
export type Scene = 'kotori' | 'kotori-relay' | 'ayumu' | 'ayumu-live';
export const KOTORI = 'PL!-bp8-003-SEC',
  AYUMU = 'PL!N-bp8-001-SEC';
const handCodes = ['PL!-sd1-002-SD', 'PL!-sd1-005-SD', 'PL!-sd1-006-SD'];
const data = (code: string): AnyCardData => {
  const r = rows.find((r) => r.cardCode === code)!;
  return {
    ...r,
    name: r.nameCn ?? r.nameJp,
    cardText: r.cardTextCn,
    hearts: r.hearts ?? [],
    bladeHearts: r.bladeHearts ?? [],
    unitName: r.unitName ?? undefined,
    ...(r.cardType === 'LIVE'
      ? {
          requirements: createHeartRequirement(
            Object.fromEntries((r.requirements ?? []).map((h) => [h.color, h.count]))
          ),
        }
      : {}),
  } as unknown as AnyCardData;
};
export const imageFor = (code: string) =>
  code === 'ENERGY'
    ? '/back.jpg'
    : `/images/large/${code.startsWith('PL!-bp8-003-') ? KOTORI : code.startsWith('PL!N-bp8-001-') ? AYUMU : code}.webp`;
export function previewCue(kind: CareEffectKind): CareEffectCue {
  return {
    key: 'preview',
    kind,
    sourceId: 'obj_source',
    ownerSeat: 'FIRST',
    targets:
      kind === 'AYUMU_GIVE'
        ? [
            { memberId: 'obj_source', energyId: 'obj_energy-0' },
            { memberId: 'obj_other', energyId: 'obj_energy-1' },
          ]
        : kind === 'AYUMU_RETURN'
          ? [{ memberId: 'obj_other', energyId: 'obj_energy-1' }]
          : [],
  };
}
export function setupCare(scene: Scene = 'kotori', rarity = 'SEC', fromHand = false) {
  const session = createGameSession({ cardEntrance: 'LOCAL' });
  const isKotori = scene.startsWith('kotori');
  const relay = scene === 'kotori-relay';
  const success = scene === 'ayumu-live';
  const base = isKotori ? KOTORI : AYUMU;
  const source = { ...data(base), cardCode: base.replace('-SEC', `-${rarity}`) } as AnyCardData;
  const energy = { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY } as const;
  const deck = Array.from({ length: 30 }, (_, i) => data(handCodes[i % handCodes.length]));
  let game = registerCards(
    session.createGame(`care-${Date.now()}`, 'p1', '小鸟与步梦 · 心意赠礼', 'p2', '对手'),
    [
      createCardInstance(source, 'p1', 'source'),
      createCardInstance(source, 'p1', 'second-source'),
      createCardInstance(data(handCodes[0]), 'p1', 'relay-member'),
      createCardInstance(data('PL!N-sd1-006-SD'), 'p1', 'other'),
      createCardInstance(data('PL!-sd1-008-SD'), 'p2', 'opponent'),
      createCardInstance(data('PL!-sd1-019-SD'), 'p1', 'live'),
      ...handCodes.map((c, i) => createCardInstance(data(c), 'p1', `hand-${i}`)),
      ...deck.map((c, i) => createCardInstance(c, 'p1', `deck-${i}`)),
      ...Array.from({ length: 16 }, (_, i) => createCardInstance(energy, 'p1', `energy-${i}`)),
    ]
  );
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: {
      ...p.hand,
      cardIds: [
        ...(fromHand ? ['source'] : []),
        ...handCodes.map((_, i) => `hand-${i}`),
        ...(success ? [] : ['live']),
      ],
    },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((_, i) => `deck-${i}`) },
    memberSlots: {
      ...p.memberSlots,
      slots: {
        LEFT: relay ? 'second-source' : null,
        CENTER: fromHand ? null : 'source',
        RIGHT: relay ? 'relay-member' : isKotori ? null : 'other',
      },
      cardStates: new Map([
        ...(fromHand ? [] : [['source', up] as const]),
        ...(!isKotori ? [['other', up] as const] : []),
        ...(relay
          ? [
              ['second-source', up] as const,
              ['relay-member', { ...up, orientation: OrientationState.WAITING }] as const,
            ]
          : []),
      ]),
      energyBelow: {
        LEFT: [],
        CENTER: success ? ['energy-0'] : [],
        RIGHT: success ? ['energy-1'] : [],
      },
    },
    liveZone: {
      ...p.liveZone,
      cardIds: success ? ['live'] : [],
      cardStates: new Map(success ? [['live', up]] : []),
    },
    energyZone: {
      ...p.energyZone,
      cardIds: Array.from(
        { length: success ? 10 : 12 },
        (_, i) => `energy-${i + (success ? 2 : 0)}`
      ),
      cardStates: new Map(
        Array.from({ length: success ? 10 : 12 }, (_, i) => [`energy-${i + (success ? 2 : 0)}`, up])
      ),
    },
    energyDeck: {
      ...p.energyDeck,
      cardIds: Array.from({ length: 4 }, (_, i) => `energy-${i + 12}`),
    },
  }));
  game = updatePlayer(game, 'p2', (p) => ({
    ...p,
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: null, CENTER: 'opponent', RIGHT: null },
      cardStates: new Map([['opponent', up]]),
    },
  }));
  game = {
    ...game,
    isStarted: true,
    currentPhase: success ? GamePhase.LIVE_RESULT_PHASE : GamePhase.MAIN_PHASE,
    currentSubPhase: success ? SubPhase.RESULT_FIRST_SUCCESS_EFFECTS : SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    waitingForInput: false,
    manualOperationMode: 'RULES',
    ...(success
      ? {
          liveResolution: {
            ...game.liveResolution,
            isInLive: true,
            performingPlayerId: 'p1',
            liveResults: new Map([['live', true]]),
            playerScores: new Map([
              ['p1', 1],
              ['p2', 0],
            ]),
          },
        }
      : {}),
  };
  if (success) {
    // Fixture starts at a successful LIVE boundary; subsequent choices use real commands.
    game = resolvePendingCardEffects(
      enqueueTriggeredCardEffects(emitGameEvent(game, createLiveSuccessEvent('p1', ['live'], 1)), [
        TriggerCondition.ON_LIVE_SUCCESS,
      ])
    ).gameState;
  }
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  useGameStore.getState().loadCardData([...rows.map((r) => data(r.cardCode)), source, energy]);
  useGameStore.setState({
    gameSession: session,
    gameMode: GameMode.DEBUG,
    viewingPlayerId: 'p1',
    playerViewState: null,
    remoteSession: null,
    replaySession: null,
    getCardImagePath: imageFor,
    ui: {
      ...useGameStore.getState().ui,
      battleAnimationOcclusions: [],
      battleFeedbackEvents: [],
      hoveredCardId: null,
      selectedCardId: null,
      cardDetail: null,
    },
  });
  useGameStore.getState().syncState();
  return session;
}
