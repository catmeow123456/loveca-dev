import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon } from '../../src/domain/entities/card';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  createBeginSpecialMemberPlayCommand,
  GameCommandType,
  type GameCommand,
} from '../../src/application/game-commands';
import { createPublicObjectId } from '../../src/online/projector';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import type { MemberPlayOption } from '../../src/shared/rules/member-play-options';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';

const P1 = 'player-1';
const P2 = 'player-2';

function member(cardCode: string, name: string, cost = 3): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function deck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 60 }, (_, index) =>
      member(`GENERIC-${index}`, `普通成员${index}`)
    ) as AnyCardData[],
    energyDeck: Array.from({ length: 12 }, (_, index) => energy(`ENERGY-${index}`)),
  };
}

function setupOptions() {
  const session = createGameSession();
  session.createGame('member-play-options', P1, 'P1', P2, 'P2');
  session.initializeGame(deck(), deck());
  const game = session.state!;
  Object.assign(game, {
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  });
  const player = game.players[0];
  const ids = [...player.hand.cardIds, ...player.mainDeck.cardIds].slice(0, 12);
  const [
    doubleRelayId,
    llId,
    miaId,
    ordinaryId,
    hanamaruId,
    setsunaId,
    chisatoId,
    leftId,
    centerId,
    rightId,
    waitingId,
  ] = ids;
  const entries: readonly [string, MemberCardData][] = [
    [doubleRelayId!, member('PL!-pb2-000-DUO', '星空凛&小泉花阳', 15)],
    [llId!, member('LL-bp7-001-R+', '国木田花丸&優木せつ菜&嵐千砂都', 15)],
    [miaId!, member('PL!N-bp7-011-SEC', '米娅·泰勒', 13)],
    [ordinaryId!, member('ORDINARY-MEMBER', '普通成员', 5)],
    [hanamaruId!, member('PAY-HANAMARU', '国木田花丸')],
    [setsunaId!, member('PAY-SETSUNA', '優木せつ菜')],
    [chisatoId!, member('PAY-CHISATO', '嵐千砂都')],
    [leftId!, member('LEFT-OCCUPANT', '左侧成员', 2)],
    [centerId!, member('CENTER-OCCUPANT', '中心成员', 2)],
    [rightId!, member('RIGHT-OCCUPANT', '右侧成员', 2)],
    [waitingId!, member('WAITING-MEMBER', '休息室成员', 2)],
  ];
  for (const [cardId, data] of entries) {
    const card = game.cardRegistry.get(cardId)!;
    // Test setup replaces printed data before issuing authority commands.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    game.cardRegistry.set(cardId, { ...card, data });
  }

  player.hand.cardIds = [
    doubleRelayId!,
    llId!,
    miaId!,
    ordinaryId!,
    hanamaruId!,
    setsunaId!,
    chisatoId!,
  ];
  player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
    (cardId) => !ids.slice(0, 11).includes(cardId)
  );
  player.waitingRoom.cardIds = [waitingId!];
  player.memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, leftId!, {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  });
  player.memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, centerId!, {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  });
  player.memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, rightId!, {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  });
  player.movedToStageThisTurn = [leftId!];

  return {
    session,
    ids: { doubleRelayId: doubleRelayId!, llId: llId!, miaId: miaId!, ordinaryId: ordinaryId! },
  };
}

function getProjectedOptions(
  session: ReturnType<typeof createGameSession>
): Readonly<Record<string, readonly MemberPlayOption[]>> {
  const hint = session
    .getPlayerViewState(P1)
    .permissions.availableCommands.find(
      (candidate) => candidate.command === GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY
    );
  return (hint?.params?.memberPlayOptionsByObjectId ?? {}) as Readonly<
    Record<string, readonly MemberPlayOption[]>
  >;
}

describe('server member play option projection', () => {
  it('projects finite card-defined and double-relay options without a client card whitelist', () => {
    const { session, ids } = setupOptions();
    const options = getProjectedOptions(session);
    const doubleOptions = options[createPublicObjectId(ids.doubleRelayId)] ?? [];
    const llOptions = options[createPublicObjectId(ids.llId)] ?? [];
    const miaOptions = options[createPublicObjectId(ids.miaId)] ?? [];

    expect(doubleOptions).toEqual([
      {
        id: 'DOUBLE_RELAY',
        label: '双换手',
        kind: 'DOUBLE_RELAY',
        title: '选择双换手区域',
        description: '依次选择两个成员区。第1个是登场位置，第2个是追加换手位置。',
        targetSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
        selection: { minTargets: 2, maxTargets: 2, mustIncludeTarget: true },
      },
    ]);
    expect(llOptions).toEqual([
      {
        id: 'LL_BP7_001_SPECIAL_PLAY',
        label: '特殊登场',
        kind: 'CARD_DEFINED',
        title: '选择特殊登场区域',
        description:
          '选择「国木田花丸」「优木雪菜」「岚千砂都」的成员卡各1张放置入休息室，再完成特殊登场。',
        targetSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
        mode: 'LL_BP7_001_SPECIAL_PLAY',
      },
    ]);
    expect(miaOptions).toEqual([
      {
        id: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
        label: '特殊登场',
        kind: 'CARD_DEFINED',
        title: '选择特殊登场区域',
        description:
          '将自己休息室中的所有成员卡洗切并放置于卡组底，使此卡本次登场费用减2，再完成特殊登场。',
        targetSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
        mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
      },
    ]);
    expect(options[createPublicObjectId(ids.ordinaryId)]).toBeUndefined();
  });

  it('FREE projects the slot occupied by a member that entered this turn', () => {
    const { session, ids } = setupOptions();
    expect(session.setManualOperationMode('FREE').success).toBe(true);
    const options = getProjectedOptions(session);
    for (const sourceId of [ids.doubleRelayId, ids.llId, ids.miaId]) {
      expect(options[createPublicObjectId(sourceId)]?.[0]?.targetSlots).toEqual([
        SlotPosition.LEFT,
        SlotPosition.CENTER,
        SlotPosition.RIGHT,
      ]);
    }
  });

  it('rejects an unknown special-play mode without throwing or creating a pending window', () => {
    const { session, ids } = setupOptions();
    const forged = {
      ...createBeginSpecialMemberPlayCommand(P1, ids.llId, SlotPosition.CENTER),
      mode: 'UNKNOWN_SPECIAL_PLAY',
    } as unknown as GameCommand;

    const result = session.executeCommand(forged);

    expect(result.success).toBe(false);
    expect(result.error).toBe('不支持的特殊登场方式');
    expect(session.state!.pendingSpecialMemberPlay).toBeNull();
  });
});
