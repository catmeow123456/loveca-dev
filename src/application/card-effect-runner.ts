import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../shared/types/enums.js';
import { isMemberCardData, type CardInstance } from '../domain/entities/card.js';
import type { GameState, PendingAbilityState } from '../domain/entities/game.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  updatePlayer,
} from '../domain/entities/game.js';
import { addLiveModifier, isLiveAbilitySuppressed } from '../domain/rules/live-modifiers.js';
import { collectCurrentRevealedCheerLiveSuccessAbilitySources } from './card-effects/runtime/live-success-revealed-cheer-sources.js';
import { removeTargetMemberBoundLiveModifiersForLeaveStageEvents } from './card-effects/runtime/target-member-bound-live-modifiers.js';
import { getZoneSelectionConfig } from './effects/zone-selection.js';
import {
  getRenGrantedActivatedAbilityUiConfig,
  isRenGrantedActivatedAbility,
} from './card-effects/runtime/granted-activated-abilities.js';
import {
  and,
  costGte,
  costLte,
  groupAliasIs,
  hasBladeHeart as hasBladeHeartSelector,
  memberPrintedBladeLte,
  normalizeCardName,
  not,
  or,
  typeIs,
  unitAliasIs,
} from './effects/card-selectors.js';
import {
  countCardsMatchingSelector,
  countStageMembers,
  getMemberEntryOrdinalForEvent,
  hasStageMemberMatching,
} from './effects/conditions.js';
import {
  drawCardsForPlayer,
  recoverCardsFromWaitingRoomToHandForPlayer,
} from './card-effects/runtime/actions.js';
import {
  finishConfirmOnlyPendingAbilityEffect,
  startConfirmOnlyPendingAbilityEffect,
} from './card-effects/runtime/active-effect.js';
import { resolveActivatedAbilityWithRegistry } from './card-effects/runtime/activated-registry.js';
import { isLiveSuccessAbilityAvailable } from './card-effects/runtime/live-success-ability-availability-gates.js';
import { isLiveStartAbilitySuppressed } from './card-effects/runtime/live-start-suppression-gates.js';
import {
  enqueueEnterHandCardEffects,
  enqueueEnterLiveZoneCardEffects,
  enqueueUntriggeredEnterHandAndLiveZoneCardEffects,
  getEnterHandEventsFromLog,
  getEnterLiveZoneEventsFromLog,
  getLatestEnterHandEventsFromLog,
  getLatestEnterLiveZoneEventsFromLog,
} from './card-effects/runtime/enter-card-zone-triggers.js';
import { enqueueMemberSlotMovedObserverCardEffects } from './card-effects/runtime/member-slot-moved-observers.js';
import { enqueueResolvedAbilityObserverCardEffects } from './card-effects/runtime/resolved-ability-observers.js';
import { resolvePendingAbilityStarterWithRegistry } from './card-effects/runtime/starter-registry.js';
import { resolveActiveEffectStepWithRegistry } from './card-effects/runtime/step-registry.js';
import { enqueueEnergyMovedToDeckCardEffects, getLatestEnergyMovedToDeckEvents } from './card-effects/runtime/energy-moved-to-deck-triggers.js';
import { hasAbilityInstance } from './card-effects/runtime/ability-instance.js';
import {
  advanceCheckTimingIteration,
  closeCheckTimingContextIfIdle,
  getCheckTimingAbilityCandidates,
  openCheckTimingContext,
  processCheckTimingRuleActions,
} from './card-effects/runtime/check-timing-scheduler.js';
import { registerBp5003KotoriWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-003-kotori.js';
import { registerBp5004UmiWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-004-umi.js';
import { registerWaitSelfOpponentWaitWorkflowHandlers } from './card-effects/workflows/shared/wait-self-opponent-wait.js';
import { registerActivateOwnStageMemberWorkflowHandlers } from './card-effects/workflows/shared/activate-own-stage-member.js';
import { registerOnLeaveActivateStageMemberWorkflowHandlers } from './card-effects/workflows/shared/on-leave-activate-stage-member.js';
import { registerPrOnEnterChooseDrawDiscardOrWaitOpponentLowCostWorkflowHandlers } from './card-effects/workflows/shared/on-enter-choose-draw-discard-or-wait-opponent-low-cost.js';
import { registerPlPr014UmiWorkflowHandlers } from './card-effects/workflows/cards/pl-pr-014-umi.js';
import { registerSBp3021OmoiYoHitotsuNiNareWorkflowHandlers } from './card-effects/workflows/cards/s-bp3-021-omoi-yo-hitotsu-ni-nare.js';
import { registerSBp3024DeepResonanceWorkflowHandlers } from './card-effects/workflows/cards/s-bp3-024-deep-resonance.js';
import { registerNBp3001AyumuWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-001-ayumu.js';
import { registerNBp3003ShizukuWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-003-shizuku.js';
import { registerSpBp2006KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-006-kinako.js';
import { registerNBp3004KarinWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-004-karin.js';
import { registerNBp3005AiWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-005-ai.js';
import { registerNBp3006KanataWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-006-kanata.js';
import { registerNBp3007SetsunaWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-007-setsuna.js';
import { registerNBp3011MiaTaylorWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-011-mia-taylor.js';
import { registerNBp3013AyumuWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-013-ayumu.js';
import { registerBp5007NozomiWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-007-nozomi.js';
import { registerBp5005RinWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-005-rin.js';
import { registerBp5006MakiWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-006-maki.js';
import { registerBp5001HonokaWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-001-honoka.js';
import { registerBp5021SunnyDaySongWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-021-sunny-day-song.js';
import { registerLlBp5001LiveWithASmileWorkflowHandlers } from './card-effects/workflows/cards/ll-bp5-001-live-with-a-smile.js';
import { registerLlBp5002BringTheLoveWorkflowHandlers } from './card-effects/workflows/cards/ll-bp5-002-bring-the-love.js';
import { registerBp5009NicoWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-009-nico.js';
import { registerBp5010HonokaWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-010-honoka.js';
import { registerBp5024PrivateWarsWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-024-private-wars.js';
import { registerBp5111TsubasaWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-111-tsubasa.js';
import { registerBp5333ErenaWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-333-erena.js';
import { registerBp6003KotoriWorkflowHandlers } from './card-effects/workflows/cards/pl-bp6-003-kotori.js';
import { registerBp6020DancingStarsWorkflowHandlers } from './card-effects/workflows/cards/pl-bp6-020-dancing-stars-on-me.js';
import { registerCheerRerollWorkflowHandlers } from './card-effects/workflows/shared/cheer-reroll.js';
import { registerSBp3019MiracleWaveWorkflowHandlers } from './card-effects/workflows/cards/s-bp3-019-miracle-wave.js';
import { registerSBp2008MariWorkflowHandlers } from './card-effects/workflows/cards/s-bp2-008-mari.js';
import { registerBp6024SuccessReplacementWorkflowHandlers } from './card-effects/workflows/cards/pl-bp6-024-sakkaku-crossroads.js';
import { registerHsBp1008KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-bp1-008-kosuzu.js';
import { registerPlayWaitingRoomMemberToSourceSlotWorkflowHandlers } from './card-effects/workflows/shared/play-waiting-room-member-to-source-slot.js';
import { registerHsBp1022AwokeWorkflowHandlers } from './card-effects/workflows/cards/hs-bp1-022-awoke.js';
import { registerHsBp1023DododoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp1-023-dododo.js';
import { registerHsBp2014RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp2-014-rurino.js';
import { registerHsBp6031FanfareWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-031-fanfare.js';
import { registerHsBp6004GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-004-ginko.js';
import { registerHsBp6005KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-005-kosuzu.js';
import { registerHsBp6006HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-006-hime.js';
import { registerHsBp6007SerasWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-007-seras.js';
import { registerHsBp6008IzumiWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-008-izumi.js';
import { registerHsBp6010SayakaWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-010-sayaka.js';
import { registerHsBp6012GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-012-ginko.js';
import { registerHsBp6014HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-014-hime.js';
import { registerHsBp6015SerasWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-015-seras.js';
import { registerHsBp6016IzumiWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-016-izumi.js';
import { registerHsBp6018SayakaWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-018-sayaka.js';
import { registerHsBp6025TsubasaLaLiberteWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-025-tsubasa-la-liberte.js';
import { registerHsBp6029ProofWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-029-proof.js';
import { registerHsBp6003RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-003-rurino.js';
import { registerSFutureWaterBatch2LiveStartWorkflowHandlers } from './card-effects/workflows/shared/aqours-live-start-effects.js';
import { registerSFutureWaterBatch3WorkflowHandlers } from './card-effects/workflows/shared/aqours-live-start-success-effects.js';
import { registerAqoursHeartScoreBonusesWorkflowHandlers } from './card-effects/workflows/shared/aqours-heart-score-bonuses.js';
import { registerSFutureWaterFinalWorkflowHandlers } from './card-effects/workflows/cards/s-bp6-002-riko.js';
import { registerHsBp5003RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-003-rurino.js';
import { registerHsBp5002SayakaWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-002-sayaka.js';
import { registerHsBp5005KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-005-kosuzu.js';
import { registerHsBp5006HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-006-hime.js';
import { registerHsBp5007SerasWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-007-seras.js';
import { registerHsBp5016IzumiWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-016-izumi.js';
import { registerHsBp5017DreamBelieversWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-017-dream-believers.js';
import { registerHsBp5001KahoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-001-kaho.js';
import { registerHsBp5021JoshoKiryuWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-021-josho-kiryu.js';
import { registerHsBp5022RetrofutureWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-022-retrofuture.js';
import { registerWaitDiscardLookTopSelectToHandWorkflowHandlers } from './card-effects/workflows/shared/wait-discard-look-top-select-to-hand.js';
import { registerHsPb1004GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-004-ginko.js';
import { registerHsPb1002SayakaWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-002-sayaka.js';
import { registerHsPb1012GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-012-ginko.js';
import { registerHsPb1001KahoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-001-kaho.js';
import { registerHsPb1009KahoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-009-kaho.js';
import { registerHsPb1007SerasWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-007-seras.js';
import { registerHsPb1008IzumiWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-008-izumi.js';
import { registerHsPb1016IzumiWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-016-izumi.js';
import { registerHsPb1006HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-006-hime.js';
import { registerHsPb1014HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-014-hime.js';
import { registerHsPb1021KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-021-kosuzu.js';
import { registerHsPb1005KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-005-kosuzu.js';
import { registerHsPb1013KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-013-kosuzu.js';
import { registerHsPb1025DakishimeruHanabiraWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-025-dakishimeru-hanabira.js';
import { registerHsPb1029ZenhouiKyunWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-029-zenhoui-kyun.js';
import { registerHsPr028EchoesBeyondWorkflowHandlers } from './card-effects/workflows/cards/hs-pr-028-echoes-beyond.js';
import { registerHsPr035GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-pr-035-ginko.js';
import { registerHsPb1030EdeliedWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-030-edelied.js';
import { registerHsPb1028CompassWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-028-compass.js';
import { registerHsPb1003RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-003-rurino.js';
import { registerDiscardThenDrawWorkflowHandlers } from './card-effects/workflows/shared/discard-then-draw.js';
import { registerActivatedPayEnergyDrawWorkflowHandlers } from './card-effects/workflows/shared/activated-pay-energy-draw.js';
import { registerHsCl1001KahoWorkflowHandlers } from './card-effects/workflows/cards/hs-cl1-001-kaho.js';
import { registerHsCl1002SayakaWorkflowHandlers } from './card-effects/workflows/cards/hs-cl1-002-sayaka.js';
import { registerHsCl1003RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-cl1-003-rurino.js';
import { registerHsCl1004GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-cl1-004-ginko.js';
import { registerHsCl1010AwokeWorkflowHandlers } from './card-effects/workflows/cards/hs-cl1-010-awoke.js';
import { registerHsCl1011DododoWorkflowHandlers } from './card-effects/workflows/cards/hs-cl1-011-dododo.js';
import { registerKekeOnEnterPlaceWaitingEnergyWorkflowHandlers } from './card-effects/workflows/shared/on-enter-discard-place-waiting-energy.js';
import { registerOnEnterSourceMemberGainBladeWorkflowHandlers } from './card-effects/workflows/shared/on-enter-source-member-gain-blade.js';
import { registerMakiOnEnterWorkflowHandlers } from './card-effects/workflows/cards/pl-sd1-006-maki.js';
import { registerKarinWorkflowHandlers } from './card-effects/workflows/cards/n-pb1-004-karin.js';
import { registerNBp1002KasumiWorkflowHandlers } from './card-effects/workflows/cards/n-bp1-002-kasumi.js';
import { registerNLiveStartScoreBonusesWorkflowHandlers } from './card-effects/workflows/shared/live-start-score-bonuses.js';
import { registerNLiveSuccessCheerAllBladeScoreWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-030-love-u-my-friends.js';
import { registerNBp3031MonsterGirlsWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-031-monster-girls.js';
import { registerNBp5001AyumuWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-001-ayumu.js';
import { registerNBp5005AiWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-005-ai.js';
import { registerNBp5006KanataWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-006-kanata.js';
import { registerNBp5008EmmaVerdeWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-008-emma-verde.js';
import { registerNBp5010ShiorikoWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-010-shioriko.js';
import { registerNBp5011MiaTaylorWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-011-mia-taylor.js';
import { registerNBp5012LanzhuWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-012-lanzhu.js';
import { registerNBp5013AyumuWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-013-ayumu.js';
import { registerNBp5014KasumiWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-014-kasumi.js';
import { registerNBp5026TokimekiRunnersWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-026-tokimeki-runners.js';
import { registerNBp5028ChaseWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-028-chase.js';
import { registerNBp5029MutekikyuBelieverWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-029-mutekikyu-believer.js';
import { registerNBp5015ShizukuWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-015-shizuku.js';
import { registerNBp5030RyouranVictoryRoadWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-030-ryouran-victory-road.js';
import { registerNBp1026PoppinUpWorkflowHandlers } from './card-effects/workflows/cards/n-bp1-026-poppin-up.js';
import { registerNBp3008EmmaWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-008-emma.js';
import { registerNBp3010ShiorikoWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-010-shioriko.js';
import { registerNBp3009RinaWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-009-rina.js';
import { registerNBp3025AwakeningPromiseWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-025-awakening-promise.js';
import { registerNBp3027LaBellaPatriaWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-027-la-bella-patria.js';
import { registerNBp4004KarinWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-004-karin.js';
import { registerNBp4001AyumuWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-001-ayumu.js';
import { registerNBp4002KasumiWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-002-kasumi.js';
import { registerLiveSuccessConditionalDrawOneWorkflowHandlers } from './card-effects/workflows/shared/live-success-conditional-draw-one.js';
import { registerNBp4009RinaWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-009-rina.js';
import { registerNBp4005AiWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-005-ai.js';
import { registerNBp4006KanataWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-006-kanata.js';
import { registerNBp4007SetsunaWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-007-setsuna.js';
import { registerNBp4008EmmaWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-008-emma.js';
import { registerNBp4010ShiorikoWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-010-shioriko.js';
import { registerNBp4011MiaTaylorWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-011-mia-taylor.js';
import { registerOnEnterWaitingRoomCardToDeckTopWorkflowHandlers } from './card-effects/workflows/shared/on-enter-waiting-room-card-to-deck-top.js';
import { registerNBp4023MiaTaylorWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-023-mia-taylor.js';
import { registerNBp4025VividWorldWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-025-vivid-world.js';
import { registerNBp4026DiveWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-026-dive.js';
import { registerNBp4027EmotionWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-027-emotion.js';
import { registerNBp4029RiseUpHighWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-029-rise-up-high.js';
import { registerSBp2025AozoraJumpingHeartWorkflowHandlers } from './card-effects/workflows/cards/s-bp2-025-aozora-jumping-heart.js';
import { registerSBp2007HanamaruWorkflowHandlers } from './card-effects/workflows/cards/s-bp2-007-hanamaru.js';
import { registerNBp4030DaydreamMermaidWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-030-daydream-mermaid.js';
import { registerNBp4031NeoSkyNeoMapWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-031-neo-sky-neo-map.js';
import { registerNDiscardRecoverAndBladeWorkflowHandlers } from './card-effects/workflows/shared/discard-cost-recover-live-or-gain-blade.js';
import { registerNBp5003ShizukuWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-003-shizuku.js';
import { registerNBp5021RinaWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-021-rina.js';
import { registerNPb1006KanataWorkflowHandlers } from './card-effects/workflows/cards/n-pb1-006-kanata.js';
import { registerNPb1011MiaWorkflowHandlers } from './card-effects/workflows/cards/n-pb1-011-mia.js';
import { registerLiveSuccessDiscardRecoverLowCostOrScoreCheerWorkflowHandlers } from './card-effects/workflows/shared/live-success-discard-recover-low-cost-or-score-cheer.js';
import { registerNPr026RinaWorkflowHandlers } from './card-effects/workflows/cards/n-pr-026-rina.js';
import { registerNozomiOnEnterWorkflowHandlers } from './card-effects/workflows/cards/pl-sd1-007-nozomi.js';
import { registerPb1015MakiWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-015-maki.js';
import { registerPlPb1001HonokaWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-001-honoka.js';
import { registerPlPb1002EliWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-002-eli.js';
import { registerPlPb1003KotoriWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-003-kotori.js';
import { registerPlPb1004UmiWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-004-umi.js';
import { registerPlPb1008HanayoWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-008-hanayo.js';
import { registerPlPb1009NicoWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-009-nico.js';
import { registerPlPb1017HanayoWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-017-hanayo.js';
import { registerPlPb1006MakiWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-006-maki.js';
import { registerPlPb1007NozomiWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-007-nozomi.js';
import { registerPlPb1010HonokaWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-010-honoka.js';
import { registerPlPb1012KotoriWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-012-kotori.js';
import { registerPlPb1013UmiWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-013-umi.js';
import { registerPlPb1028WaoWaoPowerfulDayWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-028-wao-wao-powerful-day.js';
import { registerPlPb1030CutiePantherWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-030-cutie-panther.js';
import { registerPlPb1031KaguyaNoShiroDeOdoritaiWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-031-kaguya-no-shiro-de-odoritai.js';
import { registerPlBp3026OhLovePeaceWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-026-oh-love-peace.js';
import { registerPlPb1018NicoWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-018-nico.js';
import { registerSd1008HanayoWorkflowHandlers } from './card-effects/workflows/cards/pl-sd1-008-hanayo.js';
import { registerSPb1002RikoWorkflowHandlers } from './card-effects/workflows/cards/s-pb1-002-riko.js';
import { registerSPb1003KananWorkflowHandlers } from './card-effects/workflows/cards/s-pb1-003-kanan.js';
import { registerSPb1019GenkiZenkaiDayDayDayWorkflowHandlers } from './card-effects/workflows/cards/s-pb1-019-genki-zenkai-day-day-day.js';
import { registerSPb1022MobiusLoopWorkflowHandlers } from './card-effects/workflows/cards/s-pb1-022-mobius-loop.js';
import {
  isHsSd1001HighCostHasunosoraRelayReplacement,
  registerHsSd1001KahoWorkflowHandlers,
} from './card-effects/workflows/cards/hs-sd1-001-kaho.js';
import { registerHsSd1002SayakaWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-002-sayaka.js';
import { registerHsSd1003RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-003-rurino.js';
import { registerHsBp6011RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-011-rurino.js';
import { registerHsBp2005RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp2-005-rurino.js';
import { registerHsBp2003KozueWorkflowHandlers } from './card-effects/workflows/cards/hs-bp2-003-kozue.js';
import { registerHsBp2007GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp2-007-ginko.js';
import { registerHsBp2008KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-bp2-008-kosuzu.js';
import { registerHsBp2009HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-bp2-009-hime.js';
import { registerHsBp2018HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-bp2-018-hime.js';
import { registerHsBp2019BloomTheSmileBloomTheDreamWorkflowHandlers } from './card-effects/workflows/cards/hs-bp2-019-bloom-the-smile-bloom-the-dream.js';
import { registerHsSd1004GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-004-ginko.js';
import { registerHsSd1005KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-005-kosuzu.js';
import { registerHsSd1006HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-006-hime.js';
import { registerHsSd1008IzumiWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-008-izumi.js';
import { registerHsSd1020LinkToTheFutureWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-020-link-to-the-future.js';
import { registerEmmaWorkflowHandlers } from './card-effects/workflows/cards/n-pb1-008-emma.js';
import { registerSpPb1001KanonWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-001-kanon.js';
import { registerLlBp6001KotoriDiaKosuzuWorkflowHandlers } from './card-effects/workflows/cards/ll-bp6-001-kotori-dia-kosuzu.js';
import { registerPlBp3001HonokaWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-001-honoka.js';
import { registerPlBp3022YumeNoTobiraWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-022-yume-no-tobira.js';
import { registerNBp3028TsunagaruConnectWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-028-tsunagaru-connect.js';
import { registerPlBp3002EliWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-002-eli.js';
import { registerPlBp3003KotoriWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-003-kotori.js';
import { registerPlBp3004UmiWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-004-umi.js';
import { registerPlBp3005RinWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-005-rin.js';
import { registerPlBp3007NozomiWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-007-nozomi.js';
import { registerPlBp3008HanayoWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-008-hanayo.js';
import { registerPlBp3009NicoWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-009-nico.js';
import { registerPlBp3024NatsuiroEgaoWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-024-natsuiro-egao-de-1-2-jump.js';
import { registerPlBp3025TakaramonozuWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-025-takaramonozu.js';
import { registerPlBp3006MakiWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-006-maki.js';
import { registerPlBp4017HanayoWorkflowHandlers } from './card-effects/workflows/cards/pl-bp4-017-hanayo.js';
import { registerPlBp4005RinWorkflowHandlers } from './card-effects/workflows/cards/pl-bp4-005-rin.js';
import { registerPlBp4009NicoWorkflowHandlers } from './card-effects/workflows/cards/pl-bp4-009-nico.js';
import { registerPlBp6001HonokaWorkflowHandlers } from './card-effects/workflows/cards/pl-bp6-001-honoka.js';
import { registerPlBp6006MakiWorkflowHandlers } from './card-effects/workflows/cards/pl-bp6-006-maki.js';
import { registerPlBp6008And010ActivatedStateWorkflowHandlers } from './card-effects/workflows/shared/activated-stage-member-state-change.js';
import { registerPlBp6013And023SuccessZoneWorkflowHandlers } from './card-effects/workflows/shared/success-zone-conditional-recovery-draw.js';
import { registerPlBp6021WonderfulRushWorkflowHandlers } from './card-effects/workflows/cards/pl-bp6-021-wonderful-rush.js';
import { registerPlBp6007NozomiWorkflowHandlers } from './card-effects/workflows/cards/pl-bp6-007-nozomi.js';
import { registerPlBp3014RinWorkflowHandlers } from './card-effects/workflows/shared/on-enter-wait-look-top-two-arrange.js';
import { registerSBp3007HanamaruWorkflowHandlers } from './card-effects/workflows/cards/s-bp3-007-hanamaru.js';
import { registerSBp3001ChikaWorkflowHandlers } from './card-effects/workflows/cards/s-bp3-001-chika.js';
import { registerSBp3002RikoWorkflowHandlers } from './card-effects/workflows/cards/s-bp3-002-riko.js';
import { registerNBp5007SetsunaWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-007-setsuna.js';
import { registerSBp2024KimikokoWorkflowHandlers } from './card-effects/workflows/cards/s-bp2-024-kimikoko.js';
import { registerSBp5020LandingActionYeahWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-020-landing-action-yeah.js';
import { registerSBp5023AwakenThePowerWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-023-awaken-the-power.js';
import { registerSBp5111SeiraWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-111-seira.js';
import { registerSBp5222RiaWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-222-ria.js';
import { registerSpBp2003ChisatoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-003-chisato.js';
import { registerSpBp2005RenWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-005-ren.js';
import { registerSpBp2009NatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-009-natsumi.js';
import { registerSpBp2010MargareteWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-010-margarete.js';
import { registerSpBp2011TomariWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-011-tomari.js';
import { registerSpBp1024TinyStarsWorkflowHandlers } from './card-effects/workflows/cards/sp-bp1-024-tiny-stars.js';
import { registerSpBp2001KanonWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-001-kanon.js';
import { registerSpBp2024VitaminSummerWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-024-vitamin-summer.js';
import { registerSpBp4001KanonWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-001-kanon.js';
import { registerSpBp4004SumireWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-004-sumire.js';
import { registerSpBp4006KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-006-kinako.js';
import { registerSpBp4007MeiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-007-mei.js';
import { registerSpBp4016RenWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-016-ren.js';
import { registerStageMemberWaitingEnergyPlacementWorkflowHandlers } from './card-effects/workflows/shared/stage-member-waiting-energy-placement.js';
import { registerSpBp4023DazzlingGameWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-023-dazzling-game.js';
import { registerSpBp4024NonfictionWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-024-nonfiction.js';
import { registerSpBp4025SpecialColorWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-025-special-color.js';
import { registerSpBp4026WishSongWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-026-wish-song.js';
import { registerShikiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-008-shiki.js';
import { registerSpBp5001KanonWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-001-kanon.js';
import { registerSpBp5004SumireWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-004-sumire.js';
import { registerSpBp7005RenWorkflowHandlers } from './card-effects/workflows/cards/sp-bp7-005-ren.js';
import { registerSpBp7006KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp7-006-kinako.js';
import { registerSpBp7007MeiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp7-007-mei.js';
import { registerSpBp5005RenWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-005-ren.js';
import { registerSpBp5009NatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-009-natsumi.js';
import { registerSpBp5010MargareteWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-010-margarete.js';
import { registerSpBp5007MeiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-007-mei.js';
import { registerSpBp5013KekeWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-013-keke.js';
import { registerSpBp5014ChisatoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-014-chisato.js';
import { registerSpBp5015SumireWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-015-sumire.js';
import { registerSpBp5020NatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-020-natsumi.js';
import { registerSpBp5023ShootingVoiceWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-023-shooting-voice.js';
import { registerSpBp5024MiracleNewStoryWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-024-miracle-new-story.js';
import { registerSpBp5025TokonatsuSunshineWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-025-tokonatsu-sunshine.js';
import { registerSpBp5026LetsBeOneWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-026-lets-be-one.js';
import { registerSpBp5027HotPassionWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-027-hot-passion.js';
import { registerSpBp5111MaoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-111-mao.js';
import { registerSpBp5222YuunaWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-222-yuuna.js';
import { registerSpBp5002KekeWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-002-keke.js';
import { registerSpBp5006KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-006-kinako.js';
import { registerSpPb1003ChisatoWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-003-chisato.js';
import { registerSpPb1004SumireWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-004-sumire.js';
import { registerSpPb1005RenWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-005-ren.js';
import { registerSpPb1006KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-006-kinako.js';
import { registerSpPb1007MeiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-007-mei.js';
import { registerSpPb1008ShikiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-008-shiki.js';
import { registerSpPb1011TomariWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-011-tomari.js';
import { registerSpPb1020NatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-020-natsumi.js';
import { registerSpPb1023DistortionWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-023-distortion.js';
import { registerSpPb1025JellyfishWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-025-jellyfish.js';
import { registerSpPb2001KanonWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-001-kanon.js';
import { registerSpPb2006KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-006-kinako.js';
import { registerSpPb2009NatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-009-natsumi.js';
import { registerSpPb2010MargareteWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-010-margarete.js';
import { registerSpPb2011TomariWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-011-tomari.js';
import { registerSpPb2013KekeWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-013-keke.js';
import { registerSpPb2018MeiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-018-mei.js';
import { registerSpPb2020NatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-020-natsumi.js';
import { registerSpPb2022TomariWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-022-tomari.js';
import { registerSpPb2028KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-028-kinako.js';
import { registerSpPb2002KekeWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-002-keke.js';
import { registerSpPb2003ChisatoWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-003-chisato.js';
import { registerSpPb2004SumireWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-004-sumire.js';
import { registerSpPb2005RenWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-005-ren.js';
import { registerSpPb2007MeiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-007-mei.js';
import { registerSpPb2008ShikiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-008-shiki.js';
import { registerSpPr018KanonWorkflowHandlers } from './card-effects/workflows/cards/sp-pr-018-kanon.js';
import { registerLowCostRelayPlayHandMemberWorkflowHandlers } from './card-effects/workflows/shared/low-cost-relay-play-hand-member.js';
import { registerSpPr024SumireWorkflowHandlers } from './card-effects/workflows/cards/sp-pr-024-sumire.js';
import { registerSpPb2000ChisatoNatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-000-chisato-natsumi.js';
import { registerSpPb2045ZettaiLoverWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-045-zettai-lover.js';
import { registerSpPb2046ButterflyWingWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-046-butterfly-wing.js';
import { registerSpPb2047WelcomeToBokuraNoSekaiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-047-welcome-to-bokura-no-sekai.js';
import { registerSpPb2048DistortionWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-048-distortion.js';
import { registerSpPb2049NeutralWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-049-neutral.js';
import { registerChisatoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-003-chisato.js';
import { registerSpBp4MovedSideBladeWorkflowHandlers } from './card-effects/workflows/shared/moved-side-blade.js';
import { registerSpSd2003ChisatoWorkflowHandlers } from './card-effects/workflows/cards/sp-sd2-003-chisato.js';
import { registerSpSd2006KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-sd2-006-kinako.js';
import { registerSpSd2020NatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-sd2-020-natsumi.js';
import { registerSpSd2023HajimariWaKimiNoSoraWorkflowHandlers } from './card-effects/workflows/cards/sp-sd2-023-hajimari-wa-kimi-no-sora.js';
import { registerSpSd2025AspireWorkflowHandlers } from './card-effects/workflows/cards/sp-sd2-025-aspire.js';
import { registerYoshikoPlayLowCostMembersWorkflowHandlers } from './card-effects/workflows/cards/s-bp2-006-yoshiko.js';
import { registerSBp3006YoshikoWorkflowHandlers } from './card-effects/workflows/cards/s-bp3-006-yoshiko.js';
import { registerSBp5001ChikaWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-001-chika.js';
import { registerSBp5002RikoWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-002-riko.js';
import { registerSBp5003KananWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-003-kanan.js';
import { registerSBp5004DiaWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-004-dia.js';
import { registerSBp5005YouWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-005-you.js';
import { registerSBp5009RubyWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-009-ruby.js';
import { registerSBp5016HanamaruWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-016-hanamaru.js';
import { registerSBp5017MariWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-017-mari.js';
import { registerSBp5019NotAloneNotHitoriWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-019-not-alone-not-hitori.js';
import { registerSBp5022SelfControlWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-022-self-control.js';
import { registerOnCheerLiveCountGainHeartWorkflowHandlers } from './card-effects/workflows/shared/on-cheer-live-count-gain-heart.js';
import { registerOnCheerNoBladeHeartGainHeartWorkflowHandlers } from './card-effects/workflows/shared/on-cheer-no-blade-heart-gain-heart.js';
import { registerOnCheerSameGroupMemberTripleGainHeartsWorkflowHandlers } from './card-effects/workflows/shared/on-cheer-same-group-member-triple-gain-hearts.js';
import { registerSSd1004DiaWorkflowHandlers } from './card-effects/workflows/cards/s-sd1-004-dia.js';
import { registerSSd1005YouWorkflowHandlers } from './card-effects/workflows/cards/s-sd1-005-you.js';
import { registerSSd1006YoshikoWorkflowHandlers } from './card-effects/workflows/cards/s-sd1-006-yoshiko.js';
import { registerSSd1020JimoAiDashWorkflowHandlers } from './card-effects/workflows/cards/s-sd1-020-jimo-ai-dash.js';
import { registerSPb1006YoshikoWorkflowHandlers } from './card-effects/workflows/cards/s-pb1-006-yoshiko.js';
import { registerSBp6001ChikaWorkflowHandlers } from './card-effects/workflows/cards/s-bp6-001-chika.js';
import { registerSBp6003KananWorkflowHandlers } from './card-effects/workflows/cards/s-bp6-003-kanan.js';
import { registerSBp6006YoshikoWorkflowHandlers } from './card-effects/workflows/cards/s-bp6-006-yoshiko.js';
import { registerSBp6007HanamaruWorkflowHandlers } from './card-effects/workflows/cards/s-bp6-007-hanamaru.js';
import { registerSBp6011RikoWorkflowHandlers } from './card-effects/workflows/cards/s-bp6-011-riko.js';
import { registerSBp6016HanamaruWorkflowHandlers } from './card-effects/workflows/cards/s-bp6-016-hanamaru.js';
import { registerArrangeInspectedDeckTopWorkflowHandlers } from './card-effects/workflows/shared/arrange-inspected-deck-top.js';
import { registerConditionalLiveModifierWorkflowHandlers } from './card-effects/workflows/shared/conditional-live-modifier.js';
import { registerDiscardCostWaitingRoomToHandWorkflowHandlers } from './card-effects/workflows/shared/discard-cost-waiting-room-to-hand.js';
import { registerDiscardLookTopSelectToHandWorkflowHandlers } from './card-effects/workflows/shared/discard-look-top-select-to-hand.js';
import { registerDirectMillTopWorkflowHandlers } from './card-effects/workflows/shared/direct-mill-top.js';
import { registerDrawThenDiscardWorkflowHandlers } from './card-effects/workflows/shared/draw-then-discard.js';
import { registerGroupedRecoveryWorkflowHandlers } from './card-effects/workflows/shared/grouped-recovery.js';
import { registerLookTopSelectToHandWorkflowHandlers } from './card-effects/workflows/shared/look-top-select-to-hand.js';
import { registerActivatedPayEnergySelfPositionChangeWorkflowHandlers } from './card-effects/workflows/shared/activated-pay-energy-self-position-change.js';
import { registerActivatedWaitSelfDiscardDrawWorkflowHandlers } from './card-effects/workflows/shared/activated-wait-self-discard-draw.js';
import { registerLiveStartDiscardGainHeartWorkflowHandlers } from './card-effects/workflows/shared/live-start-discard-gain-heart.js';
import { registerLiveStartDiscardGainBladeWorkflowHandlers } from './card-effects/workflows/shared/live-start-discard-gain-blade.js';
import { registerLiveStartDiscardSameUnitGainHeartBladeWorkflowHandlers } from './card-effects/workflows/shared/live-start-discard-same-unit-gain-heart-blade.js';
import { registerLiveStartPayEnergyStackWaitingMembersToDeckTopWorkflowHandlers } from './card-effects/workflows/shared/live-start-pay-energy-stack-waiting-members-to-deck-top.js';
import { registerLiveStartReplaceOriginalHeartColorWorkflowHandlers } from './card-effects/workflows/shared/live-start-replace-original-heart-color.js';
import { registerLiveStartSuccessCountChooseHeartWorkflowHandlers } from './card-effects/workflows/shared/live-start-success-count-choose-heart.js';
import { registerMillTopGainLiveModifierWorkflowHandlers } from './card-effects/workflows/shared/mill-top-gain-live-modifier.js';
import { registerNamedHandDiscardLiveStartWorkflowHandlers } from './card-effects/workflows/shared/named-hand-discard-live-start.js';
import { registerMemberOnEnterDrawWorkflowHandlers } from './card-effects/workflows/shared/member-on-enter-draw.js';
import { registerOnMoveGainBladeWorkflowHandlers } from './card-effects/workflows/shared/on-move-gain-blade.js';
import { registerOnMoveGainHeartWorkflowHandlers } from './card-effects/workflows/shared/on-move-gain-heart.js';
import { registerOpponentWaitTargetWorkflowHandlers } from './card-effects/workflows/shared/opponent-wait-target.js';
import { registerOnEnterActivateWaitingEnergyWorkflowHandlers } from './card-effects/workflows/shared/on-enter-activate-waiting-energy.js';
import { registerOnEnterDiscardRecoverUnitCardWorkflowHandlers } from './card-effects/workflows/shared/on-enter-discard-recover-unit-card.js';
import { registerPayEnergyGainBladeWorkflowHandlers } from './card-effects/workflows/shared/pay-energy-gain-blade.js';
import { registerPayEnergyGainHeartWorkflowHandlers } from './card-effects/workflows/shared/pay-energy-gain-heart.js';
import { registerPayEnergyWaitingRoomToHandWorkflowHandlers } from './card-effects/workflows/shared/pay-energy-waiting-room-to-hand.js';
import { registerRelayEnterDrawDiscardWorkflowHandlers } from './card-effects/workflows/shared/relay-enter-draw-discard.js';
import { registerRevealedCheerSelectionWorkflowHandlers } from './card-effects/workflows/shared/revealed-cheer-selection.js';
import { registerSelfPositionChangeWorkflowHandlers } from './card-effects/workflows/shared/self-position-change.js';
import { registerSelfSacrificeWaitingRoomToHandWorkflowHandlers } from './card-effects/workflows/shared/self-sacrifice-waiting-room-to-hand.js';
import { registerStageFormationChangeWorkflowHandlers } from './card-effects/workflows/shared/stage-formation-change.js';
import { registerWaitingRoomToHandWorkflowHandlers } from './card-effects/workflows/shared/waiting-room-to-hand.js';
import { registerActivatedRevealHandNoLiveLookTopLiveWorkflowHandlers } from './card-effects/workflows/shared/activated-reveal-hand-no-live-look-top-live.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from './effects/stage-member-target-selection.js';
import type {
  CheerEvent,
  EnergyPlacedByCardEffectEvent,
  EnergyMovedToDeckEvent,
  EnterHandEvent,
  EnterLiveZoneEvent,
  EnterStageEvent,
  EnterWaitingRoomEvent,
  LeaveStageEvent,
  LiveStartEvent,
  LiveSuccessEvent,
  MemberStateChangedEvent,
  MemberSlotMovedEvent,
} from '../domain/events/game-events.js';
import {
  BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID,
  HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
  HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
  SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID,
} from './card-effects/ability-ids.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type ActivatedAbilityUiConfig,
  type CardAbilityDefinition,
} from './card-effects/ability-definition-types.js';
import {
  IMPLEMENTED_QUEUED_ABILITY_IDS,
  doesCardAbilityDefinitionMatchCardCode,
  findCardAbilityDefinitionById,
  getCardAbilityDefinitionById as getIndexedCardAbilityDefinitionById,
  getCardAbilityDefinitionsForCardCode,
} from './card-effects/definitions/lookup.js';

export * from './card-effects/ability-ids.js';
export * from './card-effects/ability-definition-types.js';
export { CARD_ABILITY_DEFINITIONS } from './card-effects/definitions/index.js';
export const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';
const ORDERED_RESOLUTION_BATCH_ID_KEY = 'orderedResolutionBatchId';
const DECLINE_OPTION_LABEL = '不发动';
const ABILITY_USE_STEP = 'ABILITY_USE';
const ACTIVATED_ABILITY_USE_STEP = 'ACTIVATED_ABILITY_USE';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
interface RevealSelectedInspectionCardConfig {
  readonly stepId: string;
  readonly stepText: string;
  readonly actionStep: string;
}
type InspectedCardDestination = 'MAIN_DECK_TOP' | 'WAITING_ROOM';
interface ArrangeInspectedDeckTopConfig {
  readonly ability: PendingAbilityState;
  readonly playerId: string;
  readonly effectText: string;
  readonly inspectCount: number;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly selectMin: number;
  readonly selectMax: number;
  readonly selectedDestination: InspectedCardDestination;
  readonly unselectedDestination: InspectedCardDestination;
  readonly orderedResolution: boolean;
}
interface AbilitySourceEntry {
  readonly cardId: string;
  readonly sourceZone: CardAbilitySourceZone;
  readonly sourceSlot?: SlotPosition;
}
interface OnEnterAbilitySource {
  readonly cardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition | null;
  readonly eventId: string;
  readonly fromZone?: ZoneType;
  readonly replacedMemberCardId?: string;
  readonly replacedMemberEffectiveCost?: number;
  readonly relayReplacements?: readonly RelayReplacementMetadata[];
}
interface RelayReplacementMetadata {
  readonly cardId: string;
  readonly slot: SlotPosition;
  readonly effectiveCost: number;
}
interface OnEnterStageAutoSource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly enteredCardId: string;
  readonly enteredControllerId: string;
  readonly eventId: string;
}
interface OnLeaveStageAbilitySource {
  readonly cardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly eventId: string;
  readonly toZone?: ZoneType;
  readonly replacingCardId?: string;
}
interface MemberSlotMovedAbilitySource {
  readonly cardId: string;
  readonly controllerId: string;
  readonly fromSlot: SlotPosition;
  readonly toSlot: SlotPosition;
  readonly eventId: string;
  readonly event: MemberSlotMovedEvent;
  readonly swappedCardInstanceId?: string;
}
interface MemberStateChangedAbilitySource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly event: MemberStateChangedEvent;
}
interface EnterWaitingRoomAbilitySource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly event: EnterWaitingRoomEvent;
}
interface EnergyPlacedByCardEffectAbilitySource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly event: EnergyPlacedByCardEffectEvent;
}
interface EnqueueTriggeredCardEffectsOptions {
  readonly onEnterSources?: readonly OnEnterAbilitySource[];
  readonly enterStageEvents?: readonly EnterStageEvent[];
  readonly enterHandEvents?: readonly EnterHandEvent[];
  readonly enterLiveZoneEvents?: readonly EnterLiveZoneEvent[];
  readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
  readonly triggerEventLogStartIndex?: number;
  readonly onLeaveStageSources?: readonly OnLeaveStageAbilitySource[];
  readonly leaveStageEvents?: readonly LeaveStageEvent[];
  readonly liveStartEvents?: readonly LiveStartEvent[];
  readonly liveSuccessEvents?: readonly LiveSuccessEvent[];
  readonly cheerEvents?: readonly CheerEvent[];
  readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  readonly memberSlotMovedEvents?: readonly MemberSlotMovedEvent[];
  readonly energyPlacedByCardEffectEvents?: readonly EnergyPlacedByCardEffectEvent[];
  readonly energyMovedToDeckEvents?: readonly EnergyMovedToDeckEvent[];
}
interface StartPendingAbilityEffectOptions {
  readonly orderedResolution?: boolean;
  readonly manualConfirmation?: boolean;
  readonly confirmBeforeResolution?: boolean;
  readonly skipManualConfirmation?: boolean;
}

function getCardAbilityEffectText(abilityId: string): string {
  const effectText = getCardAbilityDefinitionById(abilityId).effectText;
  if (effectText.trim().length === 0) {
    throw new Error(`Missing card ability effect text for abilityId: ${abilityId}`);
  }
  return effectText;
}

function getCardAbilityDefinitionById(abilityId: string): CardAbilityDefinition {
  return getIndexedCardAbilityDefinitionById(abilityId);
}

function getCardAbilityBaseCardCodes(abilityId: string): readonly string[] {
  return getCardAbilityDefinitionById(abilityId).baseCardCodes ?? [];
}

export function getCardAbilityDefinitions(
  cardCode: string | undefined
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitionsForCardCode(cardCode);
}
export function doesAbilityDefinitionMatchCardCode(
  definition: CardAbilityDefinition,
  cardCode: string
): boolean {
  return doesCardAbilityDefinitionMatchCardCode(definition, cardCode);
}

export function getActivatedAbilityUiConfig(
  cardCode: string | undefined,
  sourceZone: CardAbilitySourceZone = CardAbilitySourceZone.STAGE_MEMBER,
  options: {
    readonly game?: GameState;
    readonly playerId?: string;
    readonly sourceCardId?: string;
  } = {}
): ActivatedAbilityUiConfig | null {
  const definition = getCardAbilityDefinitions(cardCode).find(
    (ability) =>
      ability.category === CardAbilityCategory.ACTIVATED &&
      ability.implemented &&
      ability.sourceZone === sourceZone &&
      ability.activatedUi
  );
  if (definition?.activatedUi) {
    return definition.activatedUi;
  }
  if (
    sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
    options.game &&
    options.playerId &&
    options.sourceCardId
  ) {
    return getRenGrantedActivatedAbilityUiConfig(
      options.game,
      options.playerId,
      options.sourceCardId
    );
  }
  return null;
}

export function isSupportedActivatedAbilityForCard(
  abilityId: string,
  cardCode: string | undefined,
  options: {
    readonly game?: GameState;
    readonly playerId?: string;
    readonly sourceCardId?: string;
  } = {}
): boolean {
  const directlySupported = getCardAbilityDefinitions(cardCode).some(
    (ability) =>
      ability.category === CardAbilityCategory.ACTIVATED &&
      ability.implemented &&
      ability.abilityId === abilityId
  );
  if (directlySupported) {
    return true;
  }
  return !!(
    options.game &&
    options.playerId &&
    options.sourceCardId &&
    isRenGrantedActivatedAbility(options.game, options.playerId, options.sourceCardId, abilityId)
  );
}

function getActivatedAbilityDefinition(abilityId: string): CardAbilityDefinition | null {
  const definition = findCardAbilityDefinitionById(abilityId);
  return definition?.category === CardAbilityCategory.ACTIVATED && definition.implemented
    ? definition
    : null;
}

export interface AbilityTurnLimitStatus {
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
}

export type ActivatedAbilityLimitStatus = AbilityTurnLimitStatus;

export function getAbilityTurnLimitStatus(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): AbilityTurnLimitStatus | null {
  const definition = findCardAbilityDefinitionById(abilityId);
  if (definition?.implemented !== true) {
    return null;
  }
  const limit = definition?.perTurnLimit;
  if (limit === undefined) {
    return null;
  }
  const countPendingAsTurnUse = definition.countPendingAsTurnUse !== false;

  const resolvedUses = game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.playerId === playerId &&
      action.payload.abilityId === abilityId &&
      action.payload.sourceCardId === sourceCardId &&
      (action.payload.step === ABILITY_USE_STEP ||
        action.payload.step === ACTIVATED_ABILITY_USE_STEP) &&
      action.payload.turnCount === game.turnCount
  ).length;
  const pendingUses = countPendingAsTurnUse
    ? game.pendingAbilities.filter(
        (ability) =>
          ability.controllerId === playerId &&
          ability.abilityId === abilityId &&
          ability.sourceCardId === sourceCardId
      ).length
    : 0;
  const activeUse =
    countPendingAsTurnUse &&
    game.activeEffect?.controllerId === playerId &&
    game.activeEffect.abilityId === abilityId &&
    game.activeEffect.sourceCardId === sourceCardId
      ? 1
      : 0;
  const used = resolvedUses + pendingUses + activeUse;

  return {
    abilityId,
    sourceCardId,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

export function getActivatedAbilityLimitStatus(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): ActivatedAbilityLimitStatus | null {
  const definition = getActivatedAbilityDefinition(abilityId);
  if (!definition) {
    return null;
  }
  return getAbilityTurnLimitStatus(game, playerId, abilityId, sourceCardId);
}

function canUseAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  const status = getAbilityTurnLimitStatus(game, playerId, abilityId, sourceCardId);
  return status === null || status.used < status.limit;
}

export function canUseActivatedAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  const status = getActivatedAbilityLimitStatus(game, playerId, abilityId, sourceCardId);
  return status === null || status.used < status.limit;
}

function getQueuedAbilityDefinitionsForCard(
  cardCode: string | undefined,
  category: CardAbilityCategory,
  sourceZone: CardAbilitySourceZone,
  sourceSlot?: SlotPosition | null
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitions(cardCode).filter(
    (ability) =>
      ability.category === category &&
      ability.sourceZone === sourceZone &&
      ability.queued &&
      ability.implemented &&
      doesSourceSlotSatisfyAbility(ability, sourceSlot)
  );
}

function doesSourceSlotSatisfyAbility(
  ability: CardAbilityDefinition,
  sourceSlot?: SlotPosition | null
): boolean {
  if (!ability.requiredSourceSlots || ability.requiredSourceSlots.length === 0) {
    return true;
  }

  return (
    sourceSlot !== undefined &&
    sourceSlot !== null &&
    ability.requiredSourceSlots.includes(sourceSlot)
  );
}

function toSlotPosition(value: unknown): SlotPosition | null {
  return Object.values(SlotPosition).includes(value as SlotPosition)
    ? (value as SlotPosition)
    : null;
}

function revealSelectedInspectionCard(
  game: GameState,
  selectedCardId: string,
  config: RevealSelectedInspectionCardConfig
): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.inspectionCardIds?.includes(selectedCardId)) {
    return game;
  }
  if (!effect.selectableCardIds?.includes(selectedCardId)) {
    return game;
  }

  const revealedCardIds = game.inspectionZone.revealedCardIds.includes(selectedCardId)
    ? game.inspectionZone.revealedCardIds
    : [...game.inspectionZone.revealedCardIds, selectedCardId];

  return addAction(
    {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        revealedCardIds,
      },
      activeEffect: {
        ...effect,
        stepId: config.stepId,
        stepText: config.stepText,
        selectableCardIds: [],
        selectionLabel: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.actionStep,
      selectedCardId,
    }
  );
}
const ABILITY_ORDER_SELECTION_STEP_ID = 'SELECT_NEXT_PENDING_ABILITY';
registerLookTopSelectToHandWorkflowHandlers({ enqueueTriggeredCardEffects });
registerActivatedRevealHandNoLiveLookTopLiveWorkflowHandlers({ enqueueTriggeredCardEffects });
registerArrangeInspectedDeckTopWorkflowHandlers({ enqueueTriggeredCardEffects });
registerConditionalLiveModifierWorkflowHandlers();
registerSFutureWaterBatch2LiveStartWorkflowHandlers();
registerSFutureWaterBatch3WorkflowHandlers();
registerSFutureWaterFinalWorkflowHandlers();
registerDiscardLookTopSelectToHandWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp5003KotoriWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp6024SuccessReplacementWorkflowHandlers();
registerWaitDiscardLookTopSelectToHandWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6031FanfareWorkflowHandlers();
registerSBp2024KimikokoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp3006YoshikoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp3001ChikaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp3002RikoWorkflowHandlers();
registerSBp5001ChikaWorkflowHandlers();
registerSBp5002RikoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp5003KananWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp5004DiaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp5005YouWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp5009RubyWorkflowHandlers();
registerSBp5016HanamaruWorkflowHandlers();
registerSBp5017MariWorkflowHandlers();
registerSBp5019NotAloneNotHitoriWorkflowHandlers();
registerSBp5022SelfControlWorkflowHandlers();
registerSBp5023AwakenThePowerWorkflowHandlers();
registerSBp6001ChikaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp6003KananWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp6006YoshikoWorkflowHandlers();
registerSBp6007HanamaruWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp6011RikoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp6016HanamaruWorkflowHandlers({ enqueueTriggeredCardEffects });
registerDrawThenDiscardWorkflowHandlers({ enqueueTriggeredCardEffects });
registerMemberOnEnterDrawWorkflowHandlers();
registerRelayEnterDrawDiscardWorkflowHandlers({ enqueueTriggeredCardEffects });
registerGroupedRecoveryWorkflowHandlers({ enqueueTriggeredCardEffects });
registerDirectMillTopWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNamedHandDiscardLiveStartWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLiveStartDiscardGainHeartWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLiveStartDiscardGainBladeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLiveStartDiscardSameUnitGainHeartBladeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLiveStartPayEnergyStackWaitingMembersToDeckTopWorkflowHandlers();
registerLiveStartReplaceOriginalHeartColorWorkflowHandlers();
registerLiveStartSuccessCountChooseHeartWorkflowHandlers();
registerBp5007NozomiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp6003KotoriWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp6020DancingStarsWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1001KahoWorkflowHandlers();
registerHsPb1006HimeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1009KahoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1007SerasWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1008IzumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1016IzumiWorkflowHandlers();
registerHsPb1014HimeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1021KosuzuWorkflowHandlers();
registerHsPb1005KosuzuWorkflowHandlers();
registerHsPb1013KosuzuWorkflowHandlers();
registerHsPb1025DakishimeruHanabiraWorkflowHandlers();
registerHsPb1028CompassWorkflowHandlers();
registerHsPb1029ZenhouiKyunWorkflowHandlers();
registerHsPr028EchoesBeyondWorkflowHandlers();
registerHsPr035GinkoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1030EdeliedWorkflowHandlers();
registerHsCl1001KahoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsCl1003RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsCl1004GinkoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsCl1010AwokeWorkflowHandlers();
registerHsCl1011DododoWorkflowHandlers();
registerHsBp6003RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6004GinkoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6005KosuzuWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6006HimeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6007SerasWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6008IzumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6010SayakaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6012GinkoWorkflowHandlers();
registerHsBp6014HimeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6015SerasWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6016IzumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6018SayakaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6025TsubasaLaLiberteWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp6029ProofWorkflowHandlers();
registerHsCl1002SayakaWorkflowHandlers();
registerOnEnterSourceMemberGainBladeWorkflowHandlers();
registerHsSd1001KahoWorkflowHandlers();
registerHsSd1002SayakaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsSd1003RurinoWorkflowHandlers();
registerHsSd1006HimeWorkflowHandlers();
registerHsBp1008KosuzuWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1012GinkoWorkflowHandlers();
registerWaitingRoomToHandWorkflowHandlers();
registerSelfSacrificeWaitingRoomToHandWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPayEnergyGainBladeWorkflowHandlers();
registerPayEnergyGainHeartWorkflowHandlers();
registerOpponentWaitTargetWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPayEnergyWaitingRoomToHandWorkflowHandlers();
registerDiscardCostWaitingRoomToHandWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp3007HanamaruWorkflowHandlers();
registerBp5005RinWorkflowHandlers();
registerBp5006MakiWorkflowHandlers();
registerBp5001HonokaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp5021SunnyDaySongWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLlBp5001LiveWithASmileWorkflowHandlers();
registerLlBp5002BringTheLoveWorkflowHandlers();
registerBp5009NicoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp5010HonokaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp5024PrivateWarsWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp5111TsubasaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp5333ErenaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp5004UmiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerWaitSelfOpponentWaitWorkflowHandlers({ enqueueTriggeredCardEffects });
registerActivateOwnStageMemberWorkflowHandlers({ enqueueTriggeredCardEffects });
registerOnLeaveActivateStageMemberWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPrOnEnterChooseDrawDiscardOrWaitOpponentLowCostWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPr014UmiWorkflowHandlers();
registerSBp3021OmoiYoHitotsuNiNareWorkflowHandlers();
registerSBp3024DeepResonanceWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp3001AyumuWorkflowHandlers();
registerNBp3003ShizukuWorkflowHandlers();
registerSpBp2006KinakoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp3004KarinWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp3005AiWorkflowHandlers();
registerNBp3006KanataWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp3007SetsunaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp3011MiaTaylorWorkflowHandlers();
registerNBp3013AyumuWorkflowHandlers();
registerRevealedCheerSelectionWorkflowHandlers({ continuePendingCardEffects });
registerSelfPositionChangeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerStageFormationChangeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlayWaitingRoomMemberToSourceSlotWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp2014RurinoWorkflowHandlers();
registerHsBp5001KahoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerMillTopGainLiveModifierWorkflowHandlers({ enqueueTriggeredCardEffects });
registerKekeOnEnterPlaceWaitingEnergyWorkflowHandlers({ enqueueTriggeredCardEffects });
registerKarinWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNozomiOnEnterWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5002SayakaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5003RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5005KosuzuWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5006HimeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5007SerasWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5017DreamBelieversWorkflowHandlers();
registerHsBp5016IzumiWorkflowHandlers({
  enqueueTriggeredCardEffectsForEnterWaitingRoom: enqueueTriggeredCardEffects,
  enqueueTriggeredCardEffectsForMemberStateChanged: enqueueTriggeredCardEffects,
});
registerHsBp5021JoshoKiryuWorkflowHandlers();
registerHsBp5022RetrofutureWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp1022AwokeWorkflowHandlers();
registerHsBp1023DododoWorkflowHandlers();
registerHsPb1002SayakaWorkflowHandlers();
registerHsPb1004GinkoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1003RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerDiscardThenDrawWorkflowHandlers({ enqueueTriggeredCardEffects });
registerActivatedPayEnergyDrawWorkflowHandlers();
registerHsSd1004GinkoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsSd1005KosuzuWorkflowHandlers();
registerHsSd1008IzumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsSd1020LinkToTheFutureWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb1001KanonWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp1002KasumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNLiveStartScoreBonusesWorkflowHandlers();
registerNLiveSuccessCheerAllBladeScoreWorkflowHandlers();
registerNBp3031MonsterGirlsWorkflowHandlers();
registerNBp5001AyumuWorkflowHandlers();
registerNBp5005AiWorkflowHandlers();
registerNBp5006KanataWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp5008EmmaVerdeWorkflowHandlers();
registerNBp5010ShiorikoWorkflowHandlers();
registerNBp5011MiaTaylorWorkflowHandlers();
registerNBp5012LanzhuWorkflowHandlers();
registerNBp5013AyumuWorkflowHandlers();
registerNBp5014KasumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp5026TokimekiRunnersWorkflowHandlers();
registerNBp5028ChaseWorkflowHandlers();
registerNBp5029MutekikyuBelieverWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp5015ShizukuWorkflowHandlers();
registerNBp5030RyouranVictoryRoadWorkflowHandlers();
registerNBp1026PoppinUpWorkflowHandlers();
registerNBp3008EmmaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp3010ShiorikoWorkflowHandlers();
registerNBp3009RinaWorkflowHandlers();
registerNBp3025AwakeningPromiseWorkflowHandlers();
registerNBp3027LaBellaPatriaWorkflowHandlers();
registerNBp4001AyumuWorkflowHandlers();
registerNBp4002KasumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLiveSuccessConditionalDrawOneWorkflowHandlers();
registerNBp4004KarinWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp4005AiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp4006KanataWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp4007SetsunaWorkflowHandlers();
registerNBp4008EmmaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp4009RinaWorkflowHandlers();
registerNBp4010ShiorikoWorkflowHandlers();
registerNBp4011MiaTaylorWorkflowHandlers({ enqueueTriggeredCardEffects });
registerOnEnterWaitingRoomCardToDeckTopWorkflowHandlers();
registerNBp4023MiaTaylorWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp4025VividWorldWorkflowHandlers();
registerNBp4026DiveWorkflowHandlers();
registerNBp4027EmotionWorkflowHandlers();
registerNBp4029RiseUpHighWorkflowHandlers();
registerSBp2025AozoraJumpingHeartWorkflowHandlers();
registerCheerRerollWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp3019MiracleWaveWorkflowHandlers();
registerSBp2007HanamaruWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSBp2008MariWorkflowHandlers();
registerNBp4030DaydreamMermaidWorkflowHandlers();
registerNBp4031NeoSkyNeoMapWorkflowHandlers();
registerNBp5003ShizukuWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp5021RinaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerOnEnterActivateWaitingEnergyWorkflowHandlers();
registerNDiscardRecoverAndBladeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNPb1006KanataWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNPb1011MiaWorkflowHandlers();
registerHsBp6011RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp2005RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp2003KozueWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp2007GinkoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp2008KosuzuWorkflowHandlers();
registerHsBp2009HimeWorkflowHandlers();
registerHsBp2018HimeWorkflowHandlers();
registerHsBp2019BloomTheSmileBloomTheDreamWorkflowHandlers();
registerMakiOnEnterWorkflowHandlers();
registerPlPb1001HonokaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1002EliWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1003KotoriWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1004UmiWorkflowHandlers();
registerPlPb1008HanayoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1009NicoWorkflowHandlers();
registerPlPb1017HanayoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1006MakiWorkflowHandlers();
registerPlPb1007NozomiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1010HonokaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1012KotoriWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1013UmiWorkflowHandlers();
registerPb1015MakiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1028WaoWaoPowerfulDayWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1030CutiePantherWorkflowHandlers();
registerPlPb1031KaguyaNoShiroDeOdoritaiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3026OhLovePeaceWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1018NicoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSd1008HanayoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSPb1002RikoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSPb1003KananWorkflowHandlers();
registerSPb1019GenkiZenkaiDayDayDayWorkflowHandlers();
registerSPb1022MobiusLoopWorkflowHandlers();
registerEmmaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLlBp6001KotoriDiaKosuzuWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3001HonokaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3022YumeNoTobiraWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp3028TsunagaruConnectWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3002EliWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3003KotoriWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3004UmiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3005RinWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3007NozomiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3008HanayoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3009NicoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3024NatsuiroEgaoWorkflowHandlers();
registerPlBp3025TakaramonozuWorkflowHandlers();
registerPlBp3006MakiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp4017HanayoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp4005RinWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp4009NicoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp6001HonokaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp6006MakiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp6008And010ActivatedStateWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp6013And023SuccessZoneWorkflowHandlers();
registerPlBp6021WonderfulRushWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp6007NozomiWorkflowHandlers();
registerLiveSuccessDiscardRecoverLowCostOrScoreCheerWorkflowHandlers({
  enqueueTriggeredCardEffects,
});
registerNPr026RinaWorkflowHandlers();
registerPlBp3014RinWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp5007SetsunaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp2009NatsumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp2010MargareteWorkflowHandlers();
registerSBp5020LandingActionYeahWorkflowHandlers();
registerSBp5111SeiraWorkflowHandlers({
  enqueueMemberSlotMovedCardEffects: enqueueTriggeredCardEffects,
  enqueueMemberStateChangedCardEffects: enqueueTriggeredCardEffects,
});
registerSBp5222RiaWorkflowHandlers({
  enqueueMemberSlotMovedCardEffects: enqueueTriggeredCardEffects,
});
registerSpBp1024TinyStarsWorkflowHandlers();
registerSpBp2001KanonWorkflowHandlers();
registerSpBp2003ChisatoWorkflowHandlers();
registerSpBp2005RenWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp2011TomariWorkflowHandlers();
registerSpBp2024VitaminSummerWorkflowHandlers();
registerSpBp4001KanonWorkflowHandlers();
registerSpBp4004SumireWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp4006KinakoWorkflowHandlers();
registerSpBp4007MeiWorkflowHandlers();
registerSpBp4016RenWorkflowHandlers();
registerStageMemberWaitingEnergyPlacementWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp4023DazzlingGameWorkflowHandlers();
registerSpBp4024NonfictionWorkflowHandlers();
registerSpBp4025SpecialColorWorkflowHandlers();
registerSpBp4026WishSongWorkflowHandlers({ enqueueTriggeredCardEffects });
registerShikiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5001KanonWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5004SumireWorkflowHandlers();
registerSpBp7005RenWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp7006KinakoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp7007MeiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5005RenWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5009NatsumiWorkflowHandlers({
  enqueueTriggeredCardEffectsForEnterWaitingRoom: enqueueTriggeredCardEffects,
  enqueueTriggeredCardEffectsForMemberStateChanged: enqueueTriggeredCardEffects,
});
registerSpBp5010MargareteWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5007MeiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5013KekeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5014ChisatoWorkflowHandlers();
registerSpBp5015SumireWorkflowHandlers();
registerSpBp5020NatsumiWorkflowHandlers();
registerSpBp5023ShootingVoiceWorkflowHandlers();
registerSpBp5024MiracleNewStoryWorkflowHandlers();
registerSpBp5025TokonatsuSunshineWorkflowHandlers();
registerSpBp5026LetsBeOneWorkflowHandlers();
registerSpBp5027HotPassionWorkflowHandlers();
registerSpBp5111MaoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5222YuunaWorkflowHandlers();
registerSpBp5002KekeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5006KinakoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb1003ChisatoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb1004SumireWorkflowHandlers();
registerSpPb1005RenWorkflowHandlers();
registerSpPb1006KinakoWorkflowHandlers();
registerSpPb1007MeiWorkflowHandlers();
registerSpPb1008ShikiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb1011TomariWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb1020NatsumiWorkflowHandlers();
registerSpPb1023DistortionWorkflowHandlers();
registerSpPb1025JellyfishWorkflowHandlers();
registerSpPb2001KanonWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2006KinakoWorkflowHandlers();
registerSpPb2009NatsumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2010MargareteWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2011TomariWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2013KekeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2018MeiWorkflowHandlers();
registerSpPb2020NatsumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2022TomariWorkflowHandlers();
registerSpPb2028KinakoWorkflowHandlers();
registerSpPb2002KekeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2003ChisatoWorkflowHandlers();
registerSpPb2004SumireWorkflowHandlers();
registerSpPb2005RenWorkflowHandlers();
registerSpPb2007MeiWorkflowHandlers();
registerSpPb2008ShikiWorkflowHandlers();
registerSpPr018KanonWorkflowHandlers();
registerLowCostRelayPlayHandMemberWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPr024SumireWorkflowHandlers();
registerSpPb2000ChisatoNatsumiWorkflowHandlers();
registerSpPb2045ZettaiLoverWorkflowHandlers();
registerSpPb2046ButterflyWingWorkflowHandlers();
registerSpPb2047WelcomeToBokuraNoSekaiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2048DistortionWorkflowHandlers();
registerSpPb2049NeutralWorkflowHandlers();
registerOnEnterDiscardRecoverUnitCardWorkflowHandlers({ enqueueTriggeredCardEffects });
registerOnCheerLiveCountGainHeartWorkflowHandlers();
registerOnCheerNoBladeHeartGainHeartWorkflowHandlers();
registerOnCheerSameGroupMemberTripleGainHeartsWorkflowHandlers();
registerSSd1004DiaWorkflowHandlers();
registerSSd1005YouWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSSd1006YoshikoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSSd1020JimoAiDashWorkflowHandlers({ enqueueTriggeredCardEffects });
registerChisatoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerActivatedPayEnergySelfPositionChangeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerActivatedWaitSelfDiscardDrawWorkflowHandlers({ enqueueTriggeredCardEffects });
registerOnMoveGainHeartWorkflowHandlers();
registerOnMoveGainBladeWorkflowHandlers();
registerAqoursHeartScoreBonusesWorkflowHandlers();
registerSpSd2003ChisatoWorkflowHandlers();
registerSpBp4MovedSideBladeWorkflowHandlers();
registerSpSd2006KinakoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpSd2020NatsumiWorkflowHandlers();
registerSpSd2023HajimariWaKimiNoSoraWorkflowHandlers();
registerSpSd2025AspireWorkflowHandlers();
registerYoshikoPlayLowCostMembersWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSPb1006YoshikoWorkflowHandlers({ enqueueTriggeredCardEffects });
interface CardEffectRunnerResult {
  readonly gameState: GameState;
  readonly resolvedAbilityIds: readonly string[];
}
export function enqueueTriggeredCardEffects(
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options: EnqueueTriggeredCardEffectsOptions = {}
): GameState {
  let state = game;
  if (triggerConditions.includes(TriggerCondition.ON_ENTER_STAGE)) {
    const enterStageEvents = options.enterStageEvents ?? getLatestEnterStageEventsFromLog(state);
    const eventSources =
      enterStageEvents.length > 0
        ? createOnEnterAbilitySourcesFromEvents(enterStageEvents)
        : undefined;
    const onEnterSources = options.onEnterSources ?? eventSources;
    state = enqueueOnEnterCardEffects(state, onEnterSources);
    state = enqueueOnEnterStageAutoCardEffects(
      state,
      createOnEnterStageAutoSources(
        state,
        enterStageEvents.length > 0 ? enterStageEvents : undefined,
        onEnterSources
      )
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_LEAVE_STAGE)) {
    state = removeTargetMemberBoundLiveModifiersForLeaveStageEvents(
      state,
      options.leaveStageEvents ?? getLeaveStageEventsFromLog(state)
    );
    const onLeaveSources =
      options.onLeaveStageSources ??
      createOnLeaveStageAbilitySourcesFromEvents(
        options.leaveStageEvents ?? getLeaveStageEventsFromLog(state)
      );
    state = enqueueOnLeaveStageCardEffects(state, onLeaveSources);
  }

  if (triggerConditions.includes(TriggerCondition.ON_LIVE_START)) {
    state = enqueueLiveStartCardEffects(
      state,
      options.liveStartEvents ?? getLatestLiveStartEventsFromLog(state)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_LIVE_SUCCESS)) {
    state = enqueueLiveSuccessCardEffects(
      state,
      options.liveSuccessEvents ?? getLatestLiveSuccessEventsFromLog(state)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_MEMBER_STATE_CHANGED)) {
    state = enqueueMemberStateChangedCardEffects(
      state,
      options.memberStateChangedEvents ?? getLatestMemberStateChangedEventsFromLog(state)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_CHEER)) {
    state = enqueueCheerCardEffects(
      state,
      options.cheerEvents ?? getLatestCheerEventsFromLog(state)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_ENTER_WAITING_ROOM)) {
    const enterWaitingRoomEvents =
      options.enterWaitingRoomEvents ??
      (options.triggerEventLogStartIndex === undefined
        ? []
        : getEnterWaitingRoomEventsFromLog(state, options.triggerEventLogStartIndex));
    state = enqueueEnterWaitingRoomCardEffects(
      state,
      enterWaitingRoomEvents
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_ENTER_HAND)) {
    const enterHandEvents =
      options.enterHandEvents ??
      (options.triggerEventLogStartIndex === undefined
        ? getLatestEnterHandEventsFromLog(state)
        : getEnterHandEventsFromLog(state, options.triggerEventLogStartIndex));
    state = enqueueEnterHandCardEffects(state, enterHandEvents);
  }

  if (triggerConditions.includes(TriggerCondition.ON_ENTER_LIVE_ZONE)) {
    const enterLiveZoneEvents =
      options.enterLiveZoneEvents ??
      (options.triggerEventLogStartIndex === undefined
        ? getLatestEnterLiveZoneEventsFromLog(state)
        : getEnterLiveZoneEventsFromLog(state, options.triggerEventLogStartIndex));
    state = enqueueEnterLiveZoneCardEffects(state, enterLiveZoneEvents);
  }

  if (triggerConditions.includes(TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)) {
    state = enqueueEnergyPlacedByCardEffectCardEffects(
      state,
      options.energyPlacedByCardEffectEvents ?? getLatestEnergyPlacedByCardEffectEventsFromLog(state)
    );
  }
  if (triggerConditions.includes(TriggerCondition.ON_ENERGY_MOVED_TO_DECK)) {
    state = enqueueEnergyMovedToDeckCardEffects(
      state,
      options.energyMovedToDeckEvents ?? getLatestEnergyMovedToDeckEvents(state)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_MEMBER_SLOT_MOVED)) {
    state = enqueueMemberSlotMovedCardEffects(
      state,
      options.memberSlotMovedEvents ?? getMemberSlotMovedEventsFromLog(state)
    );
  }

  return state;
}

function getEnergyPlacedByCardEffectEventsFromLog(
  game: GameState
): readonly EnergyPlacedByCardEffectEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is EnergyPlacedByCardEffectEvent =>
        event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
    );
}

function getLatestEnergyPlacedByCardEffectEventsFromLog(
  game: GameState
): readonly EnergyPlacedByCardEffectEvent[] {
  const events = getEnergyPlacedByCardEffectEventsFromLog(game);
  const latestEvent = events.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getMemberSlotMovedEventsFromLog(game: GameState): readonly MemberSlotMovedEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberSlotMovedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
    );
}

function getMemberStateChangedEventsFromLog(game: GameState): readonly MemberStateChangedEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberStateChangedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
    );
}

function getLatestMemberStateChangedEventsFromLog(
  game: GameState
): readonly MemberStateChangedEvent[] {
  const events = getMemberStateChangedEventsFromLog(game);
  const latestEvent = events.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getEnterStageEventsFromLog(game: GameState): readonly EnterStageEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is EnterStageEvent => event.eventType === TriggerCondition.ON_ENTER_STAGE
    );
}

function getLatestEnterStageEventsFromLog(game: GameState): readonly EnterStageEvent[] {
  const enterStageEvents = getEnterStageEventsFromLog(game);
  const latestEvent = enterStageEvents.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getLeaveStageEventsFromLog(game: GameState): readonly LeaveStageEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is LeaveStageEvent => event.eventType === TriggerCondition.ON_LEAVE_STAGE
    );
}

function getEnterWaitingRoomEventsFromLog(
  game: GameState,
  startIndex = 0
): readonly EnterWaitingRoomEvent[] {
  return game.eventLog
    .slice(startIndex)
    .map((entry) => entry.event)
    .filter(
      (event): event is EnterWaitingRoomEvent =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
}

function getLiveStartEventsFromLog(game: GameState): readonly LiveStartEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter((event): event is LiveStartEvent => event.eventType === TriggerCondition.ON_LIVE_START);
}

function getLatestLiveStartEventsFromLog(game: GameState): readonly LiveStartEvent[] {
  const liveStartEvents = getLiveStartEventsFromLog(game);
  const latestEvent = liveStartEvents.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getLiveSuccessEventsFromLog(game: GameState): readonly LiveSuccessEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is LiveSuccessEvent => event.eventType === TriggerCondition.ON_LIVE_SUCCESS
    );
}

function getLatestLiveSuccessEventsFromLog(game: GameState): readonly LiveSuccessEvent[] {
  const liveSuccessEvents = getLiveSuccessEventsFromLog(game);
  const latestEvent = liveSuccessEvents.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getCheerEventsFromLog(game: GameState): readonly CheerEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter((event): event is CheerEvent => event.eventType === TriggerCondition.ON_CHEER);
}

function getLatestCheerEventsFromLog(game: GameState): readonly CheerEvent[] {
  const cheerEvents = getCheerEventsFromLog(game);
  const latestEvent = cheerEvents.at(-1);
  return latestEvent ? [latestEvent] : [];
}

function getNewLeaveStageEvents(before: GameState, after: GameState): readonly LeaveStageEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is LeaveStageEvent => event.eventType === TriggerCondition.ON_LEAVE_STAGE
    );
}

function createMemberSlotMovedAbilitySourcesFromEvents(
  events: readonly MemberSlotMovedEvent[]
): readonly MemberSlotMovedAbilitySource[] {
  return events.map((event) => ({
    cardId: event.cardInstanceId,
    controllerId: event.controllerId,
    fromSlot: event.fromSlot,
    toSlot: event.toSlot,
    eventId: event.eventId,
    event,
    swappedCardInstanceId: event.swappedCardInstanceId,
  }));
}

function enqueueEnterWaitingRoomCardEffects(
  game: GameState,
  events: readonly EnterWaitingRoomEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    if (!isSupportedEnterWaitingRoomTriggerZone(event)) {
      continue;
    }
    const player = getPlayerById(state, event.controllerId);
    if (!player) {
      continue;
    }
    for (const sourceSlot of MEMBER_SLOT_ORDER) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      if (!sourceCardId) {
        continue;
      }
      state = enqueueSingleEnterWaitingRoomCardEffect(state, {
        sourceCardId,
        controllerId: player.id,
        sourceSlot,
        event,
      });
    }
  }
  return state;
}

function enqueueEnergyPlacedByCardEffectCardEffects(
  game: GameState,
  events: readonly EnergyPlacedByCardEffectEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    const player = getPlayerById(state, event.targetPlayerId);
    if (!player || event.placedEnergyCardIds.length === 0) {
      continue;
    }
    for (const sourceSlot of MEMBER_SLOT_ORDER) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      if (!sourceCardId) {
        continue;
      }
      state = enqueueSingleEnergyPlacedByCardEffectCardEffect(state, {
        sourceCardId,
        controllerId: player.id,
        sourceSlot,
        event,
      });
    }
  }
  return state;
}

function enqueueSingleEnergyPlacedByCardEffectCardEffect(
  game: GameState,
  source: EnergyPlacedByCardEffectAbilitySource
): GameState {
  const player = getPlayerById(game, source.controllerId);
  const sourceCard = getCardById(game, source.sourceCardId);
  if (
    !player ||
    !sourceCard ||
    player.memberSlots.slots[source.sourceSlot] !== source.sourceCardId ||
    !source.event.placedEnergyCardIds.every((cardId) => player.energyZone.cardIds.includes(cardId))
  ) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter(
    (ability) =>
      ability.triggerCondition === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT &&
      doesEnergyPlacedByCardEffectEventSatisfyAbilityDefinition(ability, source.event)
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (
      abilityDefinition.skipQueueWhenTurnLimitReached === true &&
      !canUseAbilityThisTurn(state, source.controllerId, abilityId, source.sourceCardId)
    ) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.sourceCardId}:${source.event.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.sourceCardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
      eventIds: [source.event.eventId],
      sourceSlot: source.sourceSlot,
      metadata: {
        triggerKind: 'ENERGY_PLACED_BY_CARD_EFFECT',
        eventId: source.event.eventId,
        targetPlayerId: source.event.targetPlayerId,
        placedEnergyCardIds: source.event.placedEnergyCardIds,
        orientation: source.event.orientation,
        causedByKind: source.event.cause.kind,
        causedByPlayerId: source.event.cause.playerId,
        causedBySourceCardId: source.event.cause.sourceCardId,
        causedByAbilityId: source.event.cause.abilityId ?? null,
        causedByPendingAbilityId: source.event.cause.pendingAbilityId ?? null,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.sourceCardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        eventId: source.event.eventId,
        targetPlayerId: source.event.targetPlayerId,
        placedEnergyCardIds: source.event.placedEnergyCardIds,
        orientation: source.event.orientation,
        causedByPlayerId: source.event.cause.playerId,
        causedBySourceCardId: source.event.cause.sourceCardId,
        causedByAbilityId: source.event.cause.abilityId ?? null,
      }
    );
  }

  return state;
}

function doesEnergyPlacedByCardEffectEventSatisfyAbilityDefinition(
  ability: CardAbilityDefinition,
  event: EnergyPlacedByCardEffectEvent
): boolean {
  if (ability.energyPlacementCause === 'OWN_CARD_EFFECT') {
    return event.cause.playerId === event.targetPlayerId;
  }
  return true;
}

function isSupportedEnterWaitingRoomTriggerZone(event: EnterWaitingRoomEvent): boolean {
  return event.toZone === ZoneType.WAITING_ROOM;
}

function enqueueSingleEnterWaitingRoomCardEffect(
  game: GameState,
  source: EnterWaitingRoomAbilitySource
): GameState {
  const player = getPlayerById(game, source.controllerId);
  const sourceCard = getCardById(game, source.sourceCardId);
  if (
    !player ||
    !sourceCard ||
    player.memberSlots.slots[source.sourceSlot] !== source.sourceCardId
  ) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter(
    (ability) =>
      ability.triggerCondition === TriggerCondition.ON_ENTER_WAITING_ROOM &&
      doesEnterWaitingRoomEventSatisfyAbilityDefinition(ability, source.event)
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (!canUseAbilityThisTurn(state, source.controllerId, abilityId, source.sourceCardId)) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.sourceCardId}:${source.event.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const movedCardIds = source.event.cardInstanceIds ?? [source.event.cardInstanceId];
    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.sourceCardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_WAITING_ROOM,
      eventIds: [source.event.eventId],
      sourceSlot: source.sourceSlot,
      metadata: {
        movedCardIds,
        fromZone: source.event.fromZone,
        toZone: source.event.toZone,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.sourceCardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        movedCardIds,
      }
    );
  }

  return state;
}

function doesEnterWaitingRoomEventSatisfyAbilityDefinition(
  ability: CardAbilityDefinition,
  event: EnterWaitingRoomEvent
): boolean {
  const triggerFromZones = ability.triggerFromZones ?? [ZoneType.HAND];
  const triggerToZones = ability.triggerToZones ?? [ZoneType.WAITING_ROOM];
  return triggerFromZones.includes(event.fromZone) && triggerToZones.includes(event.toZone);
}

function enqueueMemberStateChangedCardEffects(
  game: GameState,
  events: readonly MemberStateChangedEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    for (const source of createMemberStateChangedAbilitySources(state, event)) {
      state = enqueueSingleMemberStateChangedCardEffect(state, source);
    }
  }
  return state;
}

function createMemberStateChangedAbilitySources(
  game: GameState,
  event: MemberStateChangedEvent
): readonly MemberStateChangedAbilitySource[] {
  const sources: MemberStateChangedAbilitySource[] = [];
  const changedController = getPlayerById(game, event.controllerId);
  if (
    changedController &&
    changedController.memberSlots.slots[event.slot] === event.cardInstanceId
  ) {
    sources.push({
      sourceCardId: event.cardInstanceId,
      controllerId: event.controllerId,
      sourceSlot: event.slot,
      event,
    });
  }

  if (
    event.cause?.kind === 'CARD_EFFECT' &&
    event.cause.playerId !== event.controllerId &&
    event.previousOrientation === OrientationState.ACTIVE &&
    event.nextOrientation === OrientationState.WAITING
  ) {
    const effectController = getPlayerById(game, event.cause.playerId);
    if (effectController) {
      for (const sourceSlot of MEMBER_SLOT_ORDER) {
        const sourceCardId = effectController.memberSlots.slots[sourceSlot];
        if (!sourceCardId) {
          continue;
        }
        sources.push({
          sourceCardId,
          controllerId: effectController.id,
          sourceSlot,
          event,
        });
      }
    }
  }

  return sources;
}

function enqueueSingleMemberStateChangedCardEffect(
  game: GameState,
  source: MemberStateChangedAbilitySource
): GameState {
  const sourceCard = getCardById(game, source.sourceCardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter(
    (ability) =>
      ability.triggerCondition === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
      doesMemberStateChangedEventSatisfyAbility(game, source, ability)
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (!canUseAbilityThisTurn(state, source.controllerId, abilityId, source.sourceCardId)) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.sourceCardId}:${source.event.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.sourceCardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_MEMBER_STATE_CHANGED,
      eventIds: [source.event.eventId],
      sourceSlot: source.sourceSlot,
      metadata: {
        changedCardId: source.event.cardInstanceId,
        changedControllerId: source.event.controllerId,
        changedSlot: source.event.slot,
        previousOrientation: source.event.previousOrientation,
        nextOrientation: source.event.nextOrientation,
        causedByKind: source.event.cause?.kind ?? null,
        causedByPlayerId:
          source.event.cause?.kind === 'CARD_EFFECT' ? source.event.cause.playerId : null,
        causedBySourceCardId:
          source.event.cause?.kind === 'CARD_EFFECT' ? source.event.cause.sourceCardId : null,
        causedByAbilityId:
          source.event.cause?.kind === 'CARD_EFFECT'
            ? (source.event.cause.abilityId ?? null)
            : null,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.sourceCardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        changedCardId: source.event.cardInstanceId,
        changedControllerId: source.event.controllerId,
        previousOrientation: source.event.previousOrientation,
        nextOrientation: source.event.nextOrientation,
      }
    );
  }

  return state;
}

function doesMemberStateChangedEventSatisfyAbility(
  game: GameState,
  source: MemberStateChangedAbilitySource,
  ability: CardAbilityDefinition
): boolean {
  const event = source.event;

  if (ability.abilityId === N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID) {
    const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
    return (
      event.cardInstanceId === source.sourceCardId &&
      event.controllerId === source.controllerId &&
      event.previousOrientation === OrientationState.ACTIVE &&
      event.nextOrientation === OrientationState.WAITING &&
      game.currentPhase === GamePhase.MAIN_PHASE &&
      activePlayerId === source.controllerId
    );
  }

  if (ability.abilityId === PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID) {
    const changedCard = getCardById(game, event.cardInstanceId);
    return (
      event.cause?.kind === 'CARD_EFFECT' &&
      event.cause.playerId === source.controllerId &&
      event.controllerId !== source.controllerId &&
      event.previousOrientation === OrientationState.ACTIVE &&
      event.nextOrientation === OrientationState.WAITING &&
      changedCard !== null &&
      isMemberCardData(changedCard.data) &&
      costLte(4)(changedCard)
    );
  }

  return false;
}

function enqueueMemberSlotMovedCardEffects(
  game: GameState,
  events: readonly MemberSlotMovedEvent[]
): GameState {
  let state = game;
  for (const source of createMemberSlotMovedAbilitySourcesFromEvents(events)) {
    state = enqueueSingleMemberSlotMovedCardEffect(state, source);
  }
  state = enqueueSpPb2022MemberSlotMovedObserverCardEffects(state, events);
  return enqueueMemberSlotMovedObserverCardEffects(state, events);
}

function enqueueSingleMemberSlotMovedCardEffect(
  game: GameState,
  source: MemberSlotMovedAbilitySource
): GameState {
  const player = getPlayerById(game, source.controllerId);
  const sourceCard = getCardById(game, source.cardId);
  if (!player || !sourceCard || player.memberSlots.slots[source.toSlot] !== source.cardId) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.toSlot
  ).filter(
    (ability) =>
      ability.triggerCondition === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
      ability.observerOnly !== true
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (!canUseAbilityThisTurn(state, source.controllerId, abilityId, source.cardId)) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.cardId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.cardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      eventIds: [source.eventId],
      sourceSlot: source.toSlot,
      metadata: {
        fromSlot: source.fromSlot,
        toSlot: source.toSlot,
        swappedCardInstanceId: source.swappedCardInstanceId ?? null,
        causedByKind: source.event.cause?.kind ?? null,
        causedByPlayerId:
          source.event.cause?.kind === 'CARD_EFFECT' ? source.event.cause.playerId : null,
        causedBySourceCardId:
          source.event.cause?.kind === 'CARD_EFFECT' ? source.event.cause.sourceCardId : null,
        causedByAbilityId:
          source.event.cause?.kind === 'CARD_EFFECT'
            ? (source.event.cause.abilityId ?? null)
            : null,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.cardId,
        timingId: pendingAbility.timingId,
        fromSlot: source.fromSlot,
        toSlot: source.toSlot,
        swappedCardInstanceId: source.swappedCardInstanceId ?? null,
      }
    );
  }

  return state;
}

function enqueueSpPb2022MemberSlotMovedObserverCardEffects(
  game: GameState,
  events: readonly MemberSlotMovedEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    const player = getPlayerById(state, event.controllerId);
    if (!player) {
      continue;
    }

    for (const sourceSlot of MEMBER_SLOT_ORDER) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      const sourceCard = sourceCardId ? getCardById(state, sourceCardId) : null;
      if (!sourceCardId || !sourceCard) {
        continue;
      }

      const hasTomariObserverAbility = getQueuedAbilityDefinitionsForCard(
        sourceCard.data.cardCode,
        CardAbilityCategory.AUTO,
        CardAbilitySourceZone.STAGE_MEMBER,
        sourceSlot
      ).some(
        (ability) =>
          ability.abilityId ===
            SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID &&
          ability.triggerCondition === TriggerCondition.ON_MEMBER_SLOT_MOVED
      );
      if (!hasTomariObserverAbility) {
        continue;
      }

      const abilityId = SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID;
      if (!canUseAbilityThisTurn(state, player.id, abilityId, sourceCardId)) {
        continue;
      }

      const pendingAbilityId = `${abilityId}:${sourceCardId}:${event.eventId}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: player.id,
        mandatory: true,
        timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
        eventIds: [event.eventId],
        sourceSlot,
        metadata: {
          movedCardId: event.cardInstanceId,
          fromSlot: event.fromSlot,
          toSlot: event.toSlot,
          swappedCardInstanceId: event.swappedCardInstanceId ?? null,
        },
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        player.id,
        {
          pendingAbilityId,
          abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          movedCardId: event.cardInstanceId,
          fromSlot: event.fromSlot,
          toSlot: event.toSlot,
          sourceSlot,
        }
      );
    }
  }

  return state;
}

function enqueueOnLeaveStageCardEffects(
  game: GameState,
  explicitSources: readonly OnLeaveStageAbilitySource[] | undefined = undefined
): GameState {
  const sources = explicitSources ?? getLatestLeaveStageAbilitySources(game);
  if (sources.length === 0) {
    return game;
  }

  let state = game;
  for (const source of sources) {
    state = enqueueSingleOnLeaveStageCardEffect(state, source);
  }

  return state;
}

function getLatestLeaveStageAbilitySources(game: GameState): readonly OnLeaveStageAbilitySource[] {
  const action = [...game.actionHistory]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === 'PLAY_MEMBER' ||
        (candidate.type === 'MOVE_CARD' &&
          candidate.payload.fromZone === ZoneType.MEMBER_SLOT &&
          candidate.payload.toZone === ZoneType.WAITING_ROOM)
    );
  if (!action) {
    return [];
  }

  if (action.type === 'PLAY_MEMBER') {
    const replacedCardId =
      typeof action.payload.replacedCardId === 'string' ? action.payload.replacedCardId : null;
    const replacingCardId =
      action.payload.isRelay === true && typeof action.payload.cardId === 'string'
        ? action.payload.cardId
        : undefined;
    const sourceSlot = toSlotPosition(action.payload.targetSlot);
    if (!replacedCardId || sourceSlot === null) {
      return [];
    }
    return [
      {
        cardId: replacedCardId,
        controllerId: action.playerId ?? getCardById(game, replacedCardId)?.ownerId ?? '',
        sourceSlot,
        eventId: `action:${action.sequence}`,
        toZone: ZoneType.WAITING_ROOM,
        replacingCardId,
      },
    ].filter((source) => source.controllerId.length > 0);
  }

  const cardId = typeof action.payload.cardId === 'string' ? action.payload.cardId : null;
  const sourceSlot = toSlotPosition(action.payload.sourceSlot);
  if (!cardId || sourceSlot === null) {
    return [];
  }

  return [
    {
      cardId,
      controllerId: action.playerId ?? getCardById(game, cardId)?.ownerId ?? '',
      sourceSlot,
      eventId: `action:${action.sequence}`,
      toZone: ZoneType.WAITING_ROOM,
    },
  ].filter((source) => source.controllerId.length > 0);
}

function createOnLeaveStageAbilitySourcesFromEvents(
  events: readonly LeaveStageEvent[] | undefined
): readonly OnLeaveStageAbilitySource[] | undefined {
  if (!events || events.length === 0) {
    return undefined;
  }

  return events.map((event) => ({
    cardId: event.cardInstanceId,
    controllerId: event.controllerId,
    sourceSlot: event.fromSlot,
    eventId: event.eventId,
    toZone: event.toZone,
    replacingCardId: event.replacingCardId,
  }));
}

function isHighCostHasunosoraRelayReplacement(
  game: GameState,
  source: OnLeaveStageAbilitySource
): boolean {
  return isHsSd1001HighCostHasunosoraRelayReplacement(game, source.replacingCardId);
}

function enqueueSingleOnLeaveStageCardEffect(
  game: GameState,
  source: OnLeaveStageAbilitySource
): GameState {
  const sourceCard = getCardById(game, source.cardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter((ability) => ability.triggerCondition === TriggerCondition.ON_LEAVE_STAGE);
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (
      abilityId === HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID &&
      !isHighCostHasunosoraRelayReplacement(state, source)
    ) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.cardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_LEAVE_STAGE,
      eventIds: [source.eventId],
      sourceSlot: source.sourceSlot,
      metadata: {
        replacingCardId: source.replacingCardId ?? null,
        toZone: source.toZone ?? null,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.cardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        toZone: source.toZone ?? null,
        replacingCardId: source.replacingCardId ?? null,
      }
    );
  }

  return state;
}

function enqueueOnEnterCardEffects(
  game: GameState,
  explicitSources: readonly OnEnterAbilitySource[] | undefined = undefined
): GameState {
  const sources = explicitSources ?? getLatestPlayMemberOnEnterSources(game);
  if (sources.length === 0) {
    return game;
  }

  let state = game;
  for (const source of sources) {
    state = enqueueSingleOnEnterCardEffect(state, source);
  }

  return state;
}

function getLatestPlayMemberOnEnterSources(game: GameState): readonly OnEnterAbilitySource[] {
  const action = [...game.actionHistory]
    .reverse()
    .find((candidate) => candidate.type === 'PLAY_MEMBER');
  const sourceCardId = typeof action?.payload.cardId === 'string' ? action.payload.cardId : null;
  if (!action || !sourceCardId) {
    return [];
  }

  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard) {
    return [];
  }

  return [
    {
      cardId: sourceCardId,
      controllerId: action.playerId ?? sourceCard.ownerId,
      sourceSlot: toSlotPosition(action.payload.targetSlot),
      eventId: `action:${action.sequence}`,
      fromZone: ZoneType.HAND,
      replacedMemberCardId:
        typeof action.payload.replacedCardId === 'string'
          ? action.payload.replacedCardId
          : undefined,
      relayReplacements: getRelayReplacementsFromPayload(action.payload.relayReplacements),
    },
  ];
}

function createOnEnterAbilitySourcesFromEvents(
  events: readonly EnterStageEvent[] | undefined
): readonly OnEnterAbilitySource[] | undefined {
  if (!events || events.length === 0) {
    return undefined;
  }

  return events.map((event) => ({
    cardId: event.cardInstanceId,
    controllerId: event.controllerId,
    sourceSlot: event.toSlot,
    eventId: event.eventId,
    fromZone: event.fromZone,
    replacedMemberCardId: event.replacedMemberCardId,
    replacedMemberEffectiveCost: event.replacedMemberEffectiveCost,
    relayReplacements: event.relayReplacements,
  }));
}

function createOnEnterStageAutoSources(
  game: GameState,
  events: readonly EnterStageEvent[] | undefined,
  onEnterSources: readonly OnEnterAbilitySource[] | undefined
): readonly OnEnterStageAutoSource[] {
  const enterEvents = events ?? createEnterStageEventsFromOnEnterSources(game, onEnterSources);
  if (enterEvents.length === 0) {
    return [];
  }

  const sources: OnEnterStageAutoSource[] = [];
  for (const event of enterEvents) {
    const enteredCard = getCardById(game, event.cardInstanceId);
    if (!enteredCard) {
      continue;
    }

    const player = getPlayerById(game, event.controllerId);
    if (!player) {
      continue;
    }

    for (const sourceSlot of MEMBER_SLOT_ORDER) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      if (!sourceCardId) {
        continue;
      }

      sources.push({
        sourceCardId,
        controllerId: player.id,
        sourceSlot,
        enteredCardId: event.cardInstanceId,
        enteredControllerId: event.controllerId,
        eventId: event.eventId,
      });
    }
  }

  return sources;
}

function createEnterStageEventsFromOnEnterSources(
  game: GameState,
  onEnterSources: readonly OnEnterAbilitySource[] | undefined
): readonly EnterStageEvent[] {
  const sources = onEnterSources ?? getLatestPlayMemberOnEnterSources(game);
  return sources.flatMap((source) => {
    if (source.sourceSlot === null) {
      return [];
    }
    const card = getCardById(game, source.cardId);
    if (!card) {
      return [];
    }
    return [
      {
        eventId: source.eventId,
        eventType: TriggerCondition.ON_ENTER_STAGE,
        timestamp: 0,
        cardInstanceId: source.cardId,
        fromZone: source.fromZone ?? ZoneType.HAND,
        toZone: ZoneType.MEMBER_SLOT,
        toSlot: source.sourceSlot,
        ownerId: card.ownerId,
        controllerId: source.controllerId,
        triggerPlayerId: source.controllerId,
        replacedMemberCardId: source.replacedMemberCardId,
        replacedMemberEffectiveCost: source.replacedMemberEffectiveCost,
        relayReplacements: source.relayReplacements,
      },
    ];
  });
}

const hasBladeHeart = hasBladeHeartSelector();

function enqueueSingleOnEnterCardEffect(game: GameState, source: OnEnterAbilitySource): GameState {
  const sourceCard = getCardById(game, source.cardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = [
    ...getQueuedAbilityDefinitionsForCard(
      sourceCard.data.cardCode,
      CardAbilityCategory.ON_ENTER,
      CardAbilitySourceZone.PLAYED_MEMBER,
      source.sourceSlot
    ),
    ...getQueuedAbilityDefinitionsForCard(
      sourceCard.data.cardCode,
      CardAbilityCategory.ON_ENTER,
      CardAbilitySourceZone.STAGE_MEMBER,
      source.sourceSlot
    ),
  ];
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (
      abilityId === BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID &&
      !isBp5007NozomiLowerCostRelayOnEnter(sourceCard, source)
    ) {
      continue;
    }
    const pendingAbilityId = `${abilityId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingMetadata =
      source.fromZone !== undefined ||
      source.replacedMemberCardId ||
      source.replacedMemberEffectiveCost !== undefined ||
      (source.relayReplacements && source.relayReplacements.length > 0)
        ? {
            ...(source.fromZone !== undefined ? { fromZone: source.fromZone } : {}),
            replacedMemberCardId: source.replacedMemberCardId ?? null,
            replacedMemberEffectiveCost: source.replacedMemberEffectiveCost ?? null,
            relayReplacements: source.relayReplacements ?? [],
          }
        : undefined;

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.cardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [source.eventId],
      sourceSlot: source.sourceSlot ?? undefined,
      metadata: pendingMetadata,
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.cardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        fromZone: source.fromZone ?? null,
        replacedMemberCardId: source.replacedMemberCardId ?? null,
        replacedMemberEffectiveCost: source.replacedMemberEffectiveCost ?? null,
        relayReplacements: source.relayReplacements ?? [],
      }
    );
  }

  return state;
}

function getRelayReplacementsFromPayload(
  value: unknown
): readonly RelayReplacementMetadata[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const replacements = value.flatMap((entry): RelayReplacementMetadata[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    const cardId = typeof candidate.cardId === 'string' ? candidate.cardId : null;
    const slot = toSlotPosition(candidate.slot);
    const effectiveCost =
      typeof candidate.effectiveCost === 'number' ? candidate.effectiveCost : null;
    if (!cardId || slot === null || effectiveCost === null) {
      return [];
    }
    return [{ cardId, slot, effectiveCost }];
  });

  return replacements.length > 0 ? replacements : undefined;
}

function isBp5007NozomiLowerCostRelayOnEnter(
  sourceCard: CardInstance,
  source: OnEnterAbilitySource
): boolean {
  return (
    isMemberCardData(sourceCard.data) &&
    source.replacedMemberCardId !== undefined &&
    source.replacedMemberEffectiveCost !== undefined &&
    source.replacedMemberEffectiveCost < sourceCard.data.cost
  );
}

function enqueueOnEnterStageAutoCardEffects(
  game: GameState,
  sources: readonly OnEnterStageAutoSource[]
): GameState {
  let state = game;
  for (const source of sources) {
    state = enqueueSingleOnEnterStageAutoCardEffect(state, source);
  }
  return state;
}

function enqueueSingleOnEnterStageAutoCardEffect(
  game: GameState,
  source: OnEnterStageAutoSource
): GameState {
  const sourceCard = getCardById(game, source.sourceCardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter(
    (ability) =>
      ability.triggerCondition === TriggerCondition.ON_ENTER_STAGE &&
      doesOnEnterStageAutoTriggerMatchAbilityDefinition(game, source, ability)
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (!canUseAbilityThisTurn(state, source.controllerId, abilityId, source.sourceCardId)) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.sourceCardId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.sourceCardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [source.eventId],
      sourceSlot: source.sourceSlot,
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.sourceCardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        enteredCardId: source.enteredCardId,
      }
    );
  }

  return state;
}

function doesOnEnterStageAutoTriggerMatchAbilityDefinition(
  game: GameState,
  source: OnEnterStageAutoSource,
  ability: CardAbilityDefinition
): boolean {
  const filter = ability.onEnterStageTriggerFilter;
  if (!filter) {
    return true;
  }

  if (filter.enteredController === 'SELF' && source.enteredControllerId !== source.controllerId) {
    return false;
  }
  if (filter.enteredController === 'OPPONENT' && source.enteredControllerId === source.controllerId) {
    return false;
  }
  if (filter.excludeEnteredCardAsSource === true && source.enteredCardId === source.sourceCardId) {
    return false;
  }
  if (
    filter.enteredOrdinalThisTurn !== undefined &&
    getMemberEntryOrdinalForEvent(game, source.controllerId, source.eventId) !==
      filter.enteredOrdinalThisTurn
  ) {
    return false;
  }

  const enteredCard = getCardById(game, source.enteredCardId);
  if (!enteredCard) {
    return false;
  }
  if (filter.enteredCardType && enteredCard.data.cardType !== filter.enteredCardType) {
    return false;
  }
  if (
    filter.enteredGroupAliases &&
    filter.enteredGroupAliases.length > 0 &&
    !filter.enteredGroupAliases.some((groupAlias) => groupAliasIs(groupAlias)(enteredCard))
  ) {
    return false;
  }
  if (
    filter.enteredUnitAliases &&
    filter.enteredUnitAliases.length > 0 &&
    !filter.enteredUnitAliases.some((unitAlias) => unitAliasIs(unitAlias)(enteredCard))
  ) {
    return false;
  }

  return true;
}

function enqueueLiveStartCardEffects(
  game: GameState,
  liveStartEvents: readonly LiveStartEvent[] = []
): GameState {
  const liveStartEvent = liveStartEvents.at(-1);
  const performingPlayerId =
    liveStartEvent?.performerId ??
    game.liveResolution.performingPlayerId ??
    game.players[game.activePlayerIndex]?.id;
  const player = performingPlayerId ? getPlayerById(game, performingPlayerId) : null;
  if (!player) {
    return game;
  }

  const liveCardIds = liveStartEvent?.liveCardIds ?? player.liveZone.cardIds;
  const liveStartEventId =
    liveStartEvent?.eventId ?? `live-start:${game.turnCount}:${performingPlayerId}`;
  let state = game;
  const sourceEntries: AbilitySourceEntry[] = [
    ...MEMBER_SLOT_ORDER.flatMap((sourceSlot) => {
      const cardId = player.memberSlots.slots[sourceSlot];
      return cardId
        ? [
            {
              cardId,
              sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
              sourceSlot,
            },
          ]
        : [];
    }),
    ...liveCardIds.map((cardId) => ({
      cardId,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
    })),
  ];
  for (const sourceEntry of sourceEntries) {
    const sourceCardId = sourceEntry.cardId;
    const sourceCard = getCardById(state, sourceCardId);
    const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.LIVE_START,
      sourceEntry.sourceZone,
      sourceEntry.sourceSlot
    );
    if (!sourceCard || abilityDefinitions.length === 0) {
      continue;
    }

    for (const abilityDefinition of abilityDefinitions) {
      const abilityId = abilityDefinition.abilityId;
      if (
        isLiveStartAbilitySuppressed({
          game: state,
          performingPlayerId: player.id,
          liveCardIds,
          sourceCardId,
          sourceZone: sourceEntry.sourceZone,
          sourceSlot: sourceEntry.sourceSlot,
          abilityDefinition,
        })
      ) {
        continue;
      }
      const pendingAbilityId = `${abilityId}:${sourceCardId}:turn-${state.turnCount}:live-${performingPlayerId}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: sourceCard.ownerId,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: [liveStartEventId],
        sourceSlot: sourceEntry.sourceSlot ?? undefined,
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        pendingAbility.controllerId,
        {
          pendingAbilityId,
          abilityId: pendingAbility.abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          sourceSlot: sourceEntry.sourceSlot,
        }
      );
    }
  }

  return state;
}

function enqueueCheerCardEffects(
  game: GameState,
  cheerEvents: readonly CheerEvent[] = []
): GameState {
  const cheerEvent = cheerEvents.at(-1);
  if (cheerEvent?.additional === true) {
    return game;
  }

  const performingPlayerId =
    cheerEvent?.playerId ??
    game.liveResolution.performingPlayerId ??
    game.players[game.activePlayerIndex]?.id;
  const player = performingPlayerId ? getPlayerById(game, performingPlayerId) : null;
  if (!player) {
    return game;
  }

  const cheerEventId = cheerEvent?.eventId ?? `cheer:${game.turnCount}:${performingPlayerId}`;
  let state = game;
  for (const sourceCardId of player.liveZone.cardIds) {
    const sourceCard = getCardById(state, sourceCardId);
    const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.AUTO,
      CardAbilitySourceZone.LIVE_CARD
    ).filter((ability) => ability.triggerCondition === TriggerCondition.ON_CHEER);
    if (!sourceCard || abilityDefinitions.length === 0) {
      continue;
    }

    for (const abilityDefinition of abilityDefinitions) {
      const abilityId = abilityDefinition.abilityId;
      if (!canUseAbilityThisTurn(state, sourceCard.ownerId, abilityId, sourceCardId)) {
        continue;
      }
      const pendingAbilityId = `${abilityId}:${sourceCardId}:${cheerEventId}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: sourceCard.ownerId,
        mandatory: true,
        timingId: TriggerCondition.ON_CHEER,
        eventIds: [cheerEventId],
        metadata: cheerEvent
          ? {
              revealedCardIds: cheerEvent.revealedCardIds,
              totalBlade: cheerEvent.totalBlade,
              automated: cheerEvent.automated === true,
              additional: cheerEvent.additional ?? false,
            }
          : undefined,
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        pendingAbility.controllerId,
        {
          pendingAbilityId,
          abilityId: pendingAbility.abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          revealedCardIds: cheerEvent?.revealedCardIds,
          totalBlade: cheerEvent?.totalBlade,
          automated: cheerEvent?.automated,
          additional: cheerEvent?.additional,
        }
      );
    }
  }

  return enqueueExactStageMemberCheerCardEffects(state, player.id, cheerEventId, cheerEvent);
}

function enqueueExactStageMemberCheerCardEffects(
  game: GameState,
  playerId: string,
  cheerEventId: string,
  cheerEvent: CheerEvent | undefined
): GameState {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return game;
  }

  let state = game;
  for (const sourceSlot of MEMBER_SLOT_ORDER) {
    const sourceCardId = player.memberSlots.slots[sourceSlot];
    const sourceCard = sourceCardId ? getCardById(state, sourceCardId) : null;
    if (!sourceCardId || !sourceCard) {
      continue;
    }

    const stageCheerAbilityIds = getQueuedAbilityDefinitionsForCard(
      sourceCard.data.cardCode,
      CardAbilityCategory.AUTO,
      CardAbilitySourceZone.STAGE_MEMBER,
      sourceSlot
    )
      .filter((ability) => ability.triggerCondition === TriggerCondition.ON_CHEER)
      .map((ability) => ability.abilityId);
    if (stageCheerAbilityIds.length === 0) {
      continue;
    }

    for (const abilityId of stageCheerAbilityIds) {
      if (!canUseAbilityThisTurn(state, sourceCard.ownerId, abilityId, sourceCardId)) {
        continue;
      }
      const pendingAbilityId = `${abilityId}:${sourceCardId}:${cheerEventId}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: sourceCard.ownerId,
        mandatory: true,
        timingId: TriggerCondition.ON_CHEER,
        eventIds: [cheerEventId],
        sourceSlot,
        metadata: cheerEvent
          ? {
              revealedCardIds: cheerEvent.revealedCardIds,
              totalBlade: cheerEvent.totalBlade,
              automated: cheerEvent.automated === true,
              additional: cheerEvent.additional ?? false,
            }
          : undefined,
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        pendingAbility.controllerId,
        {
          pendingAbilityId,
          abilityId: pendingAbility.abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          sourceSlot,
          revealedCardIds: cheerEvent?.revealedCardIds,
          totalBlade: cheerEvent?.totalBlade,
          automated: cheerEvent?.automated,
          additional: cheerEvent?.additional,
        }
      );
    }
  }

  return state;
}

function enqueueLiveSuccessCardEffects(
  game: GameState,
  liveSuccessEvents: readonly LiveSuccessEvent[] = []
): GameState {
  const liveSuccessEvent = liveSuccessEvents.at(-1);
  const playerId = liveSuccessEvent?.playerId ?? getLiveSuccessEffectPlayerId(game);
  const player = playerId ? getPlayerById(game, playerId) : null;
  if (!player) {
    return game;
  }

  let state = game;
  const successfulLiveCardIds =
    liveSuccessEvent?.successfulLiveCardIds ??
    [...state.liveResolution.liveResults.entries()]
      .filter(([cardId, isSuccess]) => {
        const card = getCardById(state, cardId);
        return isSuccess === true && card?.ownerId === player.id;
      })
      .map(([cardId]) => cardId);
  if (successfulLiveCardIds.length === 0) {
    return game;
  }

  const liveSuccessEventId = liveSuccessEvent?.eventId;
  const sourceEntries: AbilitySourceEntry[] = [
    ...MEMBER_SLOT_ORDER.flatMap((sourceSlot) => {
      const cardId = player.memberSlots.slots[sourceSlot];
      return cardId
        ? [
            {
              cardId,
              sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
              sourceSlot,
            },
          ]
        : [];
    }),
    ...successfulLiveCardIds.map((cardId) => ({
      cardId,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
    })),
    ...collectCurrentRevealedCheerLiveSuccessAbilitySources(state, player.id),
  ];

  for (const sourceEntry of sourceEntries) {
    const sourceCardId = sourceEntry.cardId;
    const sourceCard = getCardById(state, sourceCardId);
    const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.LIVE_SUCCESS,
      sourceEntry.sourceZone,
      sourceEntry.sourceSlot
    );
    if (!sourceCard || abilityDefinitions.length === 0) {
      continue;
    }

    for (const abilityDefinition of abilityDefinitions) {
      const abilityId = abilityDefinition.abilityId;
      if (
        !isLiveSuccessAbilityAvailable({
          game: state,
          controllerId: player.id,
          sourceCardId,
          sourceZone: sourceEntry.sourceZone,
          sourceSlot: sourceEntry.sourceSlot,
          abilityDefinition,
        })
      ) {
        continue;
      }
      if (isLiveAbilitySuppressed(state, sourceCardId, abilityId)) {
        continue;
      }
      if (
        abilityDefinition.skipQueueWhenTurnLimitReached === true &&
        !canUseAbilityThisTurn(state, sourceCard.ownerId, abilityId, sourceCardId)
      ) {
        continue;
      }
      const pendingAbilityId = `${abilityId}:${sourceCardId}:turn-${state.turnCount}:live-success-${player.id}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: player.id,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: [
          liveSuccessEventId ?? `live-success:${state.turnCount}:${player.id}:${sourceCardId}`,
        ],
        sourceSlot: sourceEntry.sourceSlot ?? undefined,
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        pendingAbility.controllerId,
        {
          pendingAbilityId,
          abilityId: pendingAbility.abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          sourceSlot: sourceEntry.sourceSlot,
        }
      );
    }
  }

  return state;
}

function getLiveSuccessEffectPlayerId(game: GameState): string | null {
  if (game.currentSubPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS) {
    return game.players[game.firstPlayerIndex]?.id ?? null;
  }

  if (game.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS) {
    return game.players[game.firstPlayerIndex === 0 ? 1 : 0]?.id ?? null;
  }

  return game.liveResolution.performingPlayerId ?? game.players[game.activePlayerIndex]?.id ?? null;
}

export function resolvePendingCardEffects(game: GameState): CardEffectRunnerResult {
  if (game.activeEffect) {
    return {
      gameState: game,
      resolvedAbilityIds: [],
    };
  }

  const stateWithEnergyPlacedTriggers = enqueueLatestResolvedEnergyPlacedByCardEffectTriggers(game);
  if (stateWithEnergyPlacedTriggers !== game) {
    return resolvePendingCardEffects(stateWithEnergyPlacedTriggers);
  }

  const stateWithResolvedAbilityObservers = enqueueResolvedAbilityObserverCardEffects(game);
  if (stateWithResolvedAbilityObservers !== game) {
    return resolvePendingCardEffects(stateWithResolvedAbilityObservers);
  }

  const pendingAbilities = getCurrentCheckTimingAbilityCandidates(game);
  const ability = pendingAbilities[0];
  if (!ability) {
    return {
      gameState: game,
      resolvedAbilityIds: [],
    };
  }

  const immediateObserverAbility = pendingAbilities.find(isImmediateResolvedObserverAbility);
  if (immediateObserverAbility) {
    return {
      gameState: startPendingAbilityEffect(game, immediateObserverAbility, {
        skipManualConfirmation: true,
      }),
      resolvedAbilityIds: [immediateObserverAbility.id],
    };
  }

  if (pendingAbilities.length > 1) {
    if (shouldProcessSameAbilitySourceQueueInOrder(pendingAbilities)) {
      return {
        gameState: startPendingAbilityEffect(game, ability),
        resolvedAbilityIds: [ability.id],
      };
    }
    return {
      gameState: startAbilityOrderSelection(game, pendingAbilities),
      resolvedAbilityIds: [],
    };
  }

  return {
    gameState: startPendingAbilityEffect(game, ability, {
      confirmBeforeResolution:
        pendingAbilities.length === 1 && shouldConfirmSingleLivePendingAbility(ability),
    }),
    resolvedAbilityIds: [ability.id],
  };
}

export function confirmActiveEffectStep(
  game: GameState,
  playerId: string,
  effectId: string,
  selectedCardId?: string | null,
  selectedSlot?: SlotPosition | null,
  resolveInOrder?: boolean,
  selectedOptionId?: string | null,
  selectedCardIds?: readonly string[],
  selectedNumber?: number | null,
  stageFormationMoveHistory?: readonly {
    readonly cardId: string;
    readonly toSlot: SlotPosition;
  }[],
  stageFormationPlacements?: readonly {
    readonly cardId: string;
    readonly toSlot: SlotPosition;
  }[]
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  if (effect.id !== effectId || effect.awaitingPlayerId !== playerId) {
    return game;
  }
  if (effect.abilityId === ABILITY_ORDER_SELECTION_ID) {
    return selectPendingAbilityOrder(
      game,
      selectedCardId,
      resolveInOrder === true,
      selectedOptionId
    );
  }
  if (effect.metadata?.confirmOnlyPendingAbility === true) {
    return finishConfirmOnlyPendingAbilityEffect(game, startPendingAbilityEffect);
  }

  const registryResult = resolveActiveEffectStepWithRegistry(
    game,
    {
      selectedCardId,
      selectedSlot,
      resolveInOrder,
      selectedOptionId,
      selectedCardIds,
      selectedNumber,
      stageFormationMoveHistory,
      stageFormationPlacements,
    },
    {
      continuePendingCardEffects,
      delegatePendingAbility,
      resolveActivatedAbility: resolveActivatedAbilityWithRegistry,
      resolvePendingAbilityStarter: (state, ability, options) =>
        resolvePendingAbilityStarterWithRegistry(state, ability, options, {
          continuePendingCardEffects,
          delegatePendingAbility,
        }),
    }
  );
  if (registryResult) {
    return registryResult;
  }

  return game;
}

export function activateCardAbility(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): GameState {
  if (!canUseActivatedAbilityThisTurn(game, playerId, abilityId, cardId)) {
    return game;
  }

  const registryResult = resolveActivatedAbilityWithRegistry(game, playerId, cardId, abilityId);
  if (registryResult) {
    return registryResult;
  }

  return game;
}

function enqueueLatestResolvedEnergyPlacedByCardEffectTriggers(game: GameState): GameState {
  const latestResolvedAction = game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY')
    .at(-1);
  const resolvedAbilityId =
    typeof latestResolvedAction?.payload.abilityId === 'string'
      ? latestResolvedAction.payload.abilityId
      : null;
  const resolvedSourceCardId =
    typeof latestResolvedAction?.payload.sourceCardId === 'string'
      ? latestResolvedAction.payload.sourceCardId
      : null;
  if (!resolvedAbilityId || !resolvedSourceCardId) {
    return game;
  }

  const alreadyTriggeredEventIds = getAlreadyTriggeredEventIds(game);
  const events = getEnergyPlacedByCardEffectEventsFromLog(game).filter(
    (event) =>
      event.cause.abilityId === resolvedAbilityId &&
      event.cause.sourceCardId === resolvedSourceCardId &&
      !alreadyTriggeredEventIds.has(event.eventId)
  );
  if (events.length === 0) {
    return game;
  }

  return enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT], {
    energyPlacedByCardEffectEvents: events,
  });
}

function getAlreadyTriggeredEventIds(game: GameState): ReadonlySet<string> {
  return new Set(
    game.actionHistory
      .filter((action) => action.type === 'TRIGGER_ABILITY')
      .map((action) => action.payload.eventId)
      .filter((eventId): eventId is string => typeof eventId === 'string')
  );
}

function getSupportedPendingAbilities(game: GameState): readonly PendingAbilityState[] {
  return game.pendingAbilities.filter((candidate) =>
    IMPLEMENTED_QUEUED_ABILITY_IDS.has(candidate.abilityId)
  );
}

function startAbilityOrderSelection(
  game: GameState,
  abilities: readonly PendingAbilityState[]
): GameState {
  const firstAbility = abilities[0];
  const sourceCardIds = abilities.map((ability) => ability.sourceCardId);
  const hasDuplicateSourceCards = new Set(sourceCardIds).size !== sourceCardIds.length;
  return {
    ...game,
    activeEffect: {
      id: `${ABILITY_ORDER_SELECTION_ID}:${firstAbility.timingId}:${firstAbility.controllerId}`,
      abilityId: ABILITY_ORDER_SELECTION_ID,
      sourceCardId: firstAbility.sourceCardId,
      controllerId: firstAbility.controllerId,
      effectText: '请选择下一个要发动的效果。也可以选择“顺序发动”，按当前队列顺序依次处理。',
      stepId: ABILITY_ORDER_SELECTION_STEP_ID,
      stepText: '选择下一个待处理效果',
      awaitingPlayerId: firstAbility.controllerId,
      selectableCardIds: hasDuplicateSourceCards ? undefined : sourceCardIds,
      selectableOptions: hasDuplicateSourceCards
        ? abilities.map((ability, index) => ({
            id: ability.id,
            label: getAbilityOrderOptionLabel(game, ability, index),
          }))
        : undefined,
      canResolveInOrder: true,
      metadata: {
        pendingAbilityIds: abilities.map((ability) => ability.id),
        usesAbilityOptions: hasDuplicateSourceCards,
      },
    },
  };
}

function selectPendingAbilityOrder(
  game: GameState,
  selectedCardId: string | null | undefined,
  resolveInOrder: boolean,
  selectedOptionId?: string | null
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ORDER_SELECTION_ID) {
    return game;
  }

  const pendingAbilityIds = Array.isArray(effect.metadata?.pendingAbilityIds)
    ? effect.metadata.pendingAbilityIds.filter((id): id is string => typeof id === 'string')
    : [];
  const candidates = game.pendingAbilities.filter((ability) =>
    pendingAbilityIds.includes(ability.id)
  );
  const selectedAbility = resolveInOrder
    ? candidates[0]
    : selectedOptionId
      ? candidates.find((ability) => ability.id === selectedOptionId)
      : candidates.find((ability) => ability.sourceCardId === selectedCardId);

  if (!selectedAbility) {
    return game;
  }

  const stateWithoutSelection = {
    ...game,
    activeEffect: null,
  };
  if (!resolveInOrder) {
    return startPendingAbilityEffect(stateWithoutSelection, selectedAbility, {
      manualConfirmation: true,
    });
  }

  const batchId = effect.id;
  const stateWithOrderedBatch = {
    ...stateWithoutSelection,
    pendingAbilities: stateWithoutSelection.pendingAbilities.map((ability) =>
      pendingAbilityIds.includes(ability.id)
        ? {
            ...ability,
            metadata: {
              ...ability.metadata,
              [ORDERED_RESOLUTION_BATCH_ID_KEY]: batchId,
            },
          }
        : ability
    ),
  };
  const markedSelectedAbility = stateWithOrderedBatch.pendingAbilities.find(
    (ability) => ability.id === selectedAbility.id
  );
  return markedSelectedAbility
    ? startPendingAbilityEffect(stateWithOrderedBatch, markedSelectedAbility, {
        orderedResolution: true,
      })
    : game;
}

function getAbilityOrderOptionLabel(
  game: GameState,
  ability: PendingAbilityState,
  index: number
): string {
  const sourceCard = getCardById(game, ability.sourceCardId);
  const abilityDefinition = findCardAbilityDefinitionById(ability.abilityId);
  const cardName = sourceCard?.data.name ?? '未知卡牌';
  return `${index + 1}. ${cardName}：${abilityDefinition?.effectText ?? ability.abilityId}`;
}

function continuePendingCardEffects(game: GameState, orderedResolution: boolean): GameState {
  if (game.activeEffect) {
    return game;
  }

  if (game.checkTimingContext) {
    const stateWithAdvancedIteration = advanceCheckTimingIteration(game);
    const stateAfterRuleProcessing = processCheckTimingRuleActionsAndDispatchTriggers(
      stateWithAdvancedIteration
    );
    if (stateAfterRuleProcessing !== stateWithAdvancedIteration) {
      if (stateAfterRuleProcessing.endInfo) {
        return stateAfterRuleProcessing;
      }
      return continuePendingCardEffects(stateAfterRuleProcessing, orderedResolution);
    }
    game = stateWithAdvancedIteration;
  }

  const stateWithEnergyPlacedTriggers = enqueueLatestResolvedEnergyPlacedByCardEffectTriggers(game);
  if (stateWithEnergyPlacedTriggers !== game) {
    return continuePendingCardEffects(stateWithEnergyPlacedTriggers, orderedResolution);
  }

  const stateWithMoveTriggers = enqueueUntriggeredEnterHandAndLiveZoneCardEffects(game);
  if (stateWithMoveTriggers !== game) {
    return continuePendingCardEffects(stateWithMoveTriggers, orderedResolution);
  }

  const stateWithResolvedAbilityObservers = enqueueResolvedAbilityObserverCardEffects(game);
  if (stateWithResolvedAbilityObservers !== game) {
    return continuePendingCardEffects(stateWithResolvedAbilityObservers, orderedResolution);
  }

  const pendingAbilities = getCurrentCheckTimingAbilityCandidates(game);
  if (pendingAbilities.length === 0) {
    return closeCheckTimingContextIfIdle(game);
  }

  if (!game.checkTimingContext) {
    return continuePendingCardEffects(openCheckTimingContext(game), orderedResolution);
  }

  const immediateObserverAbility = pendingAbilities.find(isImmediateResolvedObserverAbility);
  if (immediateObserverAbility) {
    return startPendingAbilityEffect(game, immediateObserverAbility, {
      orderedResolution,
      skipManualConfirmation: true,
    });
  }

  if (orderedResolution && canContinueOrderedResolution(pendingAbilities)) {
    return startPendingAbilityEffect(game, pendingAbilities[0], { orderedResolution: true });
  }

  const nextAbility = pendingAbilities[0];

  if (
    pendingAbilities.length > 1 &&
    shouldProcessSameAbilitySourceQueueInOrder(pendingAbilities)
  ) {
    return startPendingAbilityEffect(game, nextAbility);
  }

  return pendingAbilities.length > 1
    ? startAbilityOrderSelection(game, pendingAbilities)
    : startPendingAbilityEffect(game, nextAbility, {
        confirmBeforeResolution:
          pendingAbilities.length === 1 && shouldConfirmSingleLivePendingAbility(nextAbility),
      });
}

function processCheckTimingRuleActionsAndDispatchTriggers(game: GameState): GameState {
  const result = processCheckTimingRuleActions(game);
  if (result.gameEnded) {
    return result.gameState;
  }
  if (result.energyMovedToDeckEvents.length === 0) {
    return result.gameState;
  }
  return enqueueTriggeredCardEffects(
    result.gameState,
    [TriggerCondition.ON_ENERGY_MOVED_TO_DECK],
    { energyMovedToDeckEvents: result.energyMovedToDeckEvents }
  );
}

function getCurrentCheckTimingAbilityCandidates(
  game: GameState
): readonly PendingAbilityState[] {
  return getCheckTimingAbilityCandidates(game, getSupportedPendingAbilities(game));
}

function canContinueOrderedResolution(
  abilities: readonly PendingAbilityState[]
): boolean {
  if (abilities.length === 0) {
    return false;
  }
  const batchIds = abilities.map((ability) =>
    typeof ability.metadata?.[ORDERED_RESOLUTION_BATCH_ID_KEY] === 'string'
      ? ability.metadata[ORDERED_RESOLUTION_BATCH_ID_KEY]
      : null
  );
  const batchId = batchIds[0];
  return batchId !== null && batchIds.every((candidate) => candidate === batchId);
}

function shouldConfirmSingleLivePendingAbility(ability: PendingAbilityState): boolean {
  return (
    ability.timingId === TriggerCondition.ON_LIVE_START ||
    ability.timingId === TriggerCondition.ON_LIVE_SUCCESS
  );
}

function shouldProcessSameAbilitySourceQueueInOrder(
  abilities: readonly PendingAbilityState[]
): boolean {
  const firstAbility = abilities[0];
  if (!firstAbility) {
    return false;
  }
  const definition = findCardAbilityDefinitionById(firstAbility.abilityId);
  return (
    definition?.countPendingAsTurnUse === false &&
    abilities.every(
      (ability) =>
        ability.abilityId === firstAbility.abilityId &&
        ability.sourceCardId === firstAbility.sourceCardId &&
        ability.controllerId === firstAbility.controllerId &&
        ability.timingId === firstAbility.timingId
    )
  );
}

function isImmediateResolvedObserverAbility(ability: PendingAbilityState): boolean {
  return ability.metadata?.resolvedObserverImmediate === true;
}

function skipPendingAbilityWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      sourceSlot: ability.sourceSlot,
    }),
    orderedResolution
  );
}

function isOrderedResolutionEffect(game: GameState): boolean {
  return game.activeEffect?.metadata?.orderedResolution === true;
}

function startPendingAbilityEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const registryResult = resolvePendingAbilityStarterWithRegistry(game, ability, options, {
    continuePendingCardEffects,
    delegatePendingAbility,
  });
  if (registryResult) {
    return registryResult;
  }

  return game;
}

function delegatePendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  if (game.activeEffect) {
    return game;
  }
  if (game.pendingAbilities.some((candidate) => candidate.id === ability.id)) {
    return game;
  }
  return startPendingAbilityEffect(game, ability, {
    ...options,
    manualConfirmation: false,
    skipManualConfirmation: true,
  });
}

function finishSelectCardsFromZoneToHandEffect(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined = undefined
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const orderedSelections =
    Array.isArray(selectedCardIds) && selectedCardIds.length > 0 ? selectedCardIds : [];
  const selectedCardIdsToMove =
    orderedSelections.length > 0
      ? orderedSelections
      : selectedCardId !== null
        ? [selectedCardId]
        : [];
  const uniqueSelectedCardIds = [...new Set(selectedCardIdsToMove)];
  if (uniqueSelectedCardIds.length !== selectedCardIdsToMove.length) {
    return game;
  }
  const zoneSelection = getZoneSelectionConfig(effect);
  if (
    uniqueSelectedCardIds.length < zoneSelection.minCount ||
    uniqueSelectedCardIds.length > zoneSelection.maxCount
  ) {
    return game;
  }
  const selectedAreValid = uniqueSelectedCardIds.every(
    (cardId) =>
      effect.selectableCardIds?.includes(cardId) === true &&
      player.waitingRoom.cardIds.includes(cardId)
  );
  if (!selectedAreValid) {
    return game;
  }
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      minCount: zoneSelection.minCount,
      maxCount: zoneSelection.maxCount,
    }
  );
  if (!recoveryResult) {
    return game;
  }
  let state = recoveryResult.gameState;
  state = { ...state, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      selectedCardIds: recoveryResult.movedCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function finishSkipEffect(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const state = { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SKIP',
    }),
    isOrderedResolutionEffect(game)
  );
}

interface StageMemberLocation {
  readonly playerId: string;
  readonly cardId: string;
  readonly slot: SlotPosition;
}

function getStageMemberLocations(game: GameState): readonly StageMemberLocation[] {
  return game.players.flatMap((player) =>
    MEMBER_SLOT_ORDER.flatMap((slot) => {
      const cardId = player.memberSlots.slots[slot];
      return cardId ? [{ playerId: player.id, cardId, slot }] : [];
    })
  );
}

function findStageMemberLocation(game: GameState, cardId: string): StageMemberLocation | null {
  return getStageMemberLocations(game).find((location) => location.cardId === cardId) ?? null;
}

function findMemberSlot(
  player: { memberSlots: { slots: Readonly<Record<SlotPosition, string | null>> } },
  cardId: string
): SlotPosition | null {
  for (const slot of Object.values(SlotPosition)) {
    if (player.memberSlots.slots[slot] === cardId) {
      return slot;
    }
  }
  return null;
}
