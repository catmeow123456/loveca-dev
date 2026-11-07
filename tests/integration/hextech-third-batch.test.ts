import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { createMulliganCommand } from '../../src/application/game-commands';
import {
  createCardInstance,
  createFaceDownCardState,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import {
  collectLiveModifiers,
  getLiveCardRequirementModifiers,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { type HextechId } from '../../src/domain/hextech/catalog';
import { projectPlayerViewState } from '../../src/online/projector';
import { getAdjustedLiveRequirements } from '../../client/src/lib/liveJudgmentPreview';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';

const member: MemberCardData = {
  cardCode: 'TEST-M',
  name: '测试成员',
  cardType: CardType.MEMBER,
  cost: 1,
  blade: 0,
  hearts: [
    { color: HeartColor.PINK, count: 2 },
    { color: HeartColor.RED, count: 2 },
    { color: HeartColor.YELLOW, count: 2 },
  ],
};
const threeColorSong: LiveCardData = {
  cardCode: 'TEST-3C-L',
  name: '三色歌曲',
  cardType: CardType.LIVE,
  score: 3,
  requirements: createHeartRequirement({
    [HeartColor.PINK]: 1,
    [HeartColor.RED]: 1,
    [HeartColor.YELLOW]: 1,
    [HeartColor.GRAY]: 4,
  }),
};
const twoColorSong: LiveCardData = {
  ...threeColorSong,
  cardCode: 'TEST-2C-L',
  name: '双色歌曲',
  requirements: createHeartRequirement({
    [HeartColor.PINK]: 1,
    [HeartColor.RED]: 1,
    [HeartColor.GRAY]: 3,
  }),
};
const deck: DeckConfig = {
  mainDeck: Array.from({ length: 60 }, () => member),
  energyDeck: Array.from({ length: 12 }, () => ({
    cardCode: 'TEST-E',
    name: '能量',
    cardType: CardType.ENERGY,
  })),
};

function begin(ids: readonly HextechId[]) {
  const session = createGameSession({ randomInt: (max) => max - 1 });
  session.createGame('hextech-third-batch', 'p1', 'P1', 'p2', 'P2', [[...ids], []]);
  expect(session.initializeGame(deck, deck).success).toBe(true);
  expect(session.executeCommand(createMulliganCommand('p1', [])).success).toBe(true);
  expect(session.executeCommand(createMulliganCommand('p2', [])).success).toBe(true);
  return session.state!;
}

function withSong(game: GameState, song: LiveCardData, faceDown = false): GameState {
  const registered = registerCards(game, [
    createCardInstance(song, 'p1', 'song'),
    createCardInstance(member, 'p1', 'stage'),
  ]);
  return updatePlayer(registered, 'p1', (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(
      player.liveZone,
      'song',
      faceDown ? createFaceDownCardState() : undefined
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'stage'),
  }));
}

function judge(game: GameState) {
  return new GameService().processAction(
    {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    },
    { type: 'CONFIRM_JUDGMENT', playerId: 'p1', timestamp: 1, judgmentResults: new Map() }
  );
}

describe('海克斯第三批：小画家与灵活单推', () => {
  it('小画家只对三色以上 LIVE 清除灰心，每张 LIVE 已需的颜色仍逐色加一', () => {
    const base = begin(['little-painter']);
    const threeColor = withSong(base, threeColorSong);
    const threeModifiers = getLiveCardRequirementModifiers(
      threeColor.liveResolution,
      'song',
      collectLiveModifiers(threeColor)
    );
    const threeAdjusted = applyHeartRequirementModifiers(
      threeColorSong.requirements,
      threeModifiers
    );
    expect([...threeAdjusted.colorRequirements]).toEqual([
      [HeartColor.PINK, 2],
      [HeartColor.RED, 2],
      [HeartColor.YELLOW, 2],
    ]);
    expect(threeAdjusted.totalRequired).toBe(6);
    const ownerView = projectPlayerViewState(threeColor, 'p1');
    const preview = getAdjustedLiveRequirements(
      threeColorSong.requirements,
      ownerView.match.liveResult!.requirementModifiers.obj_song
    );
    expect([...preview.colorRequirements]).toEqual([...threeAdjusted.colorRequirements]);
    expect(preview.totalRequired).toBe(threeAdjusted.totalRequired);
    expect(judge(threeColor).gameState.liveResolution.liveResults.get('song')).toBe(true);
    expect(
      judge({ ...threeColor, hextech: undefined }).gameState.liveResolution.liveResults.get('song')
    ).toBe(false);

    const twoColor = withSong(base, twoColorSong);
    const twoAdjusted = applyHeartRequirementModifiers(
      twoColorSong.requirements,
      getLiveCardRequirementModifiers(
        twoColor.liveResolution,
        'song',
        collectLiveModifiers(twoColor)
      )
    );
    expect([...twoAdjusted.colorRequirements]).toEqual([
      [HeartColor.PINK, 2],
      [HeartColor.RED, 2],
      [HeartColor.RAINBOW, 3],
    ]);
    expect(judge(twoColor).gameState.liveResolution.liveResults.get('song')).toBe(false);
  });

  it('小画家在其他必要心增量后清灰并增强新增颜色；盖牌时对手看不到修正细节', () => {
    const base = withSong(begin(['little-painter']), threeColorSong, true);
    const game = {
      ...base,
      liveResolution: {
        ...base.liveResolution,
        liveModifiers: [
          {
            kind: 'REQUIREMENT' as const,
            liveCardId: 'song',
            visibilityDependency: { kind: 'PLAYER_LIVE_ZONE_CONTENTS' as const, playerId: 'p1' },
            modifiers: [
              { color: HeartColor.RAINBOW, countDelta: 1 },
              { color: HeartColor.GREEN, countDelta: 1 },
            ],
          },
        ],
      },
    };
    const adjusted = applyHeartRequirementModifiers(
      threeColorSong.requirements,
      getLiveCardRequirementModifiers(game.liveResolution, 'song', collectLiveModifiers(game))
    );
    expect(adjusted.colorRequirements.get(HeartColor.RAINBOW)).toBeUndefined();
    expect(adjusted.colorRequirements.get(HeartColor.GREEN)).toBe(2);
    expect(adjusted.totalRequired).toBe(8);
    expect(
      projectPlayerViewState(game, 'p1').match.liveResult!.requirementModifiers.obj_song
    ).toHaveLength(3);
    expect(
      projectPlayerViewState(game, 'p2').match.liveResult!.requirementModifiers.obj_song
    ).toBeUndefined();
    const revealed = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardStates: new Map(player.liveZone.cardStates).set('song', {
          ...player.liveZone.cardStates.get('song')!,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    expect(
      projectPlayerViewState(revealed, 'p2').match.liveResult!.requirementModifiers.obj_song
    ).toHaveLength(3);
  });

  it('灵活单推的中央成员获得团体心，改变实际 LIVE 判定；移出中央后加成消失', () => {
    const base = begin(['flexible-solo-fan']);
    const center: MemberCardData = {
      ...member,
      cardCode: 'TEST-MUSE-M',
      hearts: [],
      groupNames: ["μ's"],
    };
    const song: LiveCardData = {
      ...threeColorSong,
      requirements: createHeartRequirement({
        [HeartColor.PINK]: 1,
        [HeartColor.YELLOW]: 1,
        [HeartColor.PURPLE]: 1,
      }),
    };
    let game = registerCards(base, [
      createCardInstance(center, 'p1', 'center'),
      createCardInstance(song, 'p1', 'song'),
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'center'),
      liveZone: addCardToStatefulZone(player.liveZone, 'song'),
    }));
    expect(getMemberEffectiveHeartIcons(game, 'p1', 'center')).toEqual([
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.YELLOW, count: 1 },
      { color: HeartColor.PURPLE, count: 1 },
    ]);
    expect(judge(game).gameState.liveResolution.liveResults.get('song')).toBe(true);

    const moved = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        SlotPosition.LEFT,
        'center'
      ),
    }));
    expect(getMemberEffectiveHeartIcons(moved, 'p1', 'center')).toEqual([]);
    expect(judge(moved).gameState.liveResolution.liveResults.get('song')).toBe(false);
    expect(getMemberEffectiveHeartIcons(game, 'p2', 'center')).toEqual([]);
  });

  it('灵活单推识别水、星、莲、虹，并让跨团体中央成员叠加对应心与棒', () => {
    const base = begin(['flexible-solo-fan']);
    const withCenter = (groupNames: readonly string[]): GameState => {
      const center: MemberCardData = {
        ...member,
        cardCode: 'TEST-GROUP-M',
        hearts: [],
        groupNames,
      };
      const game = registerCards(base, [createCardInstance(center, 'p1', 'center')]);
      return updatePlayer(game, 'p1', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'center'),
      }));
    };
    for (const [group, colors] of [
      ['Aqours', [HeartColor.RED, HeartColor.GREEN, HeartColor.BLUE]],
      ['Liella!', [HeartColor.RED, HeartColor.YELLOW, HeartColor.PURPLE]],
      ['蓮ノ空', [HeartColor.PINK, HeartColor.GREEN, HeartColor.BLUE]],
    ] as const) {
      expect(getMemberEffectiveHeartIcons(withCenter([group]), 'p1', 'center')).toEqual(
        colors.map((color) => ({ color, count: 1 }))
      );
    }
    const niji = withCenter(['虹ヶ咲']);
    expect(getMemberEffectiveBladeCount(niji, 'p1', 'center')).toBe(4);
    expect(getMemberEffectiveHeartIcons(niji, 'p1', 'center')).toEqual([]);

    const mixed = withCenter(["μ's", '虹ヶ咲']);
    expect(getMemberEffectiveHeartIcons(mixed, 'p1', 'center')).toEqual([
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.YELLOW, count: 1 },
      { color: HeartColor.PURPLE, count: 1 },
    ]);
    expect(getMemberEffectiveBladeCount(mixed, 'p1', 'center')).toBe(4);
    const effects = collectLiveModifiers(mixed).filter(
      (modifier) =>
        'sourceHextechInstanceId' in modifier && modifier.sourceHextechInstanceId !== undefined
    );
    expect(effects).toHaveLength(2);
    expect(effects.every((modifier) => !('sourceCardId' in modifier))).toBe(true);
  });
});
