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
import { addLiveModifier } from '../domain/rules/live-modifiers.js';
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
} from './effects/card-selectors.js';
import {
  countCardsMatchingSelector,
  countStageMembers,
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
import { isLiveStartAbilitySuppressed } from './card-effects/runtime/live-start-suppression-gates.js';
import { enqueueMemberSlotMovedObserverCardEffects } from './card-effects/runtime/member-slot-moved-observers.js';
import { enqueueResolvedAbilityObserverCardEffects } from './card-effects/runtime/resolved-ability-observers.js';
import { resolvePendingAbilityStarterWithRegistry } from './card-effects/runtime/starter-registry.js';
import { resolveActiveEffectStepWithRegistry } from './card-effects/runtime/step-registry.js';
import { registerBp5003KotoriWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-003-kotori.js';
import { registerBp5007NozomiWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-007-nozomi.js';
import { registerBp5005RinWorkflowHandlers } from './card-effects/workflows/cards/pl-bp5-005-rin.js';
import { registerBp6003KotoriWorkflowHandlers } from './card-effects/workflows/cards/pl-bp6-003-kotori.js';
import { registerBp6020DancingStarsWorkflowHandlers } from './card-effects/workflows/cards/pl-bp6-020-dancing-stars-on-me.js';
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
import { registerSFutureWaterFinalWorkflowHandlers } from './card-effects/workflows/cards/s-bp6-002-riko.js';
import { registerHsBp5003RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-003-rurino.js';
import { registerHsBp5002SayakaWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-002-sayaka.js';
import { registerHsBp5005KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-005-kosuzu.js';
import { registerHsBp5006HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-006-hime.js';
import { registerHsBp5007SerasWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-007-seras.js';
import { registerHsBp5016IzumiWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-016-izumi.js';
import { registerHsBp5001KahoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-001-kaho.js';
import { registerHsBp5021JoshoKiryuWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-021-josho-kiryu.js';
import { registerHsBp5022RetrofutureWorkflowHandlers } from './card-effects/workflows/cards/hs-bp5-022-retrofuture.js';
import { registerWaitDiscardLookTopSelectToHandWorkflowHandlers } from './card-effects/workflows/shared/wait-discard-look-top-select-to-hand.js';
import { registerHsPb1004GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-004-ginko.js';
import { registerHsPb1002SayakaWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-002-sayaka.js';
import { registerHsPb1012GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-012-ginko.js';
import { registerHsPb1009KahoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-009-kaho.js';
import { registerHsPb1007SerasWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-007-seras.js';
import { registerHsPb1006HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-006-hime.js';
import { registerHsPb1014HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-014-hime.js';
import { registerHsPb1021KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-021-kosuzu.js';
import { registerHsPb1005KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-005-kosuzu.js';
import { registerHsPb1029ZenhouiKyunWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-029-zenhoui-kyun.js';
import { registerHsPb1030EdeliedWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-030-edelied.js';
import { registerHsPb1028CompassWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-028-compass.js';
import { registerHsPb1003RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-pb1-003-rurino.js';
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
import { registerNBp5001AyumuWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-001-ayumu.js';
import { registerNBp5015ShizukuWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-015-shizuku.js';
import { registerNBp5030RyouranVictoryRoadWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-030-ryouran-victory-road.js';
import { registerNBp1026PoppinUpWorkflowHandlers } from './card-effects/workflows/cards/n-bp1-026-poppin-up.js';
import { registerNBp3008EmmaWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-008-emma.js';
import { registerNBp3010ShiorikoWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-010-shioriko.js';
import { registerNBp3027LaBellaPatriaWorkflowHandlers } from './card-effects/workflows/cards/n-bp3-027-la-bella-patria.js';
import { registerNBp4004KarinWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-004-karin.js';
import { registerNBp4029RiseUpHighWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-029-rise-up-high.js';
import { registerNBp4030DaydreamMermaidWorkflowHandlers } from './card-effects/workflows/cards/n-bp4-030-daydream-mermaid.js';
import { registerNDiscardRecoverAndBladeWorkflowHandlers } from './card-effects/workflows/shared/discard-cost-recover-live-or-gain-blade.js';
import { registerNBp5003ShizukuWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-003-shizuku.js';
import { registerNBp5021RinaWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-021-rina.js';
import { registerNPb1006KanataWorkflowHandlers } from './card-effects/workflows/cards/n-pb1-006-kanata.js';
import { registerNPb1011MiaWorkflowHandlers } from './card-effects/workflows/cards/n-pb1-011-mia.js';
import { registerLiveSuccessDiscardRecoverLowCostOrScoreCheerWorkflowHandlers } from './card-effects/workflows/shared/live-success-discard-recover-low-cost-or-score-cheer.js';
import { registerNPr026RinaWorkflowHandlers } from './card-effects/workflows/cards/n-pr-026-rina.js';
import { registerNozomiOnEnterWorkflowHandlers } from './card-effects/workflows/cards/pl-sd1-007-nozomi.js';
import { registerPb1015MakiWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-015-maki.js';
import { registerPlBp3026OhLovePeaceWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-026-oh-love-peace.js';
import { registerPlPb1018NicoWorkflowHandlers } from './card-effects/workflows/cards/pl-pb1-018-nico.js';
import { registerSd1008HanayoWorkflowHandlers } from './card-effects/workflows/cards/pl-sd1-008-hanayo.js';
import {
  isHsSd1001HighCostHasunosoraRelayReplacement,
  registerHsSd1001KahoWorkflowHandlers,
} from './card-effects/workflows/cards/hs-sd1-001-kaho.js';
import { registerHsBp6011RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp6-011-rurino.js';
import { registerHsBp2005RurinoWorkflowHandlers } from './card-effects/workflows/cards/hs-bp2-005-rurino.js';
import { registerHsSd1004GinkoWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-004-ginko.js';
import { registerHsSd1005KosuzuWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-005-kosuzu.js';
import { registerHsSd1006HimeWorkflowHandlers } from './card-effects/workflows/cards/hs-sd1-006-hime.js';
import { registerEmmaWorkflowHandlers } from './card-effects/workflows/cards/n-pb1-008-emma.js';
import { registerLlBp6001KotoriDiaKosuzuWorkflowHandlers } from './card-effects/workflows/cards/ll-bp6-001-kotori-dia-kosuzu.js';
import { registerPlBp3001HonokaWorkflowHandlers } from './card-effects/workflows/cards/pl-bp3-001-honoka.js';
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
import { registerPr017NicoWorkflowHandlers } from './card-effects/workflows/cards/pl-pr-017-nico.js';
import { registerNBp5007SetsunaWorkflowHandlers } from './card-effects/workflows/cards/n-bp5-007-setsuna.js';
import { registerSBp2024KimikokoWorkflowHandlers } from './card-effects/workflows/cards/s-bp2-024-kimikoko.js';
import { registerSBp5020LandingActionYeahWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-020-landing-action-yeah.js';
import { registerSBp5111SeiraWorkflowHandlers } from './card-effects/workflows/cards/s-bp5-111-seira.js';
import { registerSpBp2009NatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-009-natsumi.js';
import { registerSpBp2010MargareteWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-010-margarete.js';
import { registerSpBp1024TinyStarsWorkflowHandlers } from './card-effects/workflows/cards/sp-bp1-024-tiny-stars.js';
import { registerSpBp2001KanonWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-001-kanon.js';
import { registerSpBp2024VitaminSummerWorkflowHandlers } from './card-effects/workflows/cards/sp-bp2-024-vitamin-summer.js';
import { registerSpBp4001KanonWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-001-kanon.js';
import { registerSpBp4004SumireWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-004-sumire.js';
import { registerStageMemberWaitingEnergyPlacementWorkflowHandlers } from './card-effects/workflows/shared/stage-member-waiting-energy-placement.js';
import { registerSpBp4024NonfictionWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-024-nonfiction.js';
import { registerSpBp4025SpecialColorWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-025-special-color.js';
import { registerShikiWorkflowHandlers } from './card-effects/workflows/cards/sp-bp4-008-shiki.js';
import { registerSpBp5001KanonWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-001-kanon.js';
import { registerSpBp5004SumireWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-004-sumire.js';
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
import { registerSpPb1006KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-006-kinako.js';
import { registerSpPb1008ShikiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-008-shiki.js';
import { registerSpPb1020NatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb1-020-natsumi.js';
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
import { registerSpPr020KinakoWorkflowHandlers } from './card-effects/workflows/cards/sp-pr-020-kinako.js';
import { registerSpPb2000ChisatoNatsumiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-000-chisato-natsumi.js';
import { registerSpPb2045ZettaiLoverWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-045-zettai-lover.js';
import { registerSpPb2046ButterflyWingWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-046-butterfly-wing.js';
import { registerSpPb2047WelcomeToBokuraNoSekaiWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-047-welcome-to-bokura-no-sekai.js';
import { registerSpPb2048DistortionWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-048-distortion.js';
import { registerSpPb2049NeutralWorkflowHandlers } from './card-effects/workflows/cards/sp-pb2-049-neutral.js';
import { registerChisatoWorkflowHandlers } from './card-effects/workflows/cards/sp-bp5-003-chisato.js';
import { registerSpBp4MovedSideBladeWorkflowHandlers } from './card-effects/workflows/shared/moved-side-blade.js';
import { registerSpSd2011TomariWorkflowHandlers } from './card-effects/workflows/cards/sp-sd2-011-tomari.js';
import { registerSpSd2003ChisatoWorkflowHandlers } from './card-effects/workflows/cards/sp-sd2-003-chisato.js';
import { registerSpSd2023HajimariWaKimiNoSoraWorkflowHandlers } from './card-effects/workflows/cards/sp-sd2-023-hajimari-wa-kimi-no-sora.js';
import { registerSpSd2025AspireWorkflowHandlers } from './card-effects/workflows/cards/sp-sd2-025-aspire.js';
import { registerYoshikoPlayLowCostMembersWorkflowHandlers } from './card-effects/workflows/cards/s-bp2-006-yoshiko.js';
import { registerArrangeInspectedDeckTopWorkflowHandlers } from './card-effects/workflows/shared/arrange-inspected-deck-top.js';
import { registerConditionalLiveModifierWorkflowHandlers } from './card-effects/workflows/shared/conditional-live-modifier.js';
import { registerDiscardCostWaitingRoomToHandWorkflowHandlers } from './card-effects/workflows/shared/discard-cost-waiting-room-to-hand.js';
import { registerDiscardLookTopSelectToHandWorkflowHandlers } from './card-effects/workflows/shared/discard-look-top-select-to-hand.js';
import { registerDrawThenDiscardWorkflowHandlers } from './card-effects/workflows/shared/draw-then-discard.js';
import { registerGroupedRecoveryWorkflowHandlers } from './card-effects/workflows/shared/grouped-recovery.js';
import { registerLookTopSelectToHandWorkflowHandlers } from './card-effects/workflows/shared/look-top-select-to-hand.js';
import { registerActivatedPayEnergySelfPositionChangeWorkflowHandlers } from './card-effects/workflows/shared/activated-pay-energy-self-position-change.js';
import { registerActivatedWaitSelfDiscardDrawWorkflowHandlers } from './card-effects/workflows/shared/activated-wait-self-discard-draw.js';
import { registerLiveStartDiscardGainHeartWorkflowHandlers } from './card-effects/workflows/shared/live-start-discard-gain-heart.js';
import { registerLiveStartDiscardSameUnitGainHeartBladeWorkflowHandlers } from './card-effects/workflows/shared/live-start-discard-same-unit-gain-heart-blade.js';
import { registerLiveStartPayEnergyStackWaitingMembersToDeckTopWorkflowHandlers } from './card-effects/workflows/shared/live-start-pay-energy-stack-waiting-members-to-deck-top.js';
import { registerLiveStartReplaceOriginalHeartColorWorkflowHandlers } from './card-effects/workflows/shared/live-start-replace-original-heart-color.js';
import { registerLiveStartSuccessCountChooseHeartWorkflowHandlers } from './card-effects/workflows/shared/live-start-success-count-choose-heart.js';
import { registerMillTopGainLiveModifierWorkflowHandlers } from './card-effects/workflows/shared/mill-top-gain-live-modifier.js';
import { registerNamedHandDiscardLiveStartWorkflowHandlers } from './card-effects/workflows/shared/named-hand-discard-live-start.js';
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
  N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID,
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
  SP_PB2_020_AUTO_ON_CHEER_DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER_ABILITY_ID,
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
interface EnqueueTriggeredCardEffectsOptions {
  readonly onEnterSources?: readonly OnEnterAbilitySource[];
  readonly enterStageEvents?: readonly EnterStageEvent[];
  readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
  readonly onLeaveStageSources?: readonly OnLeaveStageAbilitySource[];
  readonly leaveStageEvents?: readonly LeaveStageEvent[];
  readonly liveStartEvents?: readonly LiveStartEvent[];
  readonly liveSuccessEvents?: readonly LiveSuccessEvent[];
  readonly cheerEvents?: readonly CheerEvent[];
  readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  readonly memberSlotMovedEvents?: readonly MemberSlotMovedEvent[];
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
  const pendingUses = game.pendingAbilities.filter(
    (ability) =>
      ability.controllerId === playerId &&
      ability.abilityId === abilityId &&
      ability.sourceCardId === sourceCardId
  ).length;
  const activeUse =
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
registerLookTopSelectToHandWorkflowHandlers();
registerActivatedRevealHandNoLiveLookTopLiveWorkflowHandlers();
registerArrangeInspectedDeckTopWorkflowHandlers();
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
registerDrawThenDiscardWorkflowHandlers({ enqueueTriggeredCardEffects });
registerRelayEnterDrawDiscardWorkflowHandlers({ enqueueTriggeredCardEffects });
registerGroupedRecoveryWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNamedHandDiscardLiveStartWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLiveStartDiscardGainHeartWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLiveStartDiscardSameUnitGainHeartBladeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLiveStartPayEnergyStackWaitingMembersToDeckTopWorkflowHandlers();
registerLiveStartReplaceOriginalHeartColorWorkflowHandlers();
registerLiveStartSuccessCountChooseHeartWorkflowHandlers();
registerBp5007NozomiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp6003KotoriWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp6020DancingStarsWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1006HimeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1009KahoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1007SerasWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1014HimeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsPb1021KosuzuWorkflowHandlers();
registerHsPb1005KosuzuWorkflowHandlers();
registerHsPb1028CompassWorkflowHandlers();
registerHsPb1029ZenhouiKyunWorkflowHandlers();
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
registerHsSd1006HimeWorkflowHandlers();
registerHsBp1008KosuzuWorkflowHandlers();
registerHsPb1012GinkoWorkflowHandlers();
registerWaitingRoomToHandWorkflowHandlers();
registerSelfSacrificeWaitingRoomToHandWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPayEnergyGainBladeWorkflowHandlers();
registerPayEnergyGainHeartWorkflowHandlers();
registerOpponentWaitTargetWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPayEnergyWaitingRoomToHandWorkflowHandlers();
registerDiscardCostWaitingRoomToHandWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPr017NicoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerBp5005RinWorkflowHandlers();
registerRevealedCheerSelectionWorkflowHandlers({ continuePendingCardEffects });
registerSelfPositionChangeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerStageFormationChangeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlayWaitingRoomMemberToSourceSlotWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp2014RurinoWorkflowHandlers();
registerHsBp5001KahoWorkflowHandlers();
registerMillTopGainLiveModifierWorkflowHandlers();
registerKekeOnEnterPlaceWaitingEnergyWorkflowHandlers({ enqueueTriggeredCardEffects });
registerKarinWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNozomiOnEnterWorkflowHandlers();
registerHsBp5002SayakaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5003RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5005KosuzuWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5006HimeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp5007SerasWorkflowHandlers({ enqueueTriggeredCardEffects });
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
registerHsSd1004GinkoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsSd1005KosuzuWorkflowHandlers();
registerNBp1002KasumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNLiveStartScoreBonusesWorkflowHandlers();
registerNLiveSuccessCheerAllBladeScoreWorkflowHandlers();
registerNBp5001AyumuWorkflowHandlers();
registerNBp5015ShizukuWorkflowHandlers();
registerNBp5030RyouranVictoryRoadWorkflowHandlers();
registerNBp1026PoppinUpWorkflowHandlers();
registerNBp3008EmmaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp3010ShiorikoWorkflowHandlers();
registerNBp3027LaBellaPatriaWorkflowHandlers();
registerNBp4004KarinWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp4029RiseUpHighWorkflowHandlers();
registerNBp4030DaydreamMermaidWorkflowHandlers();
registerNBp5003ShizukuWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNBp5021RinaWorkflowHandlers();
registerOnEnterActivateWaitingEnergyWorkflowHandlers();
registerNDiscardRecoverAndBladeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNPb1006KanataWorkflowHandlers({ enqueueTriggeredCardEffects });
registerNPb1011MiaWorkflowHandlers();
registerHsBp6011RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerHsBp2005RurinoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerMakiOnEnterWorkflowHandlers();
registerPb1015MakiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3026OhLovePeaceWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlPb1018NicoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSd1008HanayoWorkflowHandlers();
registerEmmaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerLlBp6001KotoriDiaKosuzuWorkflowHandlers({ enqueueTriggeredCardEffects });
registerPlBp3001HonokaWorkflowHandlers({ enqueueTriggeredCardEffects });
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
registerPlBp3014RinWorkflowHandlers();
registerNBp5007SetsunaWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp2009NatsumiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp2010MargareteWorkflowHandlers();
registerSBp5020LandingActionYeahWorkflowHandlers();
registerSBp5111SeiraWorkflowHandlers({
  enqueueMemberSlotMovedCardEffects: enqueueTriggeredCardEffects,
  enqueueMemberStateChangedCardEffects: enqueueTriggeredCardEffects,
});
registerSpBp1024TinyStarsWorkflowHandlers();
registerSpBp2001KanonWorkflowHandlers();
registerSpBp2024VitaminSummerWorkflowHandlers();
registerSpBp4001KanonWorkflowHandlers();
registerSpBp4004SumireWorkflowHandlers({ enqueueTriggeredCardEffects });
registerStageMemberWaitingEnergyPlacementWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp4024NonfictionWorkflowHandlers();
registerSpBp4025SpecialColorWorkflowHandlers();
registerShikiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5001KanonWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5004SumireWorkflowHandlers();
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
registerSpBp5111MaoWorkflowHandlers();
registerSpBp5222YuunaWorkflowHandlers();
registerSpBp5002KekeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpBp5006KinakoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb1006KinakoWorkflowHandlers();
registerSpPb1008ShikiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb1020NatsumiWorkflowHandlers();
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
registerSpPr020KinakoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2000ChisatoNatsumiWorkflowHandlers();
registerSpPb2045ZettaiLoverWorkflowHandlers();
registerSpPb2046ButterflyWingWorkflowHandlers();
registerSpPb2047WelcomeToBokuraNoSekaiWorkflowHandlers({ enqueueTriggeredCardEffects });
registerSpPb2048DistortionWorkflowHandlers();
registerSpPb2049NeutralWorkflowHandlers();
registerOnEnterDiscardRecoverUnitCardWorkflowHandlers({ enqueueTriggeredCardEffects });
registerChisatoWorkflowHandlers({ enqueueTriggeredCardEffects });
registerActivatedPayEnergySelfPositionChangeWorkflowHandlers({ enqueueTriggeredCardEffects });
registerActivatedWaitSelfDiscardDrawWorkflowHandlers({ enqueueTriggeredCardEffects });
registerOnMoveGainHeartWorkflowHandlers();
registerSpSd2011TomariWorkflowHandlers();
registerSpSd2003ChisatoWorkflowHandlers();
registerSpBp4MovedSideBladeWorkflowHandlers();
registerSpSd2023HajimariWaKimiNoSoraWorkflowHandlers();
registerSpSd2025AspireWorkflowHandlers();
registerYoshikoPlayLowCostMembersWorkflowHandlers({ enqueueTriggeredCardEffects });
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
    state = enqueueEnterWaitingRoomCardEffects(
      state,
      options.enterWaitingRoomEvents ?? getLatestEnterWaitingRoomEventsFromLog(state)
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

function getEnterWaitingRoomEventsFromLog(game: GameState): readonly EnterWaitingRoomEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is EnterWaitingRoomEvent =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
}

function getLatestEnterWaitingRoomEventsFromLog(
  game: GameState
): readonly EnterWaitingRoomEvent[] {
  const events = getEnterWaitingRoomEventsFromLog(game);
  const latestEvent = events.at(-1);
  return latestEvent ? [latestEvent] : [];
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
    if (!enteredCard || !isHasunosoraMemberCard(enteredCard)) {
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

const isHasunosoraCard = groupAliasIs('蓮ノ空');
const isHasunosoraMemberCard = and(typeIs(CardType.MEMBER), isHasunosoraCard);
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
  ).filter((ability) => ability.triggerCondition === TriggerCondition.ON_ENTER_STAGE);
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
      .filter(
        (ability) =>
          ability.triggerCondition === TriggerCondition.ON_CHEER &&
          (ability.abilityId ===
            SP_PB2_020_AUTO_ON_CHEER_DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER_ABILITY_ID ||
            ability.abilityId ===
              N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID)
      )
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

function hasAbilityInstance(game: GameState, pendingAbilityId: string): boolean {
  const alreadyPending = game.pendingAbilities.some((ability) => ability.id === pendingAbilityId);
  const alreadyActive = game.activeEffect?.id === pendingAbilityId;
  const alreadyResolved = game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.payload.pendingAbilityId === pendingAbilityId
  );
  return alreadyPending || alreadyActive || alreadyResolved;
}

export function resolvePendingCardEffects(game: GameState): CardEffectRunnerResult {
  if (game.activeEffect) {
    return {
      gameState: game,
      resolvedAbilityIds: [],
    };
  }

  const stateWithResolvedAbilityObservers = enqueueResolvedAbilityObserverCardEffects(game);
  if (stateWithResolvedAbilityObservers !== game) {
    return resolvePendingCardEffects(stateWithResolvedAbilityObservers);
  }

  const pendingAbilities = getSupportedPendingAbilities(game);
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

  const sameTimingAbilities = pendingAbilities.filter((candidate) =>
    isSamePendingAbilityChoiceWindow(candidate, ability)
  );
  if (sameTimingAbilities.length > 1) {
    return {
      gameState: startAbilityOrderSelection(game, sameTimingAbilities),
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
    { continuePendingCardEffects, delegatePendingAbility }
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

  return startPendingAbilityEffect(
    {
      ...game,
      activeEffect: null,
    },
    selectedAbility,
    { orderedResolution: resolveInOrder, manualConfirmation: !resolveInOrder }
  );
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

  const stateWithResolvedAbilityObservers = enqueueResolvedAbilityObserverCardEffects(game);
  if (stateWithResolvedAbilityObservers !== game) {
    return continuePendingCardEffects(stateWithResolvedAbilityObservers, orderedResolution);
  }

  const pendingAbilities = getSupportedPendingAbilities(game);
  if (pendingAbilities.length === 0) {
    return game;
  }

  const immediateObserverAbility = pendingAbilities.find(isImmediateResolvedObserverAbility);
  if (immediateObserverAbility) {
    return startPendingAbilityEffect(game, immediateObserverAbility, {
      orderedResolution,
      skipManualConfirmation: true,
    });
  }

  if (orderedResolution) {
    return startPendingAbilityEffect(game, pendingAbilities[0], { orderedResolution: true });
  }

  const nextAbility = pendingAbilities[0];
  const sameTimingAbilities = pendingAbilities.filter((candidate) =>
    isSamePendingAbilityChoiceWindow(candidate, nextAbility)
  );

  return sameTimingAbilities.length > 1
    ? startAbilityOrderSelection(game, sameTimingAbilities)
    : startPendingAbilityEffect(game, nextAbility, {
        confirmBeforeResolution:
          pendingAbilities.length === 1 && shouldConfirmSingleLivePendingAbility(nextAbility),
      });
}

function shouldConfirmSingleLivePendingAbility(ability: PendingAbilityState): boolean {
  return (
    ability.timingId === TriggerCondition.ON_LIVE_START ||
    ability.timingId === TriggerCondition.ON_LIVE_SUCCESS
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

function isSamePendingAbilityChoiceWindow(
  left: PendingAbilityState,
  right: PendingAbilityState
): boolean {
  if (left.controllerId !== right.controllerId) {
    return false;
  }

  if (left.timingId === right.timingId) {
    return true;
  }

  if (isRelayReplacementAbilityChoiceWindow(left, right)) {
    return true;
  }

  return left.eventIds.some((eventId) => right.eventIds.includes(eventId));
}

function isRelayReplacementAbilityChoiceWindow(
  left: PendingAbilityState,
  right: PendingAbilityState
): boolean {
  const enterAbility =
    left.timingId === TriggerCondition.ON_ENTER_STAGE
      ? left
      : right.timingId === TriggerCondition.ON_ENTER_STAGE
        ? right
        : null;
  const leaveAbility =
    left.timingId === TriggerCondition.ON_LEAVE_STAGE
      ? left
      : right.timingId === TriggerCondition.ON_LEAVE_STAGE
        ? right
        : null;

  return (
    enterAbility !== null &&
    leaveAbility !== null &&
    leaveAbility.metadata?.replacingCardId === enterAbility.sourceCardId
  );
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
