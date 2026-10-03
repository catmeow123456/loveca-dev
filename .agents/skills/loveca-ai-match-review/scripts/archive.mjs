import { createHash } from 'node:crypto';

/** Offline normalization of explicit diagnostic formats; never reconstructs authority state. */
export function parseEvidence(text) {
  try {
    const data = JSON.parse(text);
    if (data?.format === 'loveca-ai-observation-v1') return data;
  } catch {
    /* JSONL is parsed below, with line-level validation. */
  }
  const decisions = new Map(),
    materials = [],
    sourceIds = [];
  let matchId,
    format,
    sequence = 0n,
    expectedLocalSequence = 1n,
    endedAt = null;
  let manifest,
    matchBilling = null,
    captureFailures = 0,
    revision = 0;
  const material = (id, title, source, content, redactionCount = 0) => {
    const bytes = Buffer.byteLength(content);
    materials.push({
      id,
      title,
      source,
      content,
      redactionCount,
      sha256: createHash('sha256').update(content).digest('hex'),
      originalBytes: bytes,
      retainedBytes: bytes,
      status: 'COMPLETE',
    });
  };
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    let outer;
    try {
      outer = JSON.parse(lines[index]);
    } catch {
      throw new Error(
        `Invalid JSONL at line ${index + 1}; partial trailing lines are not complete evidence`
      );
    }
    const row = outer.entry ?? outer;
    const payload = row.payload;
    if (row.kind === 'EXPORT') {
      if (manifest) throw new Error('Duplicate archive export manifest');
      manifest = payload ?? row;
      continue;
    }
    if (!payload || !Number.isSafeInteger(row.timestamp))
      throw new Error(`Invalid archive event at line ${index + 1}`);
    if (!/^[1-9]\d*$/.test(String(outer.sequence))) throw new Error('Missing archive sequence');
    const current = BigInt(outer.sequence);
    if (current <= sequence) throw new Error('Archive sequence is not increasing');
    if (row.kind === 'HEADER') {
      if (matchId) throw new Error('Duplicate archive header');
      matchId = payload.matchId;
      format = payload.format;
      if (!matchId || !['loveca-ai-archive-v1', 'loveca-ai-evidence-v1'].includes(format))
        throw new Error('Unsupported archive header');
    }
    if (!matchId) throw new Error('Archive header must precede events');
    if (format === 'loveca-ai-archive-v1' && current !== expectedLocalSequence)
      throw new Error('Local archive has a sequence gap');
    sequence = current;
    expectedLocalSequence = current + 1n;
    revision++;
    if (row.kind === 'SOURCES') {
      if (sourceIds.length) throw new Error('Duplicate archive sources');
      for (const source of payload.sources) {
        const id = `source:${source.id}`;
        if (sourceIds.includes(id) || typeof source.content !== 'string')
          throw new Error('Invalid archive source');
        sourceIds.push(id);
        material(id, source.title, source.source, source.content, row.redactionCount ?? 0);
      }
    } else if (row.kind === 'BEGIN') {
      const identity = payload.identity;
      if (!identity?.id || decisions.has(identity.id))
        throw new Error('Invalid or duplicate archive decision');
      decisions.set(identity.id, {
        ...identity,
        createdAt: row.timestamp,
        updatedAt: row.timestamp,
        decisionBilling: null,
        status: 'SAMPLED',
        pendingAttempts: [],
        omittedEvents: 0,
        sourceMaterialIds: [...sourceIds],
        events: [],
      });
    } else if (row.kind === 'APPEND') {
      const decision = decisions.get(payload.decisionId);
      if (!decision) throw new Error('Archive event references an unknown decision');
      const id = `event:${outer.sequence}`;
      material(
        id,
        payload.stage,
        'capture',
        JSON.stringify(payload.payload),
        row.redactionCount ?? 0
      );
      decision.events.push({ stage: payload.stage, timestamp: row.timestamp, materialId: id });
      decision.updatedAt = row.timestamp;
      const options = payload.options ?? {};
      decision.status = options.status ?? decision.status;
      const pending = new Set(decision.pendingAttempts);
      if (options.attemptStarted !== undefined) pending.add(options.attemptStarted);
      if (options.attemptFinished !== undefined) pending.delete(options.attemptFinished);
      decision.pendingAttempts = [...pending];
    } else if (row.kind === 'BILLING') {
      matchBilling = payload.billing;
    } else if (row.kind === 'END') {
      endedAt = payload.endedAt;
    } else if (row.kind === 'CAPTURE_FAILURE') captureFailures++;
    else if (row.kind !== 'HEADER') throw new Error(`Unsupported archive event ${row.kind}`);
  }
  if (!matchId || !sourceIds.length) throw new Error('Archive lacks its header or frozen sources');
  // Disk END marks evidence collection end, never a natural game result. Missing END,
  // failed exports and pending requests remain explicit incomplete evidence.
  if (
    endedAt === null ||
    manifest?.completeThroughExport === false ||
    manifest?.completeThroughEnd === false ||
    manifest?.status?.state === 'FAILED'
  )
    captureFailures++;
  if (manifest?.matchId && manifest.matchId !== matchId)
    throw new Error('Archive manifest match mismatch');
  if (manifest?.lastSequence && BigInt(manifest.lastSequence) !== sequence)
    throw new Error('Archive export boundary mismatch');
  return {
    format: 'loveca-ai-observation-v1',
    matchId,
    exportedAt: manifest?.exportedAt ?? Number(endedAt ?? 0),
    revision,
    endedAt,
    decisions: [...decisions.values()],
    materials,
    incompleteMaterialIds: [],
    matchBilling,
    evictedDecisions: 0,
    omittedDecisions: 0,
    discardedLateUpdates: 0,
    captureFailures,
  };
}
