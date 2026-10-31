import { useGameStore } from '@/store/gameStore';
import { createGameSession } from '@game/application/game-session';
import { createPlayMemberToSlotCommand, GameCommandType } from '@game/application/game-commands';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
} from '@game/domain/entities/card';
import { registerCards, updatePlayer } from '@game/domain/entities/game';
import {
  CardType,
  FaceState,
  GamePhase,
  GameMode,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '@game/shared/types/enums';
import rows from './cards.json';

export const SERAS = 'PL!HS-bp8-007-SEC';
function data(code: string): AnyCardData {
  const row = rows.find((r) => r.cardCode === code)!;
  return {
    ...row,
    name: row.nameCn,
    cardText: row.cardTextCn,
    hearts: row.hearts ?? [],
    bladeHearts: row.bladeHearts ?? [],
    ...(row.cardType === 'LIVE'
      ? {
          requirements: createHeartRequirement(
            Object.fromEntries((row.requirements ?? []).map((h) => [h.color, h.count]))
          ),
        }
      : {}),
  } as unknown as AnyCardData;
}

/** Real card data and commands. Only the initial deal is deterministic. */
export function setupSeras({
  open = false,
  entrance = false,
  noTarget = false,
  opponent = false,
  rare = 'SEC',
  lock = false,
  lockActive = false,
  lockEntry = false,
  replay = false,
  replayPlain = false,
  protection = false,
} = {}) {
  // Focused protection review omits the partner's portrait barrier, using the session's
  // supported no-presentation mode. Normal entrance/replay fixtures still use LOCAL.
  const session = createGameSession(protection ? {} : { cardEntrance: 'LOCAL' });
  const seras = { ...data(SERAS), cardCode: `PL!HS-bp8-007-${rare}` };
  const izumi = { ...data('PL!HS-bp8-008-SEC'), cardCode: `PL!HS-bp8-008-${rare}` };
  const purple = data('PL!HS-bp8-023-L');
  const icy = data('PL!HS-bp8-020-L');
  const other = data('PL!HS-bp8-017-SECL');
  const honoka = data('PL!-pb1-019-N');
  const lowIzumi = data('PL!HS-cl1-008-CL');
  const noActivated = data('PL!HS-cl1-001-CL');
  const energy = { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY } as const;
  const inspected = noTarget
    ? [other, izumi, other, seras, izumi]
    : [purple, izumi, other, icy, seras];
  const deck = [...inspected, ...Array.from({ length: 25 }, () => izumi)];
  const cards = [
    createCardInstance(seras, 'p1', 'seras'),
    createCardInstance(izumi, 'p1', 'hand-izumi'),
    ...(replay
      ? [
          createCardInstance(izumi, 'p1', 'replay-izumi'),
          ...Array.from({ length: 3 }, (_, i) =>
            createCardInstance(other, 'p1', `replay-cost-${i}`)
          ),
        ]
      : []),
    ...(lock
      ? [
          createCardInstance(lockEntry ? lowIzumi : honoka, 'p1', 'own-low'),
          createCardInstance(lowIzumi, 'p2', 'enemy-low'),
          createCardInstance(izumi, 'p2', 'enemy-high'),
          createCardInstance(noActivated, 'p2', 'enemy-no-activated'),
        ]
      : []),
    ...deck.map((c, i) => createCardInstance(c, 'p1', `deck-${i}`)),
    ...Array.from({ length: 18 }, (_, i) => createCardInstance(energy, 'p1', `energy-${i}`)),
  ];
  let game = registerCards(
    session.createGame(`seras-preview-${Date.now()}`, 'p1', '塞拉丝 · 幕间选曲', 'p2', '对手'),
    cards
  );
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['seras', 'hand-izumi'] },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((_, i) => `deck-${i}`) },
    energyZone: {
      ...p.energyZone,
      cardIds: cards.filter((c) => c.data.cardType === CardType.ENERGY).map((c) => c.instanceId),
      cardStates: new Map(Array.from({ length: 18 }, (_, i) => [`energy-${i}`, up])),
    },
  }));
  if (replay) {
    const target = replayPlain ? 'replay-izumi' : 'seras';
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['replay-cost-0', 'replay-cost-1', 'replay-cost-2'] },
      memberSlots: {
        ...p.memberSlots,
        slots: { LEFT: 'hand-izumi', CENTER: target, RIGHT: null },
        cardStates: new Map([
          ['hand-izumi', up],
          [target, { ...up, orientation: OrientationState.WAITING }],
        ]),
      },
    }));
  }
  if (protection) {
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['seras'] },
      // Empty deck/waiting room lets the real on-enter finish with nothing to inspect.
      mainDeck: { ...p.mainDeck, cardIds: [] },
      memberSlots: {
        ...p.memberSlots,
        slots: { LEFT: 'hand-izumi', CENTER: null, RIGHT: null },
        cardStates: new Map([['hand-izumi', up]]),
      },
    }));
  }
  if (lock) {
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: lockEntry ? ['own-low'] : [] },
      memberSlots: {
        ...p.memberSlots,
        slots: { LEFT: 'hand-izumi', CENTER: 'seras', RIGHT: lockEntry ? null : 'own-low' },
        cardStates: new Map([
          [
            'hand-izumi',
            { ...up, orientation: lockActive ? OrientationState.ACTIVE : OrientationState.WAITING },
          ],
          ['seras', up],
          ...(!lockEntry ? [['own-low', up] as const] : []),
        ]),
      },
    }));
    game = updatePlayer(game, 'p2', (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        slots: { LEFT: 'enemy-low', CENTER: 'enemy-high', RIGHT: 'enemy-no-activated' },
        cardStates: new Map([
          ['enemy-low', up],
          ['enemy-high', up],
          ['enemy-no-activated', up],
        ]),
      },
    }));
  }
  game = {
    ...game,
    isStarted: true,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    waitingForInput: false,
    manualOperationMode: lock || protection ? 'FREE' : 'RULES',
  };
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  if ((open || entrance) && !lock && !replay && !protection) {
    const result = session.executeCommand(
      createPlayMemberToSlotCommand('p1', 'seras', SlotPosition.CENTER)
    );
    if (!result.success) throw new Error(JSON.stringify(result));
    // The inspection-only shortcut skips via the normal ACK before mounting the fixture.
    // Real drags and the entrance preview leave the shared entrance barrier intact.
    const pending = session.state?.entranceRuntime?.pending;
    if (open && pending) {
      const ack = session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId: 'p1',
        entranceId: pending.id,
        timestamp: Date.now(),
      });
      if (!ack.success) throw new Error(JSON.stringify(ack));
    }
  }
  useGameStore
    .getState()
    .loadCardData([seras, izumi, purple, icy, other, honoka, lowIzumi, noActivated, energy]);
  useGameStore.setState({
    gameSession: session,
    gameMode: opponent ? GameMode.SOLITAIRE : GameMode.DEBUG,
    viewingPlayerId: opponent ? 'p2' : 'p1',
    playerViewState: null,
    remoteSession: null,
    replaySession: null,
    getCardImagePath: (code) =>
      code === 'ENERGY'
        ? '/back.jpg'
        : `/images/large/${code.startsWith('PL!HS-bp8-007-') ? SERAS : code.startsWith('PL!HS-bp8-008-') ? 'PL!HS-bp8-008-SEC' : code}.webp`,
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
