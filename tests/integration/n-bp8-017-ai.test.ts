import { describe, expect, it } from 'vitest';
import { N_BP8_017_ACTIVATED_SELF_TO_WAITING_RECOVER_LIVE_ABILITY_ID as ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getGrantedMemberBelowAbilityDefinitions } from '../../src/application/card-effects/runtime/granted-member-below-abilities';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { updatePlayer } from '../../src/domain/entities/game';
import { addEnergyBelowMember } from '../../src/domain/entities/zone';
import { SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';
import {
  P1,
  SOURCE,
  LIVE,
  TARGET,
  activateAi,
  chooseAi,
  finishAiRecovery,
  setAiState,
  setupAi,
} from '../helpers/n-bp8-ai-effects';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

const TEXT = '【起动】将此成员从舞台放置入休息室：从自己的休息室将１张LIVE卡加入手牌。';

describe('PL!N-bp8-017 费用2「宫下爱」', () => {
  it.each(['N', 'SEC', 'P+'])('%s保留独立能力ID和全角１正文，覆盖全罕度', (rarity) => {
    const definitions = getCardAbilityDefinitionsForCardCode(`PL!N-bp8-017-${rarity}`);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      abilityId: ID,
      effectText: TEXT,
      baseCardCodes: ['PL!N-bp8-017'],
      activatedUi: { text: TEXT },
    });
    expect(definitions[0].perTurnLimit).toBeUndefined();
  });

  it('原卡先付自送费用并记录离场/进入休息室，强制公开回收LIVE后续行', () => {
    const session = setupAi({ base: 'PL!N-bp8-017' });
    expect(activateAi(session, ID).success).toBe(true);
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(SOURCE);
    expect(session.state!.activeEffect).toMatchObject({
      selectableCardIds: [LIVE],
      canSkipSelection: false,
      selectionLabel: '选择要加入手牌的LIVE卡',
      confirmSelectionLabel: '加入手牌',
    });
    expect(
      session.state!.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_LEAVE_STAGE
      )
    ).toHaveLength(1);
    expect(
      session.state!.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MEMBER_SLOT &&
          event.cardInstanceIds?.includes(SOURCE)
      )
    ).toBe(true);
    const bad = session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, TARGET)
    );
    expect(bad.success).toBe(false);
    chooseAi(session, LIVE);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(LIVE);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toContain(LIVE);
    expect(session.state!.activeEffect).toBeNull();
  });

  it('无LIVE目标仍可合法自送，空结算保留费用', () => {
    const session = setupAi({ base: 'PL!N-bp8-017', live: false });
    expect(activateAi(session, ID).success).toBe(true);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(SOURCE);
    if (session.state!.activeEffect) chooseAi(session, null);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
  });

  it('LL授予自送实际宿主、下方成员入休息室、能量返能量卡组，授予随离场消失仍回收', () => {
    const session = setupAi({ base: 'PL!N-bp8-017', host: 'LL', copies: 2 });
    const instance = getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE)[0]!
      .abilityInstanceId;
    expect(activateAi(session, ID, `${instance}-fake`).success).toBe(false);
    expect(activateAi(session, ID).success).toBe(false);
    setAiState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        energyZone: {
          ...player.energyZone,
          cardIds: player.energyZone.cardIds.filter((id) => id !== 'e0'),
        },
        memberSlots: addEnergyBelowMember(player.memberSlots, SlotPosition.CENTER, 'e0'),
      }))
    );
    expect(activateAi(session, ID, instance).success).toBe(true);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([SOURCE, 'below-0', 'below-1'])
    );
    expect(session.state!.players[0].energyDeck.cardIds).toContain('e0');
    expect(getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE)).toEqual([]);
    finishAiRecovery(session, LIVE);
    expect(session.state!.players[0].hand.cardIds).toContain(LIVE);
    expect(
      session.state!.actionHistory.find(
        (action) => action.payload.abilityId === ID && action.payload.step === 'ABILITY_USE'
      )?.payload
    ).toMatchObject({ sourceCardId: SOURCE, abilityInstanceId: instance });
  });
});
