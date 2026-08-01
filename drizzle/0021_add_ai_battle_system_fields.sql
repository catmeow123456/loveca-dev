ALTER TABLE "match_decision_records" DROP CONSTRAINT "match_decision_records_type_check";--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" DROP CONSTRAINT "match_deck_snapshots_source_check";--> statement-breakpoint
ALTER TABLE "match_records" DROP CONSTRAINT "match_records_origin_kind_check";--> statement-breakpoint
ALTER TABLE "match_decision_records" ADD COLUMN "strategy_record" jsonb;--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN "system_identity_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "match_decision_records" ADD CONSTRAINT "match_decision_records_type_check" CHECK ("match_decision_records"."decision_type" IN ('ACTIVE_EFFECT_OPENED', 'ACTIVE_EFFECT_SUBMITTED', 'PENDING_ABILITY_ORDER_SUBMITTED', 'ACTIVATE_ABILITY_SUBMITTED', 'MULLIGAN_SUBMITTED', 'SET_LIVE_CARD_SUBMITTED', 'SELECT_SUCCESS_LIVE_SUBMITTED', 'AI_STRATEGY_SUBMITTED'));--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD CONSTRAINT "match_deck_snapshots_source_check" CHECK ("match_deck_snapshots"."source" IN ('ONLINE_RUNTIME_DECK', 'PUBLISHED_CARDS_SNAPSHOT', 'AI_CERTIFIED_DECK', 'SOLITAIRE_DEFAULT_DECK'));--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_origin_kind_check" CHECK ("match_records"."origin_kind" IN ('ONLINE_ROOM', 'PUBLIC_TABLE', 'RANKED', 'AI_BATTLE', 'SOLITAIRE'));