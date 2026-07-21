import { afterEach, describe, expect, it } from 'vitest';
import {
  createMulliganCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  advanceDebugMatchPhase,
  changeDebugManualOperationMode,
  executeDebugMatchCommand,
  getDebugMatchSnapshot,
  resetDebugMatch,
  selectDebugSeatDeck,
} from '../../src/server/services/debug-match-service';
import { CardType, GamePhase, HeartColor, SlotPosition } from '../../src/shared/types/enums';

const MATCH_ID = 'manual-operation-mode-debug';

describe('远程调试操作模式', () => {
  afterEach(() => {
    resetDebugMatch(MATCH_ID);
  });

  it('客户端伪造 freePlay 不能绕过规则模式，切换自由模式后由权威状态放行', () => {
    const deck = createDeck();
    selectDebugSeatDeck({
      matchId: MATCH_ID,
      seat: 'FIRST',
      playerName: 'Alpha',
      deckName: 'A',
      deck,
    });
    selectDebugSeatDeck({
      matchId: MATCH_ID,
      seat: 'SECOND',
      playerName: 'Beta',
      deckName: 'B',
      deck,
    });

    expect(
      executeDebugMatchCommand(MATCH_ID, 'FIRST', createMulliganCommand('ignored', [])).success
    ).toBe(true);
    expect(
      executeDebugMatchCommand(MATCH_ID, 'SECOND', createMulliganCommand('ignored', [])).success
    ).toBe(true);

    let snapshot = getDebugMatchSnapshot(MATCH_ID, 'FIRST');
    for (
      let attempt = 0;
      snapshot?.playerViewState.match.phase !== GamePhase.MAIN_PHASE;
      attempt += 1
    ) {
      expect(attempt, snapshot?.playerViewState.match.phase).toBeLessThan(12);
      const advanced = advanceDebugMatchPhase(MATCH_ID, 'FIRST');
      expect(advanced.success, advanced.error).toBe(true);
      snapshot = getDebugMatchSnapshot(MATCH_ID, 'FIRST');
    }

    expect(snapshot?.playerViewState.match.manualOperation?.mode).toBe('RULES');
    const memberObjectId = snapshot?.playerViewState.table.zones.FIRST_HAND.objectIds?.find(
      (objectId) => snapshot?.playerViewState.objects[objectId]?.cardType === CardType.MEMBER
    );
    expect(memberObjectId).toBeTruthy();
    const memberId = memberObjectId!.startsWith('obj_')
      ? memberObjectId!.slice(4)
      : memberObjectId!;

    const forged = createPlayMemberToSlotCommand('forged-player', memberId!, SlotPosition.CENTER, {
      freePlay: true,
    });
    const rejected = executeDebugMatchCommand(MATCH_ID, 'FIRST', forged);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('能量');

    const switched = changeDebugManualOperationMode(MATCH_ID, 'FIRST', 'FREE');
    expect(switched.success, switched.error).toBe(true);
    const repeated = changeDebugManualOperationMode(MATCH_ID, 'SECOND', 'FREE');
    expect(repeated.success, repeated.error).toBe(true);
    expect(repeated.snapshot?.seq).toBe(switched.snapshot?.seq);
    const accepted = executeDebugMatchCommand(MATCH_ID, 'FIRST', {
      ...forged,
      freePlay: false,
    });
    expect(accepted.success, accepted.error).toBe(true);
    expect(accepted.snapshot?.playerViewState.table.zones.FIRST_MEMBER_CENTER.slotMap?.CENTER).toBe(
      memberObjectId
    );
  });
});

function createDeck(): DeckConfig {
  const mainDeck: Array<MemberCardData | LiveCardData> = [];
  const energyDeck: EnergyCardData[] = [];
  for (let index = 0; index < 48; index += 1) {
    mainDeck.push({
      cardCode: `DEBUG-MEMBER-${index}`,
      name: `高费用成员 ${index}`,
      cardType: CardType.MEMBER,
      cost: 99,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    });
  }
  for (let index = 0; index < 12; index += 1) {
    mainDeck.push({
      cardCode: `DEBUG-LIVE-${index}`,
      name: `DEBUG LIVE ${index}`,
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    });
    energyDeck.push({
      cardCode: `DEBUG-ENERGY-${index}`,
      name: `DEBUG ENERGY ${index}`,
      cardType: CardType.ENERGY,
    });
  }
  return { mainDeck, energyDeck };
}
