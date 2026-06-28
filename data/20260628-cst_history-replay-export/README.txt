Loveca history replay bundle fixture

Source:
- Admin history export for match 0d341246-0044-4e39-b5cc-73bdf28f12f8
- Room code SOL-9ae2482c-e7b7-4e54-95dd-6aa7b1c3ea1e
- sourceMatch.exportedStatus = HISTORY_RECORD

Tracked fixture:
- loveca-match-SOL-9ae2482c-e7b7-4e54-95dd-6aa7b1c3ea1e-0d341246-0044-4e39-b5cc-73bdf28f12f8.replay.json.gz
  - gzip-compressed DebugReplayBundle JSON
  - 23 authority checkpoints
  - 26 record frames
  - 122 public events
  - 11 decision records

Purpose:
- Regression coverage for importing HISTORY_RECORD replay bundles through DebugReplayService.
- The integration test reads the gzip fixture, imports it, and verifies FIRST/SECOND readonly projections do not expose authority payload envelopes.

Security note:
- Replay bundles include private events, deck snapshots, and authority checkpoints. This fixture is committed only as a test asset and must not be exposed through ordinary user replay APIs.
