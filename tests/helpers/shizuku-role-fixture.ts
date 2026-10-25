import { createGameSession } from '../../src/application/game-session';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import { member } from './card-effect-zone-fixture';

export function prepareShizukuRole(
  options: {
    print?: string;
    mode?: 'LOCAL' | 'REMOTE' | 'OFF';
    emptyHearts?: boolean;
    noTarget?: boolean;
    queuedMia?: boolean;
  } = {}
) {
  let now = 1000;
  const session = createGameSession({
    now: () => now,
    ...(options.mode === 'OFF' ? {} : { cardEntrance: options.mode ?? 'REMOTE' }),
  });
  let state = session.createGame('shizuku-role', 'p1', '雫', 'p2', '对手');
  state = registerCards(state, [
    member('shizuku', {
      cardCode: options.print ?? 'PL!N-bp7-003-SEC',
      name: '樱坂雫',
      cost: 15,
      groupNames: ['虹ヶ咲'],
    }),
    member('role', {
      name: '优木雪菜',
      cost: 17,
      groupNames: options.noTarget ? ['Aqours'] : ['虹ヶ咲'],
      hearts: options.emptyHearts
        ? []
        : [
            { color: HeartColor.RED, count: 2 },
            { color: HeartColor.BLUE, count: 1 },
          ],
    }),
    member('secret', { cardCode: 'PRIVATE-OPPONENT-HAND' }, 'p2'),
    member('payment'),
    member('mia', { cardCode: 'PL!N-bp7-011-SEC', cost: 13, groupNames: ['虹ヶ咲'] }),
    ...Array.from({ length: 12 }, (_, i) => member(`deck-${i}`, { groupNames: ['Aqours'] })),
  ]);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    mainDeck: {
      ...p.mainDeck,
      cardIds: Array.from({ length: 12 }, (_, i) =>
        i === 0 && options.queuedMia ? 'mia' : `deck-${i}`
      ),
    },
    hand: { ...p.hand, cardIds: options.queuedMia ? ['payment'] : [] },
    waitingRoom: { ...p.waitingRoom, cardIds: ['role'] },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'shizuku', {
      face: FaceState.FACE_UP,
      orientation: OrientationState.ACTIVE,
    }),
  }));
  state = updatePlayer(state, 'p2', (p) => ({ ...p, hand: { ...p.hand, cardIds: ['secret'] } }));
  state = {
    ...state,
    isStarted: true,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
    manualOperationMode: 'RULES',
  };
  session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
  const commit = (game: GameState) =>
    (session as unknown as { setAuthorityState(game: GameState): void }).setAuthorityState(game);
  return {
    session,
    commit,
    activate: () => session.executeCommand(createActivateAbilityCommand('p1', 'shizuku', ABILITY)),
    reveal() {
      const effect = session.state!.activeEffect!;
      now = effect.publicRevealAutoAdvanceAt!;
      return session.executeCommand(
        createAutoAdvancePublicRevealCommand('p1', effect.id, now, effect.publicRevealGeneration!)
      );
    },
    select: () =>
      session.executeCommand(
        createConfirmEffectStepCommand('p1', session.state!.activeEffect!.id, 'role')
      ),
    ack(playerId = 'p1', entranceId = session.state!.entranceRuntime!.pending!.id) {
      return session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId,
        entranceId,
        timestamp: now,
      });
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
