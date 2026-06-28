Loveca match replay export

Date window: 2026-06-27 00:00:00 <= match_records.started_at < 2026-06-28 00:00:00, Asia/Shanghai.
Generated from production PostgreSQL on 2026-06-27 UTC / 2026-06-28 Asia/Shanghai.

Files:
- loveca-match-replay-2026-06-27-cst-online-only.sql.gz
  - match_mode = ONLINE only
  - 6 matches
- loveca-match-replay-2026-06-27-cst-all.sql.gz
  - all matches in the date window
  - 93 matches total: 6 ONLINE + 87 SOLITAIRE

Tables included:
- match_records
- match_deck_snapshots
- match_participants
- match_timeline_entries
- match_record_public_events
- match_record_private_events
- match_decision_records
- match_checkpoints

Tables intentionally not included:
- users / profiles / refresh_tokens / email tokens / password reset tokens
- cards / decks and other non-replay application tables

Import examples:
- gunzip -c loveca-match-replay-2026-06-27-cst-online-only.sql.gz | psql "$DATABASE_URL"
- gunzip -c loveca-match-replay-2026-06-27-cst-all.sql.gz | psql "$DATABASE_URL"

Import behavior:
- The SQL starts a transaction.
- It records the exported match_id values in a temp table.
- It deletes existing replay rows for those match_id values via match_records cascade.
- It then COPY imports the exported rows.
- This makes re-import for the same exported matches idempotent, but it will replace local rows with the same match_id.

Note:
- Replay payloads include private events, deck snapshots, and authority checkpoints because they are required for debug playback.
