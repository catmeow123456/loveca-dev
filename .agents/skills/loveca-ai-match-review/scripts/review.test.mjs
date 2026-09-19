import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReview, expandInput, differences, fieldAt, boundOutput, cli,
  phaseGroups, phasesText, candidateBrief, decisionBriefText } from './review.mjs';

function fixture() {
  const objects = {
    a: { frontInfo: { cardCode: 'CARD-2-N', cardType: 'MEMBER', nameCn: '二费', cost: 2, blade: 1, hearts: [] } },
    b: { frontInfo: { cardCode: 'CARD-2-N', cardType: 'MEMBER', nameCn: '二费', cost: 2, blade: 1, hearts: [] } },
    c: { frontInfo: { cardCode: 'CARD-4-N', cardType: 'MEMBER', nameCn: '四费', cost: 4, blade: 2, hearts: [] } },
    energy1: { orientation: 'ACTIVE' }, energy2: { orientation: 'WAITING' },
    hidden: { surface: 'BACK' },
  };
  const zone = (zone, ownerSeat, objectIds) => ({ zone, ownerSeat, objectIds, count: objectIds.length });
  const zones = {
    hand: zone('HAND', 'SECOND', ['a', 'b']),
    otherHand: zone('HAND', 'FIRST', ['hidden']),
    energy: zone('ENERGY_ZONE', 'SECOND', ['energy1', 'energy2']),
    left: { zone: 'MEMBER_SLOT', ownerSeat: 'SECOND', count: 1, slotMap: { LEFT: 'c' }, memberBelow: { LEFT: ['a'] } },
    waiting: zone('WAITING_ROOM', 'SECOND', []),
    success: zone('SUCCESS_ZONE', 'SECOND', []),
    lives: zone('LIVE_ZONE', 'SECOND', []),
  };
  const input = { state: { turn: 2, phase: 'MAIN_PHASE', selfSeat: 'SECOND', activeSeat: 'SECOND', objects, table: { zones } },
    purpose: 'MAIN', space: { kind: 'ACTION', candidates: [
      { ref: 'a1', objectId: 'a', energyCost: 1, targetSlot: 'LEFT', description: '登场 a 左' },
      { ref: 'a2', objectId: 'a', energyCost: 1, targetSlot: 'CENTER', description: '登场 a 中' },
      { ref: 'a3', description: '结束' },
    ] }, history: { events: [{ seq: 3, type: 'PlayerDeclared', actorSeat: 'FIRST', publicValue: 1 }] } };
  const view = { match: { viewerSeat: 'SECOND', turnCount: 2, phase: 'MAIN_PHASE', activeSeat: 'SECOND', seq: 3 }, table: input.state.table, objects };
  const materials = [];
  const event = (id, stage, payload) => {
    materials.push({ id, status: 'COMPLETE', content: JSON.stringify(payload) });
    return { stage, materialId: id };
  };
  const events = [event('s1', 'SAMPLE', { queryKind: 'DECISION', input, view }),
    event('q1', 'REQUEST', { attempt: 0, body: JSON.stringify({ messages: [
      { role: 'system', content: '控制提示' }, { role: 'user', content: `本次决策\n${JSON.stringify(input)}` },
    ] }) }),
    event('v1', 'MODEL_VALIDATION', { selection: { kind: 'ACTION', actionRef: 'a3' }, tradeoff: '虚构后续收益' }),
    event('submit1', 'SUBMIT', { command: { type: 'END_PHASE' }, selection: { source: 'MODEL', selection: { kind: 'ACTION', actionRef: 'a3' } } }),
    event('result1', 'AUTHORITY_RESULT', { success: true })];
  return { format: 'loveca-ai-observation-v1', matchId: 'test', endedAt: null,
    evictedDecisions: 0, omittedDecisions: 0, captureFailures: 0, incompleteMaterialIds: [], materials,
    decisions: [{ id: '1', createdAt: 10, status: 'ACCEPTED', purpose: 'MAIN', seat: 'SECOND', sourceMaterialIds: [], omittedEvents: 0, events }] };
}
function payload(data, id) { return JSON.parse(data.materials.find((m) => m.id === id).content); }
function replace(data, id, value) { data.materials.find((m) => m.id === id).content = JSON.stringify(value); }

test('counts actual hand instances, not candidate slots, and respects the AI second seat', () => {
  const r = createReview(fixture());
  const s = r.rows[0].snapshot;
  assert.equal(s.selfSeat, 'SECOND');
  assert.equal(s.turn, 2);
  assert.deepEqual(s.players.SECOND.handCosts, { 2: 2 });
  assert.equal(s.players.SECOND.stage.length, 1);
  assert.equal(s.players.SECOND.stageCost, 4);
  assert.equal(s.players.SECOND.energy, 1);
  assert.equal(s.players.SECOND.energyTotal, 2);
  assert.equal(s.players.FIRST.handUnknown, 1);
  assert.deepEqual(s.players.FIRST.hand, []);
  assert.equal(s.players.FIRST.success, null);
});

test('never treats validated/ACCEPTED text as authority success', () => {
  const data = fixture();
  data.decisions[0].events = data.decisions[0].events.filter((e) => e.stage !== 'AUTHORITY_RESULT');
  const r = createReview(data);
  assert.equal(r.rows[0].success, null);
  assert.equal(r.rows[0].flags.length, 0);
  assert.equal(r.rows[0].tradeoff, '虚构后续收益');
  assert.equal(r.coverage.endedAt, null);
  assert.equal(r.coverage.endInfo, null);
});

test('one physical two-cost member stays one despite multiple placement choices', () => {
  const data = fixture(), sample = payload(data, 's1');
  sample.view.table.zones.hand.objectIds = ['a'];
  sample.view.table.zones.hand.count = 1;
  replace(data, 's1', sample);
  const r = createReview(data);
  assert.deepEqual(r.rows[0].snapshot.players.SECOND.handCosts, { 2: 1 });
  assert.equal(r.detail('1').sampleInput.space.candidates.filter((c) => c.objectId === 'a').length, 2);
});

test('tracks exact observed hand gains/losses and only counts stage top cards', () => {
  const data = fixture(), sample = payload(data, 's1');
  sample.view.table.zones.hand.objectIds = ['b', 'c'];
  sample.view.table.zones.left.slotMap.LEFT = 'a';
  sample.view.objects.a = { ...sample.view.objects.a, modifierDelta: { costDelta: -1 }, enteredStageThisTurn: true };
  data.materials.push({ id: 's2', status: 'COMPLETE', content: JSON.stringify(sample) });
  data.decisions.push({ id: '2', createdAt: 20, seat: 'SECOND', events: [{ stage: 'SAMPLE', materialId: 's2' }] });
  const r = createReview(data), next = r.rows[1];
  assert.deepEqual(next.interval.removed, [r.rows[0].snapshot.players.SECOND.hand[0].card]);
  assert.deepEqual(next.interval.added, [r.rows[0].snapshot.players.SECOND.stage[0].card]);
  assert.equal(next.interval.handDelta, 0);
  assert.equal(next.snapshot.players.SECOND.stage[0].cost, 2);
  assert.equal(next.snapshot.players.SECOND.stage[0].costDelta, -1);
  assert.equal(next.snapshot.players.SECOND.stage[0].enteredThisTurn, true);
});

test('read-only comparison expands references, groups, overrides, and lastAction without losing actions', () => {
  const wire = { texts: { t: '全文' }, cardFacts: { f: { cost: 2, cardTextCn: { textRef: 't' } } },
    decisionBrief: { handCount: 1 }, state: { frontInfo: { cardFactsRef: 'f' } },
    space: { memberPlays: { m: { common: { objectId: 'one-instance', energyCost: 2 }, descriptionPrefix: '前缀;' } },
      candidates: [{ ref: 'a1', memberPlayRef: 'm', description: '左' }, { ref: 'a2', memberPlayRef: 'm', description: '中', energyCost: 0 }] },
    context: { recentDecisions: [{ resultSummary: '实际结果' }], lastAction: { recentDecisionIndex: 0 } } };
  const original = structuredClone(wire);
  const result = expandInput(wire);
  assert.deepEqual(wire, original);
  assert.deepEqual(result.state.frontInfo, { cost: 2, cardTextCn: '全文' });
  assert.equal(result.space.candidates.length, 2);
  assert.equal(result.space.candidates[0].energyCost, 2);
  assert.equal(result.space.candidates[1].energyCost, 0);
  assert.equal(result.space.candidates[1].description, '前缀;中');
  assert.equal(result.context.lastAction.resultSummary, '实际结果');
  assert.deepEqual(result.decisionBrief, { handCount: 1 });
});

test('unknown and circular references fail explicitly', () => {
  assert.throws(() => expandInput({ state: { textRef: 'missing' } }), /Invalid reference/);
  assert.throws(() => expandInput({ texts: { a: { textRef: 'a' } }, state: { textRef: 'a' } }), /Invalid reference/);
  assert.throws(() => expandInput({ context: { recentDecisions: [], lastAction: { recentDecisionIndex: 0 } } }), /Invalid recent/);
});

test('compares actual request, detecting hand facts missing from HTTP rather than guessing', () => {
  const data = fixture();
  assert.equal(createReview(data).detail('1').requests[0].comparison.equal, true);
  const req = payload(data, 'q1'), body = JSON.parse(req.body);
  const input = payload(data, 's1').input;
  input.state.table.zones.hand.count = 1;
  body.messages[1].content = JSON.stringify(input);
  req.body = JSON.stringify(body);
  replace(data, 'q1', req);
  const comparison = createReview(data).detail('1').requests[0].comparison;
  assert.equal(comparison.equal, false);
  assert.deepEqual(comparison.differencePaths, ['$.state.table.zones.hand.count']);
});

test('truncated/missing samples stay unknown, even if truncated text parses', () => {
  const data = fixture();
  data.materials.find((m) => m.id === 's1').status = 'TRUNCATED';
  const r = createReview(data);
  assert.equal(r.rows[0].snapshot, null);
  assert.equal(r.coverage.samples, 0);
  assert.deepEqual(r.coverage.incompleteMaterialIds, ['s1']);
  assert.ok([...r.warnings].some((w) => w.includes('s1')));
  assert.equal(r.detail('1').requests[0].comparison, null);
});

test('interval hand movements are not assigned to one command, and hidden faces are never backfilled', () => {
  const data = fixture(), sample = payload(data, 's1');
  sample.view.objects.a = { surface: 'BACK' };
  sample.view.table.zones.hand.objectIds = ['a'];
  sample.view.table.zones.hand.count = 1;
  sample.input.history.events.push({ seq: 5, type: 'PlayerDeclared', actorSeat: 'FIRST' });
  data.materials.push({ id: 's2', status: 'COMPLETE', content: JSON.stringify(sample) });
  data.decisions.push({ id: '2', createdAt: 20, seat: 'SECOND', events: [{ stage: 'SAMPLE', materialId: 's2' }] });
  const r = createReview(data);
  assert.equal(r.rows[1].snapshot.players.SECOND.hand[0].card, '?');
  assert.equal(r.rows[1].interval.handDelta, -1);
  assert.equal(r.rows[1].interval.added, null);
  assert.equal(r.rows[1].interval.scope, 'OBSERVED_INTERVAL_NOT_SINGLE_COMMAND');
  assert.equal(r.coverage.publicEvents, 2);
  assert.deepEqual(r.coverage.publicSeqGaps, [[1, 2], [4, 4]]);
});

test('rejects unsupported formats and duplicate identities', () => {
  assert.throws(() => createReview({ format: 'other' }), /Expected/);
  const data = fixture();
  data.materials.push(data.materials[0]);
  assert.throws(() => createReview(data), /Duplicate material/);
});

test('frozen card lookup never falls back to current cards or other logs', () => {
  const data = fixture();
  data.materials.push({ id: 'source:deck:test', status: 'COMPLETE', content: JSON.stringify({
    cards: [{ count: 4, card: { cardCode: 'CARD-2-N', cost: 2, cardTextJp: '原文' } }],
  }) });
  const r = createReview(data);
  assert.equal(r.frozenCards('CARD-2')[0].count, 4);
  assert.throws(() => r.frozenCards('NO-CARD'), /No frozen card/);
});

test('safe field traversal decodes nested JSON, rejects missing/inherited properties', () => {
  assert.equal(fieldAt({ body: '{"messages":[{"content":"hello"}]}' }, 'body.messages.0.content'), 'hello');
  assert.throws(() => fieldAt({}, '__proto__'), /Field not found/);
  assert.throws(() => fieldAt({ content: 'text' }, 'content.key'), /Cannot decode/);
  assert.deepEqual(differences({ a: 2 }, { a: 4 }), ['$.a']);
  assert.ok(cli(['--help']).includes('--decision'));
  assert.throws(() => cli(['unused', '--turn', '2', '--decision', '1']), /one report mode/);
});

test('keeps JSON valid or refuses output rather than silently cutting evidence', () => {
  assert.equal(boundOutput('{"a":1}', 1000, true), '{"a":1}');
  assert.throws(() => boundOutput(jsonLarge(), 1000, true), /JSON not truncated/);
  assert.match(boundOutput('甲'.repeat(2000), 1000), /输出截短/);
  function jsonLarge() { return JSON.stringify({ content: 'a'.repeat(2000) }); }
});

test('normal model outcomes are diagnostic events, not failures', () => {
  const data = fixture();
  data.materials.push({ id: 'out', status: 'COMPLETE', content: JSON.stringify({ outcome: { kind: 'RESPONSE', text: '{}' } }) });
  data.decisions[0].events.push({ stage: 'MODEL_OUTCOME', materialId: 'out' });
  const d = createReview(data).detail('1');
  assert.equal(d.outcome.failures, undefined);
  assert.equal(d.outcome.diagnosticEvents[0].payload.outcome.kind, 'RESPONSE');
});

function phaseFixture() {
  const data = fixture(), sample = payload(data, 's1');
  // D2: same MAIN_PHASE, waiting sample without submit; one active energy is now exhausted.
  const s2 = structuredClone(sample);
  s2.view.match.seq = 4;
  s2.view.objects.energy1.orientation = 'WAITING';
  data.materials.push({ id: 's2', status: 'COMPLETE', content: JSON.stringify(s2) });
  data.decisions.push({ id: '2', createdAt: 20, seat: 'SECOND', events: [{ stage: 'SAMPLE', materialId: 's2' }] });
  // D3: LIVE_SET_PHASE model decision, the phase's last sample in this log.
  const s3 = structuredClone(s2);
  s3.view.match.phase = 'LIVE_SET_PHASE';
  s3.view.match.seq = 5;
  data.materials.push(
    { id: 's3', status: 'COMPLETE', content: JSON.stringify(s3) },
    { id: 'submit3', status: 'COMPLETE', content: JSON.stringify({ command: { type: 'SET_LIVE_CARD' },
      selection: { source: 'MODEL', selection: { kind: 'ACTION', actionRef: 'a1' } } }) },
    { id: 'result3', status: 'COMPLETE', content: JSON.stringify({ success: true }) });
  data.decisions.push({ id: '3', createdAt: 30, seat: 'SECOND', events: [
    { stage: 'SAMPLE', materialId: 's3' }, { stage: 'SUBMIT', materialId: 'submit3' },
    { stage: 'AUTHORITY_RESULT', materialId: 'result3' }] });
  return data;
}

test('phase recap diffs entry→exit via the next sample and collapses waiting runs', () => {
  const r = createReview(phaseFixture());
  const groups = phaseGroups(r);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].phase, 'MAIN_PHASE');
  assert.deepEqual(groups[0].rows.map((x) => x.id), ['1', '2']);
  assert.equal(groups[0].exitSource, 'D3 采样');
  assert.equal(groups[1].phase, 'LIVE_SET_PHASE');
  assert.match(groups[1].exitSource, /末采样/);
  const text = phasesText(r);
  assert.match(text, /T2 · MAIN_PHASE（D1→D2；/);
  assert.match(text, /E1\/2→E0\/2/);
  assert.match(text, /- D2 等待采样/);
  assert.match(text, /- D3 \[MODEL\] SET_LIVE_CARD ✓ a1:登场 a 左→LEFT 实付1/);
  assert.match(phasesText(r, null, 'live_set'), /T2 · LIVE_SET_PHASE/);
  assert.throws(() => phasesText(r, null, 'PERFORMANCE'), /No phase samples/);
  assert.throws(() => phasesText(r, 5), /No phase samples for turn 5/);
});

test('candidate brief keeps identity, slot, replace target, payment and board ledger', () => {
  assert.equal(candidateBrief({ ref: 'a4', targetSlot: 'RIGHT', energyCost: 1,
    description: '登场 PL!HS-PR-023-PR 费用 11「桂城泉」；替换 PL!N-bp1-003-P+ 费用 10「樱坂雫」，旧成员当前有效值：HEART 4；支付 1，能量 7→6；HEART 5→3，活跃 BLADE 4→8；未预结算' }),
  '- a4 登场 PL!HS-PR-023-PR 费用 11「桂城泉」 ［→RIGHT 换「樱坂雫」(10) 付1(E7→6) HEART 5→3 BLADE 4→8］');
  assert.equal(candidateBrief({ ref: 'a3', description: '结束' }), '- a3 结束');
});

test('decision brief bundles context, compressed candidates, model output and drill-down entries', () => {
  const data = fixture(), sample = payload(data, 's1');
  sample.input.space.candidates[0].description =
    '登场 PL!N-bp4-013-N 费用 4「上原步梦」；手牌 6→5；支付 4，能量 7→3；HEART 5→7，活跃 BLADE 4→4';
  replace(data, 's1', sample);
  const req = payload(data, 'q1'), body = JSON.parse(req.body);
  body.messages[1].content = `本次决策\n${JSON.stringify(sample.input)}`;
  req.body = JSON.stringify(body);
  replace(data, 'q1', req);
  const r = createReview(data);
  const text = decisionBriefText(r, r.detail('1'));
  assert.match(text, /# D1 速览 \/ T2 \/ MAIN_PHASE/);
  assert.match(text, /- a1 登场 PL!N-bp4-013-N 费用 4「上原步梦」 ［→LEFT 付4\(E7→3\) HEART 5→7 BLADE 4→4］/);
  assert.match(text, /请求：q1 messages\[system:4,user:\d+\]/);
  assert.match(text, /REQUEST↔SAMPLE 动态事实：一致/);
  assert.match(text, /模型输出：来源=MODEL；命令=END_PHASE；选择=a3/);
  assert.match(text, /自述（非事实）：虚构后续收益/);
  assert.match(text, /权威结果：成功=true/);
  assert.match(text, /--decision 1 --input submit（模型输出原始载荷）/);
});

test('cli enforces the new mode combinations and payload entries', () => {
  assert.ok(cli(['--help']).includes('--phases'));
  assert.throws(() => cli(['unused', '--brief']), /--brief requires --decision/);
  assert.throws(() => cli(['unused', '--decision', '1', '--brief', '--input', 'submit']), /cannot combine/);
  assert.throws(() => cli(['unused', '--decision', '1', '--input', 'bogus']), /--input requires/);
  assert.throws(() => cli(['unused', '--timeline', '--phases']), /one report mode/);
  assert.throws(() => cli(['unused', '--turn', '2', '--decision', '1']), /one report mode/);
  assert.throws(() => cli(['nonexistent.json', '--phase', 'MAIN', '--turn', '2']), /ENOENT/);
  assert.throws(() => cli(['nonexistent.json', '--decision', '1', '--input', 'authority']), /ENOENT/);
});
