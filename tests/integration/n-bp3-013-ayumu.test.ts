import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PL_N_BP3_013_ON_ENTER_STACK_ENERGY_DRAW_TWO_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';
const P1='p1', P2='p2';
const member=(code:string):MemberCardData=>({cardCode:code,name:code,cardType:CardType.MEMBER,cost:1,blade:1,hearts:[createHeartIcon(HeartColor.PINK,1)]});
const energy=(code:string):EnergyCardData=>({cardCode:code,name:code,cardType:CardType.ENERGY});
function setup(energyCount=2):GameState {
  const cards=[createCardInstance(member('PL!N-bp3-013-N'),P1,'source'),createCardInstance(member('D1'),P1,'draw1'),createCardInstance(member('D2'),P1,'draw2'),createCardInstance(energy('EA'),P1,'active-energy'),createCardInstance(energy('EW'),P1,'waiting-energy')];
  let game=registerCards(createGameState('bp3-013',P1,'P1',P2,'P2'),cards);
  game=updatePlayer(game,P1,p=>({...p,memberSlots:placeCardInSlot(p.memberSlots,SlotPosition.CENTER,'source'),mainDeck:{...p.mainDeck,cardIds:['draw1','draw2']},energyZone:{...p.energyZone,cardIds:['active-energy','waiting-energy'].slice(0,energyCount),cardStates:new Map([['active-energy',{orientation:OrientationState.ACTIVE,face:FaceState.FACE_UP}],['waiting-energy',{orientation:OrientationState.WAITING,face:FaceState.FACE_UP}]])}}));
  return {...game,pendingAbilities:[{id:'pending',abilityId:PL_N_BP3_013_ON_ENTER_STACK_ENERGY_DRAW_TWO_ABILITY_ID,sourceCardId:'source',controllerId:P1,mandatory:true,timingId:TriggerCondition.ON_ENTER_STAGE,eventIds:['event'],sourceSlot:SlotPosition.CENTER}]};
}
const open=(game:GameState)=>resolvePendingCardEffects(game).gameState;
const choose=(game:GameState,option:string|null)=>confirmActiveEffectStep(game,P1,game.activeEffect!.id,null,null,undefined,option);
describe('PL!N-bp3-013 Ayumu',()=>{
  it('stacks the later WAITING energy and draws two without modifiers or energy-placement event',()=>{
    const done=choose(open(setup()),'stack-energy'); const p=done.players[0]!;
    expect(p.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['waiting-energy']);
    expect(p.energyZone.cardIds).toEqual(['active-energy']); expect(p.hand.cardIds).toEqual(['draw1','draw2']);
    expect(done.liveResolution.liveModifiers).toHaveLength(0);
    expect(
      done.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toBe(false);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({step:'STACK_ENERGY_BELOW_DRAW_TWO',stackedEnergyCardIds:['waiting-energy'],drawnCardIds:['draw1','draw2'],sourceSlot:SlotPosition.CENTER});
  });
  it('declines and safely no-ops when no energy is available',()=>{
    const declined=choose(open(setup()),null);
    expect(declined.players[0]!.hand.cardIds).toEqual([]); expect(declined.actionHistory.some(a=>a.type==='PAY_COST')).toBe(false);
    const empty=open(setup(0)); expect(empty.activeEffect).toBeNull(); expect(empty.pendingAbilities).toHaveLength(0);
  });
  it('keeps illegal option input unchanged',()=>{ const started=open(setup()); expect(choose(started,'illegal')).toBe(started); });
  it('safely ends when source or energy becomes stale before confirmation',()=>{
    for (const stale of [
      updatePlayer(open(setup()),P1,p=>({...p,memberSlots:removeCardFromSlot(p.memberSlots,SlotPosition.CENTER)})),
      updatePlayer(open(setup()),P1,p=>({...p,energyZone:{...p.energyZone,cardIds:[],cardStates:new Map()}})),
    ]) {
      const done=choose(stale,'stack-energy'); expect(done.activeEffect).toBeNull();
      expect(done.players[0]!.hand.cardIds).toEqual([]); expect(done.actionHistory.some(a=>a.type==='PAY_COST')).toBe(false);
    }
  });
  it('preserves ordered continuation through the real optional window',()=>{
    const base=setup(); const game={...base,pendingAbilities:[base.pendingAbilities[0]!,{...base.pendingAbilities[0]!,id:'pending-2'}]};
    const order=open(game); const started=confirmActiveEffectStep(order,P1,order.activeEffect!.id,null,null,true);
    expect(started.activeEffect?.metadata?.orderedResolution).toBe(true);
    const continued=choose(started,'stack-energy'); expect(continued.activeEffect?.id).toBe('pending-2');
    const done=choose(continued,null); expect(done.pendingAbilities).toEqual([]); expect(done.activeEffect).toBeNull();
  });
});
