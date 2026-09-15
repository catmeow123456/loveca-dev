#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const seats = ['FIRST', 'SECOND'];
const sum = (values) => values.reduce((a, b) => a + b, 0);
const countBy = (values) => values.reduce((out, key) => ({ ...out, [key]: (out[key] ?? 0) + 1 }), {});
const show = (value) => value == null ? '?' : String(value);
const json = (value) => JSON.stringify(value, null, 2);

/** Only decode documented wire references. Never execute or infer content. */
export function expandInput(wire) {
  const visit = (value, active = new Set()) => {
    if (Array.isArray(value)) return value.map((v) => visit(v, active));
    if (!value || typeof value !== 'object') return value;
    for (const [key, dict] of [['textRef', 'texts'], ['cardFactsRef', 'cardFacts']]) {
      if (typeof value[key] !== 'string') continue;
      const ref = `${dict}:${value[key]}`;
      if (active.has(ref) || !own(wire[dict], value[key])) throw new Error(`Invalid reference ${ref}`);
      return visit(wire[dict][value[key]], new Set([...active, ref]));
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, active)]));
  };
  const { texts, cardFacts, ...rest } = wire;
  const result = visit(rest);
  const space = result.space;
  if (space?.memberPlays) {
    space.candidates = space.candidates.map(({ memberPlayRef, ...candidate }) => {
      if (memberPlayRef === undefined) return candidate;
      const group = space.memberPlays[memberPlayRef];
      if (!group || typeof group.descriptionPrefix !== 'string' || typeof candidate.description !== 'string')
        throw new Error(`Invalid memberPlayRef ${memberPlayRef}`);
      return { ...group.common, ...candidate, description: group.descriptionPrefix + candidate.description };
    });
    delete space.memberPlays;
  }
  const context = result.context;
  const index = context?.lastAction?.recentDecisionIndex;
  if (index !== undefined) {
    if (!Number.isInteger(index) || !own(context.recentDecisions, index))
      throw new Error(`Invalid recentDecisionIndex ${index}`);
    context.lastAction = context.recentDecisions[index];
  }
  return result;
}

export function differences(a, b, path = '$', out = []) {
  if (out.length >= 12 || isDeepStrictEqual(a, b)) return out;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    out.push(path);
    return out;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!own(a, key) || !own(b, key)) out.push(`${path}.${key}`);
    else differences(a[key], b[key], `${path}.${key}`, out);
    if (out.length >= 12) break;
  }
  return out;
}

function requestInput(request) {
  const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
  if (!Array.isArray(body?.messages)) throw new Error('Missing REQUEST.body.messages');
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const message = body.messages[i];
    if (message.role !== 'user' || typeof message.content !== 'string') continue;
    const start = message.content.indexOf('{');
    if (start < 0) continue;
    let wire;
    try { wire = JSON.parse(message.content.slice(start)); } catch { continue; }
    if (!wire?.state || !wire?.space) continue;
    return { input: expandInput(wire), messageIndex: i, model: body.model,
      messages: body.messages.map((m, index) => ({ index, role: m.role, chars: m.content?.length ?? null })),
      inputEncoding: request.inputEncoding ?? null, assembly: request.assembly ?? null };
  }
  throw new Error('No dynamic state/space JSON in REQUEST messages');
}

/** A report remains useful with missing evidence, but never treats missing as zero. */
export function createReview(data) {
  if (data?.format !== 'loveca-ai-observation-v1' || !Array.isArray(data.decisions) || !Array.isArray(data.materials))
    throw new Error('Expected loveca-ai-observation-v1 with decisions[] and materials[]');
  const warnings = new Set();
  const materials = new Map();
  for (const m of data.materials) {
    if (materials.has(m.id)) throw new Error(`Duplicate material id ${m.id}`);
    materials.set(m.id, m);
  }
  const cache = new Map();
  const read = (id, parse = true) => {
    const m = materials.get(id);
    if (!m || m.status !== 'COMPLETE' || typeof m.content !== 'string') {
      warnings.add(`材料 ${id}: ${m?.status ?? '未收录'}，不作为完整证据`);
      return null;
    }
    if (!parse) return m.content;
    if (!cache.has(id)) {
      try { cache.set(id, JSON.parse(m.content)); }
      catch { warnings.add(`材料 ${id}: JSON 无法解析`); cache.set(id, null); }
    }
    return cache.get(id);
  };
  const refs = (d, stage) => d.events.filter((e) => e.stage === stage);
  const last = (d, stage) => {
    const e = refs(d, stage).at(-1);
    return e ? read(e.materialId) : null;
  };
  const legend = new Map();
  const card = (objectId, objects) => {
    const object = objects?.[objectId];
    const f = object?.frontInfo;
    // Do not recover identities from a later snapshot, deck source, or hidden object id.
    if (!f?.cardCode) return { id: objectId, card: '?', unknown: true };
    if (!legend.has(f.cardCode)) legend.set(f.cardCode, {
      card: `C${legend.size + 1}`, code: f.cardCode,
      name: f.nameCn ?? f.nameJp ?? f.name ?? f.cardCode,
      type: f.cardType ?? object.cardType, cost: f.cost ?? null, score: f.score ?? null,
    });
    return { ...legend.get(f.cardCode), id: objectId, cost: f.cost ?? null,
      blade: f.blade ?? null, hearts: f.hearts ?? null, requirements: f.requiredHearts ?? null,
      orientation: object.orientation ?? null, costDelta: object.modifierDelta?.costDelta ?? null,
      enteredThisTurn: object.enteredStageThisTurn ?? null };
  };
  const snapshot = (sample, d) => {
    if (!sample) return null;
    const state = sample.input?.state;
    const view = sample.view;
    const table = view?.table ?? state?.table;
    const objects = view?.objects ?? state?.objects;
    const selfSeat = view?.match?.viewerSeat ?? state?.selfSeat ?? d.seat;
    const players = {};
    for (const seat of seats) {
      const zones = Object.values(table?.zones ?? {}).filter((z) => z.ownerSeat === seat);
      const zone = (type) => zones.find((z) => z.zone === type);
      const visible = (z) => (z?.objectIds ?? []).map((id) => card(id, objects));
      const handZone = zone('HAND');
      const hand = visible(handZone);
      const knownHand = hand.filter((c) => !c.unknown);
      const stageZones = zones.filter((z) => z.zone === 'MEMBER_SLOT');
      const stage = stageZones.flatMap((z) => Object.entries(z.slotMap ?? {})
        .filter(([, id]) => id).map(([slot, id]) => ({ ...card(id, objects), slot })));
      const energyZone = zone('ENERGY_ZONE');
      const energyIds = energyZone?.objectIds ?? [];
      const energyKnown = energyZone && energyIds.length === energyZone.count &&
        energyIds.every((id) => ['ACTIVE', 'WAITING'].includes(objects?.[id]?.orientation));
      const waitingZone = zone('WAITING_ROOM');
      const waiting = visible(waitingZone);
      const handComplete = !!handZone && knownHand.length === handZone.count;
      players[seat] = {
        handCount: handZone?.count ?? null,
        // Unknown opponent back ids must not become trackable hand resources.
        hand: seat === selfSeat ? hand : knownHand,
        handUnknown: handZone ? handZone.count - knownHand.length : null,
        handCosts: countBy(knownHand.filter((c) => c.type === 'MEMBER').map((c) => c.cost ?? 'UNKNOWN')),
        handLives: handZone ? knownHand.filter((c) => c.type === 'LIVE').length : null,
        handComplete,
        stage: stageZones.length ? stage : null,
        stageCost: stageZones.length && stage.every((c) => typeof c.cost === 'number') ? sum(stage.map((c) => c.cost)) : null,
        energy: energyKnown ? energyIds.filter((id) => objects[id].orientation === 'ACTIVE').length : null,
        energyTotal: energyZone?.count ?? null,
        deck: zone('MAIN_DECK')?.count ?? null,
        success: zone('SUCCESS_ZONE')?.count ?? null,
        liveCount: zone('LIVE_ZONE')?.count ?? null,
        lives: visible(zone('LIVE_ZONE')),
        waitingCount: waitingZone?.count ?? null,
        waiting, waitingUnknown: waitingZone ? waitingZone.count - waiting.filter((c) => !c.unknown).length : null,
        score: (view?.match?.liveResult ?? state?.liveResult)?.scores?.[seat] ?? null,
      };
    }
    return { turn: view?.match?.turnCount ?? state?.turn ?? null,
      phase: view?.match?.phase ?? state?.phase ?? null,
      subPhase: view?.match?.subPhase ?? state?.subPhase ?? null,
      activeSeat: view?.match?.activeSeat ?? state?.activeSeat ?? null, selfSeat,
      seq: view?.match?.seq ?? null, endInfo: view?.match?.endInfo ?? null, players };
  };
  const eventUnion = new Map();
  const decisions = [...data.decisions].sort((a, b) => a.createdAt - b.createdAt);
  const seenDecisions = new Set();
  const rows = decisions.map((d) => {
    if (seenDecisions.has(d.id)) throw new Error(`Duplicate decision id ${d.id}`);
    seenDecisions.add(d.id);
    if (!Array.isArray(d.events)) throw new Error(`D${d.id} has no events[]`);
    for (const id of [...(d.sourceMaterialIds ?? []), ...d.events.map((e) => e.materialId)])
      if (!materials.has(id)) warnings.add(`D${d.id} 引用未收录材料 ${id}`);
    const sample = last(d, 'SAMPLE');
    if (!sample) warnings.add(`D${d.id} 缺少可读 SAMPLE`);
    const snap = snapshot(sample, d);
    for (const e of sample?.input?.history?.events ?? []) {
      if (!Number.isInteger(e.seq)) { warnings.add(`D${d.id} public event 缺 seq`); continue; }
      const prev = eventUnion.get(e.seq);
      if (prev && !isDeepStrictEqual(prev.event, e)) warnings.add(`public seq ${e.seq} 内容冲突`);
      if (!prev) eventUnion.set(e.seq, { event: e, firstSeenDecision: d.id, firstSeenTurn: snap?.turn, materialId: refs(d, 'SAMPLE').at(-1)?.materialId });
    }
    const submit = last(d, 'SUBMIT');
    const authority = last(d, 'AUTHORITY_RESULT');
    const validated = last(d, 'MODEL_VALIDATION');
    const chosen = submit?.selection?.selection ?? validated?.selection ?? null;
    const candidates = sample?.input?.space?.candidates ?? [];
    const selected = chosen?.kind === 'ACTION' ? candidates.filter((c) => c.ref === chosen.actionRef)
      : chosen?.kind === 'CARDS' ? chosen.cardRefs.map((ref) => candidates.find((c) => c.ref === ref)).filter(Boolean) : [];
    const flags = [];
    if (sample?.queryKind === 'UNSUPPORTED' || d.events.some((e) => e.stage === 'STOP')) flags.push('适配/停止原因待核查');
    if (authority?.success === false) flags.push('权威拒绝');
    if (d.events.some((e) => e.stage === 'MODEL_FAILURE')) flags.push('模型调用/输出失败');
    const self = snap?.players[snap.selfSeat];
    if (authority?.success === true && submit?.command?.type === 'END_PHASE' && snap?.phase === 'MAIN_PHASE' &&
      self?.energy > 0 && candidates.some((c) => c.energyCost > 0 && c.energyCost <= self.energy))
      flags.push('结束主要阶段时仍有可支付动作（非自动判错）');
    return { id: d.id, createdAt: d.createdAt, purpose: d.purpose, status: d.status,
      queryKind: sample?.queryKind ?? null, source: submit?.selection?.source ?? null,
      command: submit?.command?.type ?? null, selection: chosen,
      selected: selected.map((c) => ({ ref: c.ref, description: c.description, energyCost: c.energyCost, targetSlot: c.targetSlot,
        card: c.objectId ? card(c.objectId, sample?.input?.state?.objects ?? sample?.view?.objects).card : null })),
      tradeoff: submit?.selection?.tradeoff ?? validated?.tradeoff ?? null,
      success: authority?.success ?? null, error: authority?.error ?? null,
      commandRecords: authority?.commandRecords ?? [], snapshot: snap, flags,
      evidence: Object.fromEntries([...new Set(d.events.map((e) => e.stage))].map((stage) => [stage, refs(d, stage).map((e) => e.materialId)])),
    };
  });
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i], previous = rows[i - 1];
    const a = previous.snapshot, b = row.snapshot;
    if (!a || !b || a.selfSeat !== b.selfSeat) continue;
    const before = a.players[a.selfSeat], after = b.players[b.selfSeat];
    const complete = before.handComplete && after.handComplete;
    row.interval = { from: previous.id, to: row.id, fromSeq: a.seq, toSeq: b.seq,
      handDelta: before.handCount == null || after.handCount == null ? null : after.handCount - before.handCount,
      added: complete ? after.hand.filter((c) => !before.hand.some((p) => p.id === c.id)).map((c) => c.card) : null,
      removed: complete ? before.hand.filter((c) => !after.hand.some((p) => p.id === c.id)).map((c) => c.card) : null,
      scope: 'OBSERVED_INTERVAL_NOT_SINGLE_COMMAND' };
    if (row.interval.handDelta !== null && row.interval.handDelta <= -2) row.flags.push('相邻采样手牌减少≥2（需追踪支付/补充）');
    if (before.stage && after.stage && after.stage.length < before.stage.length)
      row.flags.push('相邻采样舞台人数减少（需核对换手/自送收益）');
  }
  const publicEvents = [...eventUnion.values()].sort((a, b) => a.event.seq - b.event.seq);
  const gaps = [];
  let seq = 0;
  for (const item of publicEvents) {
    if (item.event.seq > seq + 1) gaps.push([seq + 1, item.event.seq - 1]);
    seq = item.event.seq;
  }
  const turns = [...new Set(rows.map((r) => r.snapshot?.turn).filter((x) => x != null))].map((turn) => {
    const sampled = rows.filter((r) => r.snapshot?.turn === turn);
    return { turn, first: sampled[0].id, last: sampled.at(-1).id,
      before: sampled[0].snapshot, after: sampled.at(-1).snapshot,
      decisions: sampled.length, sources: countBy(sampled.map((r) => r.source ?? r.queryKind ?? 'UNKNOWN')),
      review: sampled.filter((r) => r.flags.length).map((r) => r.id) };
  });
  const sources = data.materials.filter((m) => m.id.startsWith('source:')).map(({ content, ...m }) => ({ ...m, chars: content?.length ?? 0 }));
  const coverage = { format: data.format, matchId: data.matchId, exportedAt: data.exportedAt,
    endedAt: data.endedAt ?? null, endInfo: rows.map((r) => r.snapshot?.endInfo).findLast(Boolean) ?? null,
    decisions: rows.length, samples: rows.filter((r) => r.snapshot).length,
    evictedDecisions: data.evictedDecisions ?? null, omittedDecisions: data.omittedDecisions ?? null,
    omittedDecisionEvents: sum(decisions.map((d) => d.omittedEvents ?? 0)),
    captureFailures: data.captureFailures ?? null, discardedLateUpdates: data.discardedLateUpdates ?? null,
    incompleteMaterialIds: [...new Set([...(data.incompleteMaterialIds ?? []), ...data.materials.filter((m) => m.status !== 'COMPLETE').map((m) => m.id)])],
    publicEvents: publicEvents.length, publicSeqRange: publicEvents.length ? [publicEvents[0].event.seq, seq] : null,
    publicSeqGaps: gaps, lastSample: rows.filter((r) => r.snapshot).at(-1)?.id ?? null,
    limitation: '采样与有界公开事件的并集，不是完整 command replay；最后采样后的结果未知。',
  };
  const detail = (id) => {
    const d = decisions.find((d) => d.id === id);
    if (!d) throw new Error(`Decision ${id} not found`);
    const sample = last(d, 'SAMPLE');
    const requests = refs(d, 'REQUEST').map((e) => {
      const request = read(e.materialId);
      if (!request) return { materialId: e.materialId, error: '材料不可用' };
      try {
        const decoded = requestInput(request);
        const { decisionBrief, ...expanded } = decoded.input;
        return { materialId: e.materialId, attempt: request.attempt, ...decoded,
          decisionBrief: decisionBrief ?? null,
          comparison: sample?.input ? { equal: isDeepStrictEqual(expanded, sample.input),
            differencePaths: differences(expanded, sample.input), differenceLimit: 12,
            scope: 'DECODED_DYNAMIC_FACTS_EXCLUDING_ADDITIONAL_DECISION_BRIEF' } : null };
      } catch (error) { return { materialId: e.materialId, error: error.message }; }
    });
    return { ...rows.find((r) => r.id === id), sampleInput: sample?.input ?? null,
      sampleView: sample?.view ?? null, requests,
      events: d.events.map((e) => ({ ...e, status: materials.get(e.materialId)?.status ?? 'MISSING' })),
      sourceMaterialIds: d.sourceMaterialIds,
      outcome: { submit: last(d, 'SUBMIT'), authority: last(d, 'AUTHORITY_RESULT'),
        diagnosticEvents: d.events.filter((e) => ['STOP', 'MODEL_FAILURE', 'MODEL_OUTCOME', 'INVALIDATED'].includes(e.stage))
          .map((e) => ({ stage: e.stage, materialId: e.materialId, payload: read(e.materialId) })) } };
  };
  const frozenCards = (code) => {
    const results = [];
    for (const source of sources.filter((m) => m.id.startsWith('source:deck:'))) {
      const deck = read(source.id);
      for (const entry of deck?.cards ?? [])
        if (entry.card?.cardCode === code || entry.card?.cardCode?.startsWith(`${code}-`))
          results.push({ materialId: source.id, sha256: source.sha256, count: entry.count, card: entry.card });
    }
    if (!results.length) throw new Error(`No frozen card matching ${code}; do not substitute current card database`);
    return results;
  };
  return { coverage, rows, turns, legend: [...legend.values()], sources, publicEvents,
    warnings, detail, frozenCards, material: (id) => {
      if (!materials.has(id)) throw new Error(`Material ${id} not found`);
      const m = materials.get(id);
      if (m.status !== 'COMPLETE') return { ...m, note: '不完整正文，仅作缺失诊断' };
      try { return JSON.parse(m.content); } catch { return m.content; }
    } };
}

function handText(p) {
  if (!p) return '?';
  const costs = Object.entries(p.handCosts).map(([cost, n]) => `${cost}费×${n}`).join(',') || '无已知成员';
  return `${show(p.handCount)}张[${costs};已知LIVE×${show(p.handLives)}${p.handUnknown !== 0 ? `;未知×${show(p.handUnknown)}` : ''}]`;
}
function stageText(p) {
  return p?.stage == null ? '?' : p.stage.map((c) => `${c.slot}:${c.card}(${show(c.cost)}${c.orientation === 'WAITING' ? ',待机' : ''})`).join(' ') || '空场';
}
function boardText(s, seat) {
  const p = s?.players[seat];
  return p ? `${stageText(p)}; E${show(p.energy)}/${show(p.energyTotal)}; 成功LIVE${show(p.success)}; 当前LIVE${show(p.liveCount)}/分${show(p.score)}` : '?';
}
function cells(values) { return `| ${values.map((s) => String(s).replaceAll('|', '/').replaceAll('\n', ' ')).join(' | ')} |`; }
function legendText(review) {
  return review.legend.map((c) => `${c.card}=${c.type === 'MEMBER' ? `费用${show(c.cost)}` : c.type === 'LIVE' ? `分数${show(c.score)}` : c.type}「${c.name}」(${c.code})`).join('\n');
}
function coverageText(review) {
  const c = review.coverage;
  return `# ${c.matchId}\n\n覆盖：${c.decisions}个决定 / ${c.samples}个采样；${c.endInfo ? '已观测终局' : c.endedAt ? '会话已封存，终局未观测' : '未结束或未封存，不声称完整终局'}。\n` +
    `淘汰=${show(c.evictedDecisions)}，省略决定=${show(c.omittedDecisions)}，省略决定事件=${c.omittedDecisionEvents}，采集失败=${show(c.captureFailures)}，不完整材料=${c.incompleteMaterialIds.length}。\n` +
    `公开事件并集=${c.publicEvents}，seq缺口=${JSON.stringify(c.publicSeqGaps)}。${c.limitation}\n` +
    [...review.warnings].map((w) => `警告：${w}`).join('\n');
}
function overviewText(review) {
  const lines = [coverageText(review), '\n## 逐回合采样首→末（不是完整回合边界）\n',
    cells(['T / D', 'AI舞台与进度', '对手舞台与进度', 'AI手牌资源']), '| --- | --- | --- | --- |'];
  for (const t of review.turns) {
    const seat = t.before.selfSeat, other = seats.find((s) => s !== seat);
    lines.push(cells([`${t.turn} / ${t.first}→${t.last}`,
      `${boardText(t.before, seat)} → ${boardText(t.after, seat)}`,
      `${boardText(t.before, other)} → ${boardText(t.after, other)}`,
      `${handText(t.before.players[seat])} → ${handText(t.after.players[seat])}`]));
  }
  lines.push('\n## 策略选择与待核查索引（flags 不是失误判定）\n');
  for (const r of review.rows.filter((r) => ['MODEL', 'FALLBACK'].includes(r.source) || r.flags.length))
    lines.push(`D${r.id} T${show(r.snapshot?.turn)} ${r.purpose} ${r.source ?? '?'} ${r.command ?? '未提交'} ${r.success === true ? '执行成功' : r.success === false ? '执行失败' : '执行未知'} ${r.selected.map((c) => c.card ?? c.ref).join(',')} ${r.flags.join('；')}`);
  lines.push('\n## 卡牌缩写（重复缩写不代表同一实体）\n', legendText(review));
  return lines.join('\n');
}
function timelineText(review, turn) {
  const rows = turn == null ? review.rows : review.rows.filter((r) => r.snapshot?.turn === turn);
  if (!rows.length) throw new Error(`No samples for turn ${turn}`);
  const lines = [coverageText(review)];
  let previous;
  for (const r of rows) {
    const s = r.snapshot;
    lines.push(`\n### D${r.id} / T${show(s?.turn)} / ${s?.phase ?? '?'} / 行动席${s?.activeSeat ?? '?'} / ${r.queryKind ?? '?'}\n`);
    if (s && previous && isDeepStrictEqual(s.players, previous.snapshot?.players)) {
      lines.push(`资源与 D${previous.id} 一致；本次采样 seq=${show(s.seq)}。`);
    } else if (s) {
      const self = s.players[s.selfSeat], other = seats.find((seat) => seat !== s.selfSeat);
      lines.push(`AI ${boardText(s, s.selfSeat)}；手牌 ${handText(self)}：${self.hand.map((c) => c.card).join(',')}；休息室${show(self.waitingCount)}：${self.waiting.map((c) => c.card).join(',')}`,
        `对手 ${boardText(s, other)}；手牌${show(s.players[other].handCount)}（不推测隐藏身份）`);
    }
    if (r.interval && (r.interval.added?.length !== 0 || r.interval.removed?.length !== 0)) lines.push(`D${r.interval.from}→D${r.id}采样区间手牌：新增[${r.interval.added?.join(',') ?? '未知'}]，移出[${r.interval.removed?.join(',') ?? '未知'}]；非单条命令因果。`);
    lines.push(`提交=${r.source ?? '无'} / ${r.command ?? '无'}；权威=${show(r.success)}；${r.selected.map((c) => `${c.ref}:${c.description?.split('；')[0]}${c.targetSlot ? ` →${c.targetSlot}` : ''}${c.energyCost !== undefined ? ` 实付${c.energyCost}` : ''}`).join('；')}`);
    if (r.tradeoff) lines.push(`模型自述（非事实）：${r.tradeoff}`);
    if (r.flags.length) lines.push(`待核查：${r.flags.join('；')}`);
    lines.push(`证据 ${Object.entries(r.evidence).filter(([stage]) => ['SAMPLE', 'REQUEST', 'SUBMIT', 'AUTHORITY_RESULT', 'STOP', 'MODEL_FAILURE'].includes(stage)).map(([stage, ids]) => `${stage}=${ids.join(',')}`).join(' ')}`);
    previous = r;
  }
  lines.push('\n## 公开事件（首次在本范围采样中看到，不保证发生于该回合）\n');
  const ids = new Set(rows.map((r) => r.id));
  for (const p of review.publicEvents.filter((e) => ids.has(e.firstSeenDecision))) {
    const { matchId, eventId, timestamp, ...event } = p.event;
    if (['PhaseStarted', 'SubPhaseStarted', 'WindowStatusChanged'].includes(event.type)) continue;
    // Raw ids are available in --json; seq/material is the stable evidence pointer here.
    const withoutObjectIds = (v) => Array.isArray(v) ? v.map(withoutObjectIds)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v)
        .filter(([k]) => !['publicObjectId', 'objectId'].includes(k)).map(([k, x]) => [k, withoutObjectIds(x)])) : v;
    lines.push(`seq${event.seq} @D${p.firstSeenDecision}/${p.materialId} ${JSON.stringify(withoutObjectIds(event))}`);
  }
  lines.push('\n## 卡牌缩写\n', legendText(review));
  return lines.join('\n');
}

/** Group consecutive sampled decisions into (turn, phase) runs, entry→exit. */
export function phaseGroups(review, turn) {
  const scoped = review.rows.filter((r) => r.snapshot && (turn == null || r.snapshot.turn === turn));
  const groups = [];
  for (const r of scoped) {
    const key = `${r.snapshot.turn}|${r.snapshot.phase}`;
    const g = groups.at(-1);
    if (g && g.key === key) g.rows.push(r);
    else groups.push({ key, turn: r.snapshot.turn, phase: r.snapshot.phase ?? '?', rows: [r] });
  }
  for (const g of groups) {
    const index = review.rows.indexOf(g.rows.at(-1));
    const next = review.rows.slice(index + 1).find((r) => r.snapshot);
    g.entry = g.rows[0].snapshot;
    // Prefer the next sample so the phase's final submit effect is included in the exit state.
    g.exit = next ? next.snapshot : g.rows.at(-1).snapshot;
    g.exitSource = next ? `D${next.id} 采样` : '本范围末采样（最后一条提交的结果未覆盖）';
  }
  return groups;
}

function phaseChangeText(entry, exit, seat) {
  const a = entry?.players[seat], b = exit?.players[seat];
  if (!a || !b) return '?';
  const parts = [];
  const stageOf = (p) => (p.stage ?? []).map(({ card, slot, cost }) => `${slot}:${card}(${show(cost)})`).join(' ');
  parts.push(stageOf(a) === stageOf(b) ? '舞台不变' : `舞台 ${stageText(a)}→${stageText(b)}`);
  if (a.energy !== b.energy || a.energyTotal !== b.energyTotal)
    parts.push(`E${show(a.energy)}/${show(a.energyTotal)}→E${show(b.energy)}/${show(b.energyTotal)}`);
  if (a.success !== b.success) parts.push(`成功LIVE ${show(a.success)}→${show(b.success)}`);
  if (a.liveCount !== b.liveCount || a.score !== b.score)
    parts.push(`当前LIVE ${show(a.liveCount)}/分${show(a.score)}→${show(b.liveCount)}/分${show(b.score)}`);
  parts.push(`手牌 ${handText(a)}→${handText(b)}`);
  if (a.handComplete && b.handComplete) {
    const added = b.hand.filter((c) => !a.hand.some((p) => p.id === c.id)).map((c) => c.card);
    const removed = a.hand.filter((c) => !b.hand.some((p) => p.id === c.id)).map((c) => c.card);
    if (added.length || removed.length) parts.push(`新增[${added.join(',') || '-'}] 移出[${removed.join(',') || '-'}]`);
  }
  if (a.waitingCount !== b.waitingCount) parts.push(`休息室 ${show(a.waitingCount)}→${show(b.waitingCount)}`);
  return parts.join('；');
}

function phaseActionLines(rows) {
  const lines = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    lines.push(run.length === 1
      ? `- D${run[0].id} 等待采样（对手行动或推进等待）`
      : `- D${run[0].id}→D${run.at(-1).id} 等待采样×${run.length}（对手行动或推进等待）`);
    run = [];
  };
  for (const r of rows) {
    if (!r.source && !r.command && !r.flags.length) { run.push(r); continue; }
    flush();
    const mark = r.success === true ? '✓' : r.success === false ? '✗' : '?';
    const acted = r.selected.map((c) =>
      `${c.ref}:${c.description?.split('；')[0]}${c.targetSlot ? `→${c.targetSlot}` : ''}${c.energyCost !== undefined ? ` 实付${c.energyCost}` : ''}`).join('；');
    lines.push(`- D${r.id} [${r.source ?? r.queryKind ?? '?'}] ${r.command ?? '未提交'} ${mark} ${acted}${r.flags.length ? ` 待核查：${r.flags.join('；')}` : ''}`);
  }
  flush();
  return lines;
}

export function phasesText(review, turn, phaseFilter) {
  let groups = phaseGroups(review, turn);
  if (phaseFilter) {
    const needle = phaseFilter.toUpperCase();
    groups = groups.filter((g) => g.phase.toUpperCase().includes(needle));
  }
  if (!groups.length)
    throw new Error(`No phase samples${turn != null ? ` for turn ${turn}` : ''}${phaseFilter ? ` matching ${phaseFilter}` : ''}`);
  const lines = [coverageText(review), '\n## 阶段摘要（入口→出口差值为采样边界，含双方行动与自动结算；不是单命令因果）\n'];
  for (const g of groups) {
    const sources = countBy(g.rows.map((r) => r.source ?? r.queryKind ?? 'UNKNOWN'));
    const flagged = g.rows.filter((r) => r.flags.length).map((r) => `D${r.id}`);
    lines.push(`\n### T${show(g.turn)} · ${g.phase}（D${g.rows[0].id}→D${g.rows.at(-1).id}；${Object.entries(sources).map(([k, n]) => `${k}×${n}`).join(' ')}${flagged.length ? `；待核查 ${flagged.join(',')}` : ''}）`);
    const self = g.entry.selfSeat, other = seats.find((s) => s !== self);
    lines.push(`AI 变化：${phaseChangeText(g.entry, g.exit, self)}`,
      `对手 变化：${phaseChangeText(g.entry, g.exit, other)}`,
      `出口依据：${g.exitSource}。`,
      '动作：', ...phaseActionLines(g.rows));
  }
  lines.push('\n## 卡牌缩写\n', legendText(review));
  return lines.join('\n');
}

/** One-line candidate digest: first clause + replace/pay/board ledger from the structured description. */
export function candidateBrief(c) {
  const description = c.description ?? '';
  const first = String(description || c.text || '').split('；')[0].slice(0, 120);
  const bits = [];
  if (c.targetSlot) bits.push(`→${c.targetSlot}`);
  const replaced = description.match(/替换 [^；]*?费用 (\d+)「([^」]+)」/);
  if (replaced) bits.push(`换「${replaced[2]}」(${replaced[1]})`);
  const pay = description.match(/支付 (\d+)，能量 (\d+→\d+)/);
  if (pay) bits.push(`付${pay[1]}(E${pay[2]})`);
  else if (c.energyCost != null) bits.push(`付${c.energyCost}`);
  const board = description.match(/HEART (\d+→\d+)，活跃 BLADE (\d+→\d+)/);
  if (board) bits.push(`HEART ${board[1]} BLADE ${board[2]}`);
  return `- ${c.ref} ${first}${bits.length ? ` ［${bits.join(' ')}］` : ''}`;
}

/** Compact one-page dossier: decision context + model output + authority outcome + drill-down commands. */
export function decisionBriefText(review, d) {
  const s = d.snapshot;
  const lines = [`# D${d.id} 速览 / T${show(s?.turn)} / ${s?.phase ?? '?'} / 行动席${s?.activeSeat ?? '?'} / purpose ${d.purpose} / ${d.queryKind ?? '?'}\n`];
  if (s) {
    const other = seats.find((seat) => seat !== s.selfSeat);
    const self = s.players[s.selfSeat];
    lines.push(`上下文状态：AI ${boardText(s, s.selfSeat)}；手牌 ${handText(self)} 牌[${self.hand.map((c) => c.card).join(',')}]；休息室${show(self.waitingCount)}`,
      `对手 ${boardText(s, other)}；手牌${show(s.players[other].handCount)}（不推测隐藏身份）`);
  } else lines.push('上下文状态：SAMPLE 不可用，未知。');
  const lastRequest = d.requests.at(-1);
  lines.push(`请求：${d.requests.map((r) => r.error ? `${r.materialId}(不可用)` : `${r.materialId} messages[${r.messages.map((m) => `${m.role}:${m.chars}`).join(',')}]`).join('；') || '无 REQUEST'}`);
  if (lastRequest?.comparison)
    lines.push(`REQUEST↔SAMPLE 动态事实：${lastRequest.comparison.equal ? '一致' : `差异 ${lastRequest.comparison.differencePaths.join(',')}`}`);
  if (d.sampleInput?.effect) {
    const e = d.sampleInput.effect;
    lines.push(`当前效果：${e.stepId ?? '?'} / ${e.abilityId ?? '?'}：${String(e.stepText ?? '').split('\n')[0].slice(0, 100)}`);
  }
  const candidates = d.sampleInput?.space?.candidates ?? [];
  lines.push(`\n合法候选×${candidates.length}${d.sampleInput?.space?.kind ? `（${d.sampleInput.space.kind}）` : ''}：`,
    ...(candidates.length ? candidates.map(candidateBrief) : ['（无候选）']));
  lines.push(`\n模型输出：来源=${d.source ?? '无'}；命令=${d.command ?? '未提交'}；选择=${d.selected.map((c) => c.ref).join(',') || '无'}`);
  if (d.tradeoff) lines.push(`自述（非事实）：${d.tradeoff}`);
  lines.push(`权威结果：成功=${show(d.success)}${d.error ? `；错误=${JSON.stringify(d.error)}` : ''}${d.commandRecords?.length ? `；commandRecords×${d.commandRecords.length}` : ''}（非完整卡效结算保证）`);
  if (d.flags.length) lines.push(`待核查：${d.flags.join('；')}`);
  lines.push(`证据：${JSON.stringify(d.evidence)}`,
    `\n下钻：--decision ${d.id}（完整候选与核对）；--decision ${d.id} --input request --field state.selfResources|space|context；--decision ${d.id} --input submit（模型输出原始载荷）；--decision ${d.id} --input authority（权威结果原始载荷）`);
  return lines.join('\n');
}

function detailText(review, d) {
  const lines = [`# D${d.id} / T${show(d.snapshot?.turn)} / ${d.purpose}\n`,
    `提交来源=${d.source ?? '无'}；命令=${d.command ?? '未提交'}；权威成功=${show(d.success)}（非完整卡效结算保证）。`,
    `证据 ${JSON.stringify(d.evidence)}`,
    `模型自述（非事实）：${d.tradeoff ?? '无'}`,
    `待核查：${d.flags.join('；') || '无结构性告警，不表示策略正确'}`,
    '\n## 实际请求与采样核对\n'];
  if (!d.requests.length) lines.push('无 REQUEST 事件；不能声称模型收到过采样输入。');
  for (const r of d.requests) lines.push(JSON.stringify({ materialId: r.materialId, attempt: r.attempt,
    error: r.error, inputEncoding: r.inputEncoding, dynamicMessageIndex: r.messageIndex,
    comparison: r.comparison, decisionBrief: r.decisionBrief, messages: r.messages, assembly: r.assembly }));
  lines.push('\n## 当时资源\n');
  if (d.snapshot) {
    for (const seat of seats) {
      const p = d.snapshot.players[seat];
      lines.push(`${seat === d.snapshot.selfSeat ? 'AI' : '对手'}(${seat}) ${boardText(d.snapshot, seat)}；${handText(p)}；牌库${show(p.deck)}`,
        `手牌 ${p.hand.map((c) => `${c.card}`).join(',')}；休息室${show(p.waitingCount)}[${p.waiting.map((c) => c.card).join(',')}]；LIVE[${p.lives.map((c) => c.card).join(',')}]`,
        `舞台有效值 ${JSON.stringify(p.stage?.map(({ card, slot, blade, hearts, orientation, costDelta, enteredThisTurn }) => ({ card, slot, blade, hearts, orientation, costDelta, enteredThisTurn })))}`);
    }
  } else lines.push('SAMPLE 不可用，资源未知。');
  if (d.interval) lines.push(`采样区间（非单命令因果） ${JSON.stringify(d.interval)}`);
  lines.push('\n## 本次权威结果\n', json(d.outcome));
  // Short local instance tokens preserve physical-card identity without repeating UUIDs.
  const instances = new Map();
  const objects = d.sampleInput?.state?.objects ?? d.sampleView?.objects ?? {};
  const texts = new Map();
  const compact = (value) => {
    if (typeof value === 'string' && own(objects, value)) {
      if (!instances.has(value)) {
        const f = objects[value]?.frontInfo;
        instances.set(value, { token: `I${instances.size + 1}`, card: review.legend.find((c) => c.code === f?.cardCode)?.card ?? '?' });
      }
      return instances.get(value).token;
    }
    if (Array.isArray(value)) return value.map(compact);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => {
      if (k === 'effectText' && typeof v === 'string' && v.length > 80) {
        if (!texts.has(v)) texts.set(v, `TEXT${texts.size + 1}`);
        return [k, texts.get(v)];
      }
      return [k, compact(v)];
    }));
    return value;
  };
  lines.push('\n## 全部合法候选（I 为本决定实体引用；TEXT 只去重同文）\n',
    json(compact(d.sampleInput?.space ?? null)),
    `实体 ${[...instances.values()].map((v) => `${v.token}=${v.card}`).join(',')}`);
  for (const [text, ref] of texts) lines.push(`${ref}: ${text}`);
  if (d.sampleInput?.effect) lines.push(`当前效果 ${json(d.sampleInput.effect)}`);
  lines.push('\n历史上下文按需：--input request --field context；完整当前资源：--input request --field state.selfResources。',
    '\n## 卡牌缩写\n', legendText(review));
  return lines.join('\n');
}

/** Decode JSON strings while following explicit own-property paths; never eval. */
export function fieldAt(value, path) {
  for (const key of path.split('.')) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { throw new Error(`Cannot decode string at ${key}`); }
    }
    if (!own(value, key)) throw new Error(`Field not found: ${path}`);
    value = value[key];
  }
  return value;
}

export function boundOutput(result, max, asJson = false) {
  if (result.length <= max) return result;
  if (asJson) throw new Error(`JSON output ${result.length} chars exceeds --max-chars ${max}; narrow scope or raise limit (JSON not truncated)`);
  const end = result.lastIndexOf('\n', max);
  return result.slice(0, end > max * 0.8 ? end : max) +
    `\n[输出截短：原 ${result.length} 字符。请使用 --turn/--decision/--field 下钻，或提高 --max-chars。]`;
}

export function cli(args) {
  if (!args.length || args.includes('--help')) return `Usage: node review.mjs LOG.json [--turn N | --timeline | --phases | --phase NAME | --decision ID [--brief] | --sources | --material ID | --card CODE]
  [--input request|sample|submit|authority --field dotted.path] [--json] [--max-chars 18000]
Read-only local evidence. Default: coverage, both-side round evolution, hand costs, decision index.
--phases: per-phase entry→exit state diff + AI action recap; --phase NAME filters by phase substring
  (e.g. MAIN, LIVE_SET); both combine with --turn N. --timeline keeps the full per-sample timeline.
--decision includes full legal candidates and SAMPLE/REQUEST comparison; --brief renders a compact
  context+output dossier instead; --input selects a decoded payload (submit = model output wrapper).
--material + --field can inspect nested REQUEST body.messages.0.content. No network or game actions.`;
  const file = args[0];
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (['--json', '--sources', '--timeline', '--phases', '--brief'].includes(arg)) opts[arg.slice(2)] = true;
    else if (['--turn', '--phase', '--decision', '--material', '--card', '--input', '--field', '--max-chars'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      opts[arg.slice(2)] = args[++i];
    } else throw new Error(`Unknown option ${arg}`);
  }
  if (opts.phase) opts.phases = true;
  const modes = ['turn', 'decision', 'sources', 'material', 'card', 'timeline', 'phases'].filter((k) => own(opts, k));
  if (modes.length > 1 && !(modes.length === 2 && modes.includes('turn') && modes.includes('phases')))
    throw new Error('Choose only one report mode (--turn may combine with --phases/--phase)');
  const max = Number(opts['max-chars'] ?? 18000);
  if (!Number.isInteger(max) || max < 1000) throw new Error('--max-chars must be an integer >= 1000');
  if (opts.turn && (!Number.isInteger(Number(opts.turn)) || Number(opts.turn) < 1)) throw new Error('Invalid turn');
  if (opts.brief && !opts.decision) throw new Error('--brief requires --decision');
  if (opts.input && (!opts.decision || !['sample', 'request', 'submit', 'authority'].includes(opts.input)))
    throw new Error('--input requires --decision and request|sample|submit|authority');
  if (opts.brief && opts.input) throw new Error('--brief cannot combine with --input');
  const review = createReview(JSON.parse(readFileSync(file, 'utf8')));
  let value, text;
  if (opts.decision) {
    const d = review.detail(opts.decision);
    if (opts.input) {
      value = opts.input === 'sample' ? d.sampleInput
        : opts.input === 'submit' ? d.outcome.submit
        : opts.input === 'authority' ? d.outcome.authority
        : d.requests.at(-1)?.input;
      if (!value) throw new Error(`D${opts.decision} ${opts.input} input unavailable; inspect --decision without --input`);
    } else if (opts.brief) {
      text = decisionBriefText(review, d);
      value = { id: d.id, turn: d.snapshot?.turn ?? null, phase: d.snapshot?.phase ?? null,
        purpose: d.purpose, queryKind: d.queryKind, source: d.source, command: d.command,
        selected: d.selected.map((c) => c.ref), tradeoff: d.tradeoff, success: d.success,
        error: d.error, flags: d.flags, evidence: d.evidence, snapshot: d.snapshot,
        candidateBriefs: (d.sampleInput?.space?.candidates ?? []).map(candidateBrief) };
    } else {
      const { sampleView, sampleInput, requests, ...compact } = d;
      value = { ...compact, effect: sampleInput?.effect ?? null, candidates: sampleInput?.space ?? null,
        context: sampleInput?.context ?? null,
        requests: requests.map(({ input, ...request }) => request) };
      text = detailText(review, d);
    }
  } else if (opts.material) value = review.material(opts.material);
  else if (opts.card) value = review.frozenCards(opts.card);
  else if (opts.sources) value = review.sources;
  else if (opts.phases) {
    const turn = opts.turn ? Number(opts.turn) : null;
    text = phasesText(review, turn, opts.phase);
    value = { coverage: review.coverage, warnings: [...review.warnings], legend: review.legend,
      phases: phaseGroups(review, turn)
        .filter((g) => !opts.phase || g.phase.toUpperCase().includes(opts.phase.toUpperCase()))
        .map(({ key, rows, ...g }) => ({ ...g, rows: rows.map((r) => ({ id: r.id, source: r.source,
          queryKind: r.queryKind, command: r.command, selected: r.selected.map((c) => c.ref),
          success: r.success, flags: r.flags })) })) };
  } else if (opts.turn || opts.timeline) {
    value = { coverage: review.coverage, warnings: [...review.warnings], legend: review.legend,
      rows: opts.turn ? review.rows.filter((r) => r.snapshot?.turn === Number(opts.turn)) : review.rows,
      publicEvents: review.publicEvents.filter((p) => !opts.turn || p.firstSeenTurn === Number(opts.turn)) };
    if (!value.rows.length) throw new Error(`No samples for turn ${opts.turn}`);
    text = timelineText(review, opts.turn ? Number(opts.turn) : null);
  } else {
    value = { coverage: review.coverage, warnings: [...review.warnings], turns: review.turns,
      decisions: review.rows.map(({ snapshot, selected, interval, ...row }) => ({ ...row, turn: snapshot?.turn, selected })), legend: review.legend };
    text = overviewText(review);
  }
  if (opts.field) { value = fieldAt(value, opts.field); text = undefined; }
  const result = opts.json ? json(value) : text ?? (typeof value === 'string' ? value : json(value));
  return boundOutput(result, max, opts.json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(cli(process.argv.slice(2)) + '\n'); }
  catch (error) { process.stderr.write(`review: ${error.message}\n`); process.exitCode = 1; }
}
