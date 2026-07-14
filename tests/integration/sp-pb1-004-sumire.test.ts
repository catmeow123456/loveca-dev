import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID, SP_PB1_004_LIVE_SUCCESS_PAY_THREE_ENERGY_DRAW_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';
const P1='p1', P2='p2';
function setup(abilityId: string, active: number, deck: number, main = 1) {
  const source=createCardInstance({cardCode:'PL!SP-pb1-004-R',name:'平安名すみれ',groupNames:['Liella!'],cardType:CardType.MEMBER,cost:9,blade:1,hearts:[createHeartIcon(HeartColor.PINK,1)]},P1,'sumire');
  const energies=Array.from({length:active},(_,i)=>createCardInstance({cardCode:`E${i}`,name:`E${i}`,cardType:CardType.ENERGY},P1,`e${i}`));
  const energyDeck=Array.from({length:deck},(_,i)=>createCardInstance({cardCode:`ED${i}`,name:`ED${i}`,cardType:CardType.ENERGY},P1,`ed${i}`));
  const mains=Array.from({length:main},(_,i)=>createCardInstance({cardCode:`M${i}`,name:`M${i}`,cardType:CardType.LIVE,score:1,blade:0,hearts:[]},P1,`m${i}`));
  let game=registerCards(createGameState('004',P1,'P1',P2,'P2'),[source,...energies,...energyDeck,...mains]);
  game=updatePlayer(game,P1,p=>({...p,memberSlots:placeCardInSlot(p.memberSlots,SlotPosition.CENTER,source.instanceId,{orientation:OrientationState.ACTIVE,face:FaceState.FACE_UP}),energyZone:energies.reduce((z,c)=>addCardToStatefulZone(z,c.instanceId,{orientation:OrientationState.ACTIVE,face:FaceState.FACE_UP}),p.energyZone),energyDeck:energyDeck.reduce((z,c)=>addCardToZone(z,c.instanceId),p.energyDeck),mainDeck:mains.reduce((z,c)=>addCardToZone(z,c.instanceId),p.mainDeck)}));
  const pending:PendingAbilityState={id:'pending',abilityId,sourceCardId:source.instanceId,controllerId:P1,mandatory:true,timingId:abilityId.includes('live-start')?TriggerCondition.ON_LIVE_START:TriggerCondition.ON_LIVE_SUCCESS,eventIds:['event']};
  return {game:{...game,pendingAbilities:[pending]},energies,energyDeck,mains};
}
describe('PL!SP-pb1-004 Sumire',()=>{
  it('pays two and places one WAITING energy with placement continuation',()=>{const s=setup(SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,2,1);const started=resolvePendingCardEffects(s.game).gameState;expect(started.activeEffect?.stepText).toBe('可以支付[E][E]，放置1张待机能量。');expect(started.activeEffect?.selectableOptions).toEqual([{id:'pay',label:'支付[E][E]'}]);expect(started.players[0].energyZone.cardStates.get('e0')?.orientation).toBe(OrientationState.ACTIVE);const done=confirmActiveEffectStep(started,P1,'pending',undefined,undefined,undefined,'pay');expect(done.players[0].energyZone.cardStates.get('ed0')?.orientation).toBe(OrientationState.WAITING);expect(done.eventLog.some(x=>x.event.eventType===TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toBe(true);});
  it('declines and rejects insufficient or empty-deck prompts without changes',()=>{const s=setup(SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,2,1);const started=resolvePendingCardEffects(s.game).gameState;const declined=confirmActiveEffectStep(started,P1,'pending',null);expect(declined.players[0].energyDeck.cardIds).toEqual(['ed0']);expect(resolvePendingCardEffects(setup(SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,1,1).game).gameState.activeEffect).toBeNull();expect(resolvePendingCardEffects(setup(SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,2,0).game).gameState.activeEffect).toBeNull();});
  it('pays three then draws one; empty main deck still continues',()=>{const s=setup(SP_PB1_004_LIVE_SUCCESS_PAY_THREE_ENERGY_DRAW_ONE_ABILITY_ID,3,0,1);const started=resolvePendingCardEffects(s.game).gameState;expect(started.activeEffect?.stepText).toBe('可以支付[E][E][E]，抽1张卡。');expect(started.activeEffect?.selectableOptions).toEqual([{id:'pay',label:'支付[E][E][E]'}]);const done=confirmActiveEffectStep(started,P1,'pending',undefined,undefined,undefined,'pay');expect(done.players[0].hand.cardIds).toEqual(['m0']);const empty=setup(SP_PB1_004_LIVE_SUCCESS_PAY_THREE_ENERGY_DRAW_ONE_ABILITY_ID,3,0,0);const emptyDone=confirmActiveEffectStep(resolvePendingCardEffects(empty.game).gameState,P1,'pending',undefined,undefined,undefined,'pay');expect(emptyDone.activeEffect).toBeNull();expect(emptyDone.pendingAbilities).toEqual([]);});
  it('does not advance an illegal option',()=>{const started=resolvePendingCardEffects(setup(SP_PB1_004_LIVE_SUCCESS_PAY_THREE_ENERGY_DRAW_ONE_ABILITY_ID,3,1).game).gameState;const beforeEnergyIds=[...started.players[0].energyZone.cardIds];const beforeEnergyDeckIds=[...started.players[0].energyDeck.cardIds];const beforeHandIds=[...started.players[0].hand.cardIds];const stale=confirmActiveEffectStep(started,P1,'pending',undefined,undefined,undefined,'bogus');expect(stale.activeEffect).toEqual(started.activeEffect);expect(stale.pendingAbilities).toEqual(started.pendingAbilities);expect(stale.players[0].energyZone.cardIds).toEqual(beforeEnergyIds);expect(stale.players[0].energyZone.cardStates).toEqual(started.players[0].energyZone.cardStates);expect(stale.players[0].energyDeck.cardIds).toEqual(beforeEnergyDeckIds);expect(stale.players[0].hand.cardIds).toEqual(beforeHandIds);});
  it('opens common exact payment selection when candidates exceed the cost and a special energy exists',()=>{
    const scenario=setup(SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,3,1);
    const marked={...scenario.game,energyActivePhaseSkips:[{playerId:P1,energyCardId:'e2',sourceCardId:'marker-source',abilityId:'marker-ability'}]};
    const started=resolvePendingCardEffects(marked).gameState;
    const selecting=confirmActiveEffectStep(started,P1,'pending',undefined,undefined,undefined,'pay');
    expect(selecting.activeEffect).toMatchObject({stepId:'COMMON_ENERGY_OPERATION_SELECTION',stepText:'请选择用于支付[E][E]的活跃能量卡。',selectionLabel:'选择用于支付费用的能量卡',confirmSelectionLabel:'支付费用',minSelectableCards:2,maxSelectableCards:2,selectableCardIds:['e0','e1','e2']});
    expect(['e0','e1','e2'].map(id=>selecting.players[0].energyZone.cardStates.get(id)?.orientation)).toEqual(Array(3).fill(OrientationState.ACTIVE));
    const done=confirmActiveEffectStep(selecting,P1,'pending',undefined,undefined,undefined,undefined,['e0','e2']);
    expect(done.players[0].energyZone.cardStates.get('e0')?.orientation).toBe(OrientationState.WAITING);
    expect(done.players[0].energyZone.cardStates.get('e1')?.orientation).toBe(OrientationState.ACTIVE);
    expect(done.players[0].energyZone.cardStates.get('e2')?.orientation).toBe(OrientationState.WAITING);
    expect(done.players[0].energyZone.cardStates.get('ed0')?.orientation).toBe(OrientationState.WAITING);
  });
  it('automatically pays when candidates exceed the cost but no special energy exists',()=>{
    const scenario=setup(SP_PB1_004_LIVE_SUCCESS_PAY_THREE_ENERGY_DRAW_ONE_ABILITY_ID,4,0,1);
    const started=resolvePendingCardEffects(scenario.game).gameState;
    const done=confirmActiveEffectStep(started,P1,'pending',undefined,undefined,undefined,'pay');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].hand.cardIds).toEqual(['m0']);
    expect(['e0','e1','e2'].map(id=>done.players[0].energyZone.cardStates.get(id)?.orientation)).toEqual(Array(3).fill(OrientationState.WAITING));
    expect(done.players[0].energyZone.cardStates.get('e3')?.orientation).toBe(OrientationState.ACTIVE);
  });
});
