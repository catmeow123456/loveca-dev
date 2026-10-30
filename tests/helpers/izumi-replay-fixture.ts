import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { HS_BP8_008_ACTIVATED_DISCARD_REPLAY_OTHER_EDELNOTE_MEMBER_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { createCardInstance } from '../../src/domain/entities/card';
import { registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  FaceState,
  GamePhase,
  OrientationState,
  SubPhase,
  TurnType,
  SlotPosition,
} from '../../src/shared/types/enums';
import { getOctober29DraftCard } from './october-29-draft-effects';

export function prepareIzumiReplay(
  options: {
    owner?: 0 | 1;
    plain?: boolean;
    mode?: 'LOCAL' | 'REMOTE';
    rare?: string;
    noTarget?: boolean;
  } = {},
  existing?: GameSession
) {
  let now = 1000;
  const session =
    existing ?? createGameSession({ cardEntrance: options.mode ?? 'REMOTE', now: () => now });
  const initial = session.state ?? session.createGame('izumi-replay', 'p1', 'P1', 'p2', 'P2');
  const owner = initial.players[options.owner ?? 0].id,
    other = initial.players[options.owner === 1 ? 0 : 1].id;
  const izumi = {
    ...getOctober29DraftCard('PL!HS-bp8-008'),
    cardCode: `PL!HS-bp8-008-${options.rare ?? 'SEC'}`,
  };
  const target = options.plain ? izumi : getOctober29DraftCard('PL!HS-bp8-007');
  const filler = getOctober29DraftCard('PL!HS-bp8-008');
  const cards = [
    createCardInstance(izumi, owner, 'izumi'),
    createCardInstance(target, owner, 'partner'),
    createCardInstance(filler, owner, 'discard'),
    ...Array.from({ length: 8 }, (_, i) => createCardInstance(filler, owner, `private-deck-${i}`)),
  ];
  let game = registerCards(initial, cards);
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  game = updatePlayer(game, owner, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['discard'] },
    mainDeck: { ...p.mainDeck, cardIds: cards.slice(3).map((c) => c.instanceId) },
    waitingRoom: { ...p.waitingRoom, cardIds: [] },
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: 'izumi', CENTER: options.noTarget ? null : 'partner', RIGHT: null },
      cardStates: new Map([
        ['izumi', up],
        ...(!options.noTarget
          ? [['partner', { ...up, orientation: OrientationState.WAITING }] as const]
          : []),
      ]),
    },
  }));
  session.restoreRuntimeState({
    authorityState: {
      ...game,
      isStarted: true,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      currentTurnType: TurnType.NORMAL,
      activePlayerIndex: options.owner ?? 0,
      waitingPlayerId: null,
      waitingForInput: false,
      activeEffect: null,
      pendingAbilities: [],
      manualOperationMode: 'RULES',
    },
    currentPublicSeq: 0,
  });
  const confirm = (id?: string | null) =>
    session.executeCommand(
      createConfirmEffectStepCommand(owner, session.state!.activeEffect!.id, id)
    );
  return {
    session,
    owner,
    other,
    setNow: (value: number) => {
      now = value;
    },
    start: () => session.executeCommand(createActivateAbilityCommand(owner, 'izumi', ABILITY)),
    confirm,
    replay: () => {
      const start = session.executeCommand(createActivateAbilityCommand(owner, 'izumi', ABILITY));
      if (!start.success) throw new Error(start.error);
      const paid = confirm('discard');
      if (!paid.success) throw new Error(paid.error);
      return confirm('partner');
    },
    ack: (player = owner, id = session.state!.entranceRuntime!.pending!.id) =>
      session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId: player,
        entranceId: id,
        timestamp: now,
      }),
    player: () => session.state!.players.find((p) => p.id === owner)!,
  };
}
