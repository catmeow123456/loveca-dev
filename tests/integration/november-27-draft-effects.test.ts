import { describe, expect, it } from 'vitest';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getActivatedAbilityUiConfigs } from '../../src/application/card-effects/runtime/activated-ability-ui';
import {
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createSetLiveCardCommand,
  createSubmitJudgmentCommand,
  type GameCommand,
} from '../../src/application/game-commands';
import { createCardInstance } from '../../src/domain/entities/card';
import { updatePlayer } from '../../src/domain/entities/game';
import { CardType, GamePhase, SubPhase, TriggerCondition } from '../../src/shared/types/enums';
import { getBaseCardCode, VALID_RARITIES } from '../../src/shared/utils/card-code';
import rows from '../fixtures/november-27-draft-effects.json';
import {
  getNovember27MemberData,
  getNovember27LiveData,
} from '../helpers/november-27-draft-effects';
import { gameWith, hand, P1, P2, sessionFor, stage } from '../helpers/modifier-workflow-fixtures';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { expectMemberPlayAtPrintedCost } from '../helpers/rules-member-play';

const correctedDiaParagraph =
  '【LIVE成功时】选择１名存在于自己的舞台的『Aqours』的成员。检视自己的卡组顶，等同于该成员持有的HEART中数量最多的１种颜色的HEART的数量的张数的卡片。将其中的１张卡片加入手牌。其余的放置入休息室。';

const newPrints = rows.filter((row) => row.status === 'DRAFT');

describe.each(newPrints)('$cardCode $nameCn', (row) => {
  it('binds each printed paragraph to its timing, source and player-facing text at every rarity', () => {
    const base = getBaseCardCode(row.cardCode);
    const paragraphs =
      base === 'PL!S-pb2-004' ? [correctedDiaParagraph] : row.cardTextCn.split('\n\n');
    const tags = new Map([
      ['【常时】', ['CONTINUOUS', 'STAGE_MEMBER', undefined]],
      ['【起动】', ['ACTIVATED', 'STAGE_MEMBER', undefined]],
      ['【登场】', ['ON_ENTER', 'PLAYED_MEMBER', 'ON_ENTER_STAGE']],
      [
        '【LIVE成功时】',
        [
          'LIVE_SUCCESS',
          row.cardType === CardType.LIVE ? 'LIVE_CARD' : 'STAGE_MEMBER',
          'ON_LIVE_SUCCESS',
        ],
      ],
    ]);
    for (const code of [base, ...VALID_RARITIES.map((rare) => `${base}-${rare}`), `${base}-P＋`]) {
      const definitions = getCardAbilityDefinitionsForCardCode(code);
      expect(definitions).toHaveLength(paragraphs.length);
      expect(new Set(definitions.map((d) => d.abilityId)).size).toBe(paragraphs.length);
      for (const paragraph of paragraphs) {
        const definition = definitions.find((d) => d.effectText === paragraph);
        const timing = tags.get(paragraph.slice(0, paragraph.indexOf('】') + 1));
        expect(timing).toBeDefined();
        expect(definition?.implemented).toBe(true);
        expect(definition?.baseCardCodes).toContain(base);
        expect([
          definition?.category,
          definition?.sourceZone,
          definition?.triggerCondition,
        ]).toEqual(timing);
        expect(definition?.queued).toBe(timing?.[2] !== undefined);
      }
      expect(getActivatedAbilityUiConfigs(code).map((ui) => ui.text)).toEqual(
        paragraphs.filter((text) => text.startsWith('【起动】'))
      );
    }
  });
});

it.each(newPrints.filter((row) => row.cardType === CardType.MEMBER))(
  'charges the printed cost for $cardCode in RULES mode',
  (row) => expectMemberPlayAtPrintedCost(getNovember27MemberData(row.cardCode))
);

it.each(['PL!S-pb2-038', 'PL!S-pb2-039'])(
  'resolves %s from a legal face-down set through cheer, judgment and LIVE success',
  (base) => {
    const song = createCardInstance(getNovember27LiveData(base), P1, 'song');
    const member = (code: string, id: string) =>
      createCardInstance(getNovember27MemberData(code), P1, id);
    const trio = ['002', '006', '026'].map((n) => member(`PL!S-pb2-${n}`, 'stage-' + n));
    const recovery = member('PL!S-pb2-014', 'waiting-target');
    const deck = [
      member('PL!S-pb2-004', 'live-set-draw'),
      createCardInstance(getNovember27LiveData('PL!S-pb2-038'), P1, 'cheer-live'),
      member('PL!S-pb2-002', 'cheer-no-blade-1'),
      member('PL!S-pb2-021', 'cheer-no-blade-2'),
      member('PL!S-pb2-006', 'cheer-blue'),
      member('PL!S-pb2-015', 'success-draw'),
      member('PL!S-pb2-014', 'deck-tail'),
    ];
    const game = stage(hand(gameWith([song, ...trio, ...deck, recovery]), [song]), trio);
    const session = sessionFor({
      ...updatePlayer(game, P1, (p) => ({
        ...p,
        mainDeck: { ...p.mainDeck, cardIds: deck.map((c) => c.instanceId) },
        waitingRoom: { ...p.waitingRoom, cardIds: [recovery.instanceId] },
      })),
      isStarted: true,
      turnCount: 2,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
    });
    const execute = (command: GameCommand) => {
      const result = session.executeCommand(command);
      expect(result.success, result.error).toBe(true);
    };
    expect(session.manualOperationMode).toBe('RULES');
    expect(
      session.executeCommand(createSetLiveCardCommand(P1, song.instanceId, false)).success
    ).toBe(false);
    execute(createSetLiveCardCommand(P1, song.instanceId, true));
    execute(createConfirmStepCommand(P1, SubPhase.LIVE_SET_FIRST_PLAYER));
    execute(createConfirmStepCommand(P2, SubPhase.LIVE_SET_SECOND_PLAYER));
    execute(createConfirmStepCommand(P1, SubPhase.PERFORMANCE_LIVE_START_EFFECTS));
    execute(createSubmitJudgmentCommand(P1, new Map()));
    execute(createConfirmStepCommand(P1, SubPhase.PERFORMANCE_JUDGMENT));
    expect(session.state!.liveResolution.liveResults.get(song.instanceId)).toBe(true);
    expect(
      session.state!.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_LIVE_SUCCESS
      )
    ).toHaveLength(1);
    const effect = session.state!.activeEffect!;
    expect(effect.sourceCardId).toBe(song.instanceId);
    if (base === 'PL!S-pb2-039') {
      execute(createConfirmEffectStepCommand(P1, effect.id, recovery.instanceId));
      confirmPublicSelectionIfNeeded(session);
      expect(session.state!.players[0].hand.cardIds).toContain(recovery.instanceId);
    } else {
      execute(createConfirmEffectStepCommand(P1, effect.id));
    }
    expect(session.state!.players[0].hand.cardIds).toContain('success-draw');
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(4);
  }
);
