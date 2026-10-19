import { useBattleConnection } from '@/lib/battleConnection';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useBattleCommandSubmission } from '@/lib/battleCommandSubmission';
import { useAppPresentation } from '@/lib/appPresentation';
import { isBattleFeedbackEventExpired } from '@/lib/battleActionFeedback';
import { formatTextHearts, selectExcelCard, type ExcelCardRow } from '@/lib/excelCardView';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { CardEffectText } from '@/components/card/CardEffectText';
import { ExcelCardTable } from './ExcelCardTable';
import { ExcelColumnHeadings } from './ExcelRibbon';
import { PublicBattleLogContent } from '@/components/game/PublicBattleLog';
import type { SelectedHandCardAction } from '@/components/game/PlayerArea';
import type { BattleActionIntent, BattleActionCommandPayload } from '@/lib/battleActionIntent';
import {
  CardAbilitySourceZone,
  getActivatedAbilityUiConfigs,
  isActivatedAbilityUiConfigAvailableForOrientation,
} from '@game/application/card-effect-runner';
import { GameCommandType } from '@game/application/game-commands';
import { CardType, OrientationState, SlotPosition, ZoneType } from '@game/shared/types/enums';
import type { PlayerViewState, Seat, ViewZoneKey } from '@game/online/types';

const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const SLOT_NAMES = { LEFT: '左', CENTER: '中', RIGHT: '右' };
const ZONES: readonly [ZoneType, string][] = [
  [ZoneType.ENERGY_ZONE, '能量区'],
  [ZoneType.ENERGY_DECK, '能量卡组'],
  [ZoneType.MAIN_DECK, '主卡组'],
  [ZoneType.SUCCESS_ZONE, '成功区'],
  [ZoneType.EXILE_ZONE, '除外区'],
  [ZoneType.INSPECTION_ZONE, '检视区'],
  [ZoneType.RESOLUTION_ZONE, '解决区'],
];

interface ExcelBattleBoardProps {
  view: PlayerViewState;
  phaseLabel: string;
  actions: ReactNode;
  judgment: ReactNode;
  header: ReactNode;
  headerOverlay: ReactNode;
  buildActions: (cardId: string, zone: ZoneType) => readonly BattleActionIntent[];
  execute: (payload: BattleActionCommandPayload) => boolean;
  handActions: readonly SelectedHandCardAction[];
  handActionCardId: string | null;
  onHandAction: (cardId: string, actionId: string) => void;
  onLeave?: () => void;
  onRestart?: () => void;
}

export function ExcelBattleBoard({
  view,
  phaseLabel,
  actions,
  judgment,
  header,
  headerOverlay,
  buildActions,
  execute,
  handActions,
  handActionCardId,
  onHandAction,
  onLeave,
  onRestart,
}: ExcelBattleBoardProps) {
  const [sheet, setSheet] = useState('对局');
  const [handExpanded, setHandExpanded] = useState(false);
  const worksheetRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const worksheet = worksheetRef.current;
    const scroller = worksheet?.querySelector<HTMLElement>('.excel-hand, .excel-zone-sheet');
    if (!worksheet || !scroller) return;
    // Classic scrollbars consume width; all frozen regions must share that same data edge.
    const alignColumns = () =>
      worksheet.style.setProperty(
        '--excel-scrollbar-gutter',
        `${scroller.offsetWidth - scroller.clientWidth}px`
      );
    const observer = new ResizeObserver(alignColumns);
    observer.observe(scroller);
    alignColumns();
    return () => observer.disconnect();
  }, [sheet, handExpanded]);
  const selectedPane = useRef<HTMLElement>(null);
  const selectedCardId = useGameStore((state) => state.ui.selectedCardId);
  useEffect(() => {
    if (selectedPane.current) selectedPane.current.scrollTop = 0;
  }, [selectedCardId]);
  const feedback = useGameStore((state) => state.ui.battleFeedbackEvents);
  const [, refreshFeedback] = useState(0);
  const currentFeedback = feedback.filter((item) => !isBattleFeedbackEventExpired(item)).at(-1);
  useEffect(() => {
    if (!currentFeedback) return;
    const timer = window.setTimeout(
      () => refreshFeedback((value) => value + 1),
      Math.max(0, currentFeedback.createdAt + currentFeedback.durationMs - Date.now())
    );
    return () => window.clearTimeout(timer);
  }, [currentFeedback]);
  const pending = useBattleCommandSubmission((state) => state.pendingCount > 0);
  const connection = useBattleConnection();
  const notice = useAppPresentation((state) => state.notice);
  const self = view.match.viewerSeat;
  const opponent: Seat = self === 'FIRST' ? 'SECOND' : 'FIRST';
  const selected = selectedCardId ? selectExcelCard(view, `obj_${selectedCardId}`) : null;
  const store = useGameStore.getState();
  const capabilities = store.getBattleSurfaceCapabilities();
  const selectedZone = selected ? store.findViewerCardZone(selected.cardId) : null;
  const ownSelected = selected?.object.ownerSeat === self && !capabilities.isReadOnly;
  const intents =
    selected && selectedZone && ownSelected ? buildActions(selected.cardId, selectedZone) : [];
  const abilityZone =
    selectedZone === ZoneType.HAND
      ? CardAbilitySourceZone.HAND
      : selectedZone === ZoneType.WAITING_ROOM
        ? CardAbilitySourceZone.WAITING_ROOM
        : selectedZone === ZoneType.MEMBER_SLOT
          ? CardAbilitySourceZone.STAGE_MEMBER
          : null;
  const abilities =
    ownSelected && selected && abilityZone && store.canUseAction(GameCommandType.ACTIVATE_ABILITY)
      ? (
          selected.object.activatedAbilityUiConfigs ??
          (selected.object.activatedAbilityUiConfig
            ? [selected.object.activatedAbilityUiConfig]
            : getActivatedAbilityUiConfigs(selected.front.cardCode, abilityZone))
        ).filter((ability) =>
          isActivatedAbilityUiConfigAvailableForOrientation(ability, selected.object.orientation)
        )
      : [];
  const select = (card: ExcelCardRow) => {
    // A prior hover or mulligan detail must not duplicate the pinned card pane.
    store.setCardDetail(null);
    store.selectCard(card.cardId);
  };
  const detail = select;
  const visibleZone = (seat: Seat, zone: ZoneType) =>
    view.table.zones[`${seat}_${zone}` as ViewZoneKey];
  const rowsFor = (seat: Seat, zone: ZoneType) =>
    (visibleZone(seat, zone)?.objectIds ?? []).flatMap((id) => {
      const row = selectExcelCard(view, id);
      return row ? [row] : [];
    });
  const handRows = rowsFor(self, ZoneType.HAND);
  const handCount = visibleZone(self, ZoneType.HAND)?.count ?? 0;
  const availableEnergy = (visibleZone(self, ZoneType.ENERGY_ZONE)?.objectIds ?? []).filter(
    (id) => view.objects[id]?.orientation === OrientationState.ACTIVE
  ).length;
  const selectedText = selected ? getCardLocalizedInfo(selected.front) : null;
  const selectedEffect = selectedText?.effectCn ?? selectedText?.effectJp;
  const selectedHandIndex = handRows.findIndex((card) => card.cardId === selectedCardId);
  const selectedSlot = selected ? store.getCardSlotPosition(selected.cardId) : null;
  const selectedReference =
    selectedHandIndex >= 0
      ? `手牌 ${selectedHandIndex + 1}`
      : selectedSlot
        ? `${selected?.object.controllerSeat === self ? '我方' : '对方'} · ${SLOT_NAMES[selectedSlot]}`
        : selected?.front.cardCode;
  const stageSlots = (seat: Seat) => (seat === self ? SLOTS : [...SLOTS].reverse());
  const belowIds = (seat: Seat) =>
    SLOTS.flatMap((slot) => {
      const zone = view.table.zones[`${seat}_MEMBER_${slot}` as ViewZoneKey];
      return [...(zone?.overlays?.[slot] ?? []), ...(zone?.memberBelow?.[slot] ?? [])];
    });
  const zoneSections =
    sheet === '休息室'
      ? [self, opponent].map((seat) => ({
          label: `${seat === self ? '我方' : '对方'}休息室`,
          rows: rowsFor(seat, ZoneType.WAITING_ROOM),
          count: visibleZone(seat, ZoneType.WAITING_ROOM)?.count ?? 0,
        }))
      : sheet === '其他区域'
        ? [
            ...[self, opponent].map((seat) => ({
              label: `${seat === self ? '我方' : '对方'}下置卡牌`,
              rows: belowIds(seat).flatMap((id) => {
                const card = selectExcelCard(view, id);
                return card ? [card] : [];
              }),
              count: belowIds(seat).length,
            })),
            ...ZONES.flatMap(([zone, label]) =>
              [self, opponent].map((seat) => ({
                label: `${seat === self ? '我方' : '对方'}${label}`,
                rows: rowsFor(seat, zone),
                count: visibleZone(seat, zone)?.count ?? 0,
              }))
            ),
          ]
        : [];
  let nextRow = 1;
  const numberedZones = zoneSections.map((zone) => {
    const startRow = nextRow;
    nextRow += 2 + Math.max(1, zone.rows.length);
    return { ...zone, startRow };
  });
  const tabularSheet = ['对局', '休息室', '其他区域'].includes(sheet);
  const selectedZoneSection = numberedZones.find((zone) =>
    zone.rows.some((card) => card.cardId === selectedCardId)
  );
  const selectedCoordinate = selectedZoneSection
    ? `C${selectedZoneSection.startRow + 2 + selectedZoneSection.rows.findIndex((card) => card.cardId === selectedCardId)}`
    : sheet === '对局' && selectedHandIndex >= 0
      ? `C${10 + selectedHandIndex}`
      : sheet === '对局' && selectedSlot && selected
        ? `${['A', 'E', 'I'][stageSlots(selected.object.controllerSeat).indexOf(selectedSlot)]}${selected.object.controllerSeat === self ? 6 : 3}`
        : 'A1';
  const stage = (seat: Seat, label: string) => {
    const startRow = seat === self ? 4 : 1;
    return (
      <table className="excel-table excel-stage" aria-label={label}>
        <caption>
          <span className="excel-axis-number" aria-hidden="true">
            {startRow}
          </span>
          {label} · {store.getPlayerIdentityForSeat(seat)?.name ?? label} · 手牌{' '}
          {visibleZone(seat, ZoneType.HAND)?.count ?? 0} · 主卡组{' '}
          {visibleZone(seat, ZoneType.MAIN_DECK)?.count ?? 0}
        </caption>
        <thead>
          <tr>
            <th className="excel-axis-number" aria-hidden="true">
              {startRow + 1}
            </th>
            {stageSlots(seat).map((slot) => (
              <th key={slot} scope="col" className="excel-stage-column">
                {SLOT_NAMES[slot]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="excel-axis-number" aria-hidden="true">
              {startRow + 2}
            </th>
            {stageSlots(seat).map((slot) => {
              const zone = view.table.zones[`${seat}_MEMBER_${slot}` as ViewZoneKey];
              const id = zone?.slotMap?.[slot];
              const card = id ? selectExcelCard(view, id) : null;
              const text = card ? getCardLocalizedInfo(card.front) : null;
              const effect = text?.effectCn ?? text?.effectJp;
              return (
                <td key={slot}>
                  <div
                    className="excel-stage-cell"
                    tabIndex={0}
                    aria-label={`${label} · ${SLOT_NAMES[slot]}`}
                  >
                    {card ? (
                      <>
                        <div className="excel-stage-identity">
                          <button onClick={() => select(card)}>
                            {text?.nameCn ?? text?.nameJp ?? card.front.cardCode}
                          </button>
                          <span className="excel-stage-card-code">{card.front.cardCode}</span>
                        </div>
                        <dl className="excel-stage-attributes">
                          <div>
                            <dt>费用</dt>
                            <dd>
                              {card.front.cost === undefined
                                ? '—'
                                : card.front.cost + (card.front.modifierDelta?.costDelta ?? 0)}
                              {!!card.front.modifierDelta?.costDelta && (
                                <span>（印刷 {card.front.cost}）</span>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>光棒</dt>
                            <dd>{card.front.blade ?? '—'}</dd>
                          </div>
                          <div>
                            <dt>心</dt>
                            <dd>{formatTextHearts(card.front.hearts)}</dd>
                          </div>
                        </dl>
                        <div className="excel-stage-effect">
                          {effect ? <CardEffectText text={effect} /> : '无效果'}
                        </div>
                        <p>
                          {card.state && `${card.state} · `}下置能量{' '}
                          {zone?.overlays?.[slot]?.length ?? 0} · 下置成员{' '}
                          {zone?.memberBelow?.[slot]?.length ?? 0}
                        </p>
                      </>
                    ) : id ? (
                      '未知成员'
                    ) : (
                      '空位'
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    );
  };
  const zoneControls = <ExcelZoneControls view={view} />;
  return (
    <main className="excel-battle" data-testid="excel-battle">
      <div className="excel-formula">
        <span>{selectedCoordinate}</span>
        <span className="excel-formula-fx" aria-hidden="true">
          fx
        </span>
        <span>
          {selected
            ? `${selected.label} · ${selected.front.cardCode} · ${selectedReference}`
            : '选择单元格以查看详情或执行合法操作'}
        </span>
      </div>
      <div className="excel-status">
        <span>
          回合 {view.match.turnCount} · {phaseLabel}
        </span>
        <span>
          行动方：
          {store.getPlayerIdentityForSeat(store.getActiveSeatView() ?? self)?.name ?? '等待同步'}
        </span>
        <span>
          {pending
            ? '提交中…'
            : !store.remoteSession
              ? '本地对局'
              : connection.matchId !== view.match.matchId || connection.state === 'connecting'
                ? '连接中…'
                : connection.state === 'retrying'
                  ? '连接中断，正在重试'
                  : '已连接'}
        </span>
        {header}
      </div>
      <div className="excel-battle-grid">
        <section
          className={`excel-board-data${handExpanded ? ' excel-hand-expanded' : ''}`}
          aria-label="工作表内容"
        >
          <div
            ref={worksheetRef}
            className={`excel-worksheet${tabularSheet ? ' excel-worksheet-tabular' : ''}${sheet === '其他区域' ? ' excel-worksheet-with-state' : ''}`}
          >
            {tabularSheet && <ExcelColumnHeadings withState={sheet === '其他区域'} />}
            {sheet === '对局' ? (
              <>
                <div className="excel-stage-area">
                  {stage(opponent, '对方场面')}
                  {stage(self, '我方场面')}
                </div>
                <div className="excel-live-summary" aria-label="双方 LIVE 摘要">
                  <span className="excel-axis-number" aria-hidden="true">
                    7
                  </span>
                  {[opponent, self].map((seat) => (
                    <section key={seat}>
                      <strong>
                        {seat === self ? '我方' : '对方'} LIVE · 得分{' '}
                        {seat === self ? store.getViewerLiveScore() : store.getOpponentLiveScore()}
                        {' · '}LIVE {visibleZone(seat, ZoneType.LIVE_ZONE)?.count ?? 0} 张 · 成功区{' '}
                        {visibleZone(seat, ZoneType.SUCCESS_ZONE)?.count ?? 0} 张
                      </strong>
                      <div className="excel-live-cards">
                        {rowsFor(seat, ZoneType.LIVE_ZONE).map((card) => (
                          <button key={card.objectId} onClick={() => detail(card)}>
                            {card.label} · {card.metrics} ·{' '}
                            {card.object.judgmentResult === undefined
                              ? '待判定'
                              : card.object.judgmentResult
                                ? '成功'
                                : '失败'}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                <section className="excel-hand-area" aria-label="手牌概览">
                  <div className="excel-hand-summary">
                    <span className="excel-axis-number" aria-hidden="true">
                      8
                    </span>
                    <strong>手牌 {handCount} 张</strong>
                    <span>
                      成员{' '}
                      {handRows.filter((card) => card.front.cardType === CardType.MEMBER).length}
                    </span>
                    <span>
                      LIVE {handRows.filter((card) => card.front.cardType === CardType.LIVE).length}
                    </span>
                    <span>可用能量 {availableEnergy}</span>
                    {handRows.length < handCount && (
                      <span>未公开 {handCount - handRows.length} 张</span>
                    )}
                    <button
                      aria-expanded={handExpanded}
                      onClick={() => setHandExpanded((value) => !value)}
                    >
                      {handExpanded ? '收起手牌' : '展开手牌'}
                    </button>
                  </div>
                  <div className="excel-hand">
                    <ExcelCardTable
                      label="我方手牌"
                      startRow={9}
                      rows={handRows}
                      count={handCount}
                      selectedCardId={selectedCardId}
                      onSelect={select}
                    />
                  </div>
                </section>
              </>
            ) : sheet === '休息室' || sheet === '其他区域' ? (
              <div className="excel-sheet-scroll excel-zone-sheet">
                {sheet === '其他区域' && zoneControls}
                {numberedZones.map((zone) => (
                  <div className="excel-zone-table" key={zone.label}>
                    <ExcelCardTable
                      {...zone}
                      selectedCardId={selectedCardId}
                      onSelect={select}
                      showCaption
                      showState={zone.rows.some((card) => card.state)}
                    />
                  </div>
                ))}
              </div>
            ) : sheet === '公开记录' ? (
              <PublicBattleLogContent active={sheet === '公开记录'} />
            ) : sheet === '详情' ? (
              <div className="excel-sheet-scroll excel-full-details">
                {selected ? (
                  <>
                    <h2>
                      {selected.label} · {selectedReference}
                    </h2>
                    <p>{selected.front.cardCode}</p>
                    <p>{selected.metrics}</p>
                    {selected.state && <p>{selected.state}</p>}
                    {selected.front.cardTextCn && (
                      <CardEffectText text={selected.front.cardTextCn} />
                    )}
                    {selected.front.cardTextJp && (
                      <CardEffectText text={selected.front.cardTextJp} />
                    )}
                  </>
                ) : (
                  <p>请先选择一张可见卡牌。</p>
                )}
              </div>
            ) : (
              <div className="excel-sheet-scroll">
                <h2>对局设置</h2>
                {notice && <p>{notice}</p>}
                {capabilities.showFreePlayControl && (
                  <button
                    disabled={
                      !view.match.manualOperation.canSwitchNow ||
                      !!view.match.manualOperation.pendingRequest
                    }
                    onClick={() =>
                      store.setFreePlayEnabled(view.match.manualOperation.mode !== 'FREE')
                    }
                  >
                    {view.match.manualOperation.mode === 'FREE' ? '恢复规则模式' : '请求自由模式'}
                  </button>
                )}
                {capabilities.undoPolicy !== 'NONE' && (
                  <button disabled={!store.canUndoLastStep()} onClick={store.undoLastStep}>
                    {capabilities.undoPolicy === 'REMOTE_REQUEST' ? '请求撤销' : '撤销'}
                  </button>
                )}
                {onRestart && capabilities.canRestart && (
                  <button onClick={onRestart}>重开对局</button>
                )}
                {onLeave && <button onClick={onLeave}>返回</button>}
                {capabilities.canSwitchPerspective && (
                  <button
                    onClick={() => {
                      const identity = store.getPlayerIdentityForSeat(opponent);
                      if (identity) store.setViewingPlayer(identity.id);
                    }}
                  >
                    切换到对方视角
                  </button>
                )}
                <p>遮挡期间对局和计时继续运行。</p>
              </div>
            )}
          </div>
        </section>
        <aside className="excel-current-operation excel-operation-panels" aria-label="当前操作">
          <div className="excel-operation-task">
            <h2>当前操作</h2>
            {sheet !== '对局' && <button onClick={() => setSheet('对局')}>返回对局工作表</button>}
            {view.match.entrance && <p role="status">等待登场同步完成</p>}
            <div className="excel-operation-overview">{headerOverlay}</div>
            {view.match.endInfo && (
              <section role="status" className="excel-match-result">
                <h3>对局结束</h3>
                <p>
                  {view.match.endInfo.winnerSeat === null
                    ? '本局无胜者'
                    : view.match.endInfo.winnerSeat === self
                      ? '我方获胜'
                      : '对方获胜'}
                </p>
                <p>
                  结束原因：
                  {
                    {
                      VICTORY_CONDITION: '达成胜利条件',
                      OPPONENT_SURRENDER: '认输',
                      DRAW: '平局',
                      CARD_EFFECT: '卡牌效果',
                      INFINITE_LOOP: '循环判定平局',
                    }[view.match.endInfo.reason]
                  }
                </p>
                {onLeave && <button onClick={onLeave}>返回</button>}
              </section>
            )}
            <fieldset
              disabled={pending || !!view.match.entrance || !!view.match.endInfo}
              className="excel-command-controls"
            >
              {actions}
              {judgment}
            </fieldset>
            {pending && <p role="status">提交中，请等待权威状态更新。</p>}
            {currentFeedback && (
              <p role="status">
                {currentFeedback.label}
                {currentFeedback.detail ? `：${currentFeedback.detail}` : ''}
              </p>
            )}
          </div>
          {selected ? (
            <section ref={selectedPane} className="excel-selected-card" aria-label="选中卡牌">
              <header>
                <h2>{selectedText?.nameCn ?? selectedText?.nameJp ?? selected.front.cardCode}</h2>
                <span>
                  {selectedReference} · {selected.front.cardCode}
                </span>
              </header>
              <p>
                {selected.front.cardType === CardType.LIVE
                  ? 'LIVE'
                  : selected.front.cardType === CardType.MEMBER
                    ? '成员'
                    : '能量'}{' '}
                · {selected.metrics}
              </p>
              {selected.state && <p>{selected.state}</p>}
              <fieldset
                disabled={pending || !!view.match.entrance || !!view.match.endInfo}
                className="excel-command-controls"
              >
                {ownSelected && (
                  <section className="excel-selected-actions">
                    <h3>可用操作</h3>
                    {handActionCardId === selected.cardId &&
                      handActions.map((action) => (
                        <button
                          key={action.id}
                          title={action.title}
                          onClick={() => onHandAction(selected.cardId, action.id)}
                        >
                          {action.text}
                        </button>
                      ))}
                    {intents.flatMap((intent) =>
                      intent.targets.map((target) => (
                        <button
                          key={`${intent.intentId}:${target.targetId}`}
                          disabled={!target.enabled || !target.commandPayload}
                          title={target.reason}
                          onClick={() => {
                            if (target.enabled && target.commandPayload)
                              execute(target.commandPayload);
                          }}
                        >
                          {intent.label} · {target.label}
                          {target.detail ? ` · ${target.detail}` : ''}
                          {!target.enabled && target.reason ? `（${target.reason}）` : ''}
                        </button>
                      ))
                    )}
                    {abilities.map((ability) => (
                      <button
                        key={ability.abilityInstanceId ?? ability.abilityId}
                        onClick={() =>
                          store.activateCardAbility(
                            selected.cardId,
                            ability.abilityId,
                            ability.abilityInstanceId
                          )
                        }
                      >
                        <CardEffectText as="span" text={ability.title || ability.text} />
                      </button>
                    ))}
                    <ExcelSelectedActions card={selected} zone={selectedZone} view={view} />
                  </section>
                )}
              </fieldset>
              <div className="excel-selected-effect">
                <h3>完整卡效</h3>
                {selectedEffect ? <CardEffectText text={selectedEffect} /> : <p>无效果</p>}
              </div>
            </section>
          ) : (
            <p className="excel-selection-hint">点选表格中的卡牌，在此查看完整卡效和可用操作。</p>
          )}
        </aside>
      </div>
      <nav className="excel-sheets" aria-label="工作表">
        {['对局', '休息室', '其他区域', '公开记录', '详情', '设置'].map((name) => (
          <button
            key={name}
            aria-current={sheet === name ? 'page' : undefined}
            onClick={() => setSheet(name)}
          >
            {name}
          </button>
        ))}
      </nav>
    </main>
  );
}

function ExcelZoneControls({ view }: { view: PlayerViewState }) {
  const [count, setCount] = useState('1');
  const store = useGameStore.getState();
  const can = (command: GameCommandType) =>
    !store.getBattleSurfaceCapabilities().isReadOnly && store.canUseAction(command);
  const numericCount = Number(count);
  return (
    <div className="excel-zone-controls">
      {can(GameCommandType.DRAW_CARD_TO_HAND) && (
        <button onClick={store.drawCardToHand}>抽一张牌</button>
      )}
      {can(GameCommandType.OPEN_INSPECTION) && (
        <>
          <label>
            检视数量{' '}
            <input
              type="number"
              min="1"
              step="1"
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
          </label>
          {([ZoneType.MAIN_DECK, ZoneType.ENERGY_DECK] as const).map((zone) => (
            <button
              key={zone}
              disabled={
                !count ||
                !Number.isInteger(numericCount) ||
                numericCount < 1 ||
                numericCount >
                  (view.table.zones[`${view.match.viewerSeat}_${zone}` as ViewZoneKey]?.count ??
                    0) ||
                !store.isZoneInCommandScope(
                  GameCommandType.OPEN_INSPECTION,
                  `${view.match.viewerSeat}_${zone}` as ViewZoneKey
                )
              }
              onClick={() => store.openInspection(zone, numericCount)}
            >
              {zone === ZoneType.MAIN_DECK ? '检视主卡组' : '检视能量卡组'}
            </button>
          ))}
        </>
      )}
      {can(GameCommandType.FINISH_INSPECTION) && (
        <button onClick={store.finishInspection}>完成检视</button>
      )}
    </div>
  );
}

function ExcelSelectedActions({
  card,
  zone,
  view,
}: {
  card: ExcelCardRow;
  zone: ZoneType | null;
  view: PlayerViewState;
}) {
  const store = useGameStore.getState();
  const slot = store.getCardSlotPosition(card.cardId);
  const can = (command: GameCommandType) =>
    store.canUseAction(command) && store.isCardInCommandScope(command, card.cardId);
  const ids =
    view.table.zones[`${view.match.viewerSeat}_INSPECTION_ZONE` as ViewZoneKey]?.objectIds ?? [];
  const index = ids.indexOf(card.objectId);
  return (
    <>
      {zone === ZoneType.MEMBER_SLOT && slot && can(GameCommandType.TAP_MEMBER) && (
        <button onClick={() => store.tapMember(card.cardId, slot)}>切换活跃 / 等待</button>
      )}
      {zone === ZoneType.ENERGY_ZONE && can(GameCommandType.TAP_ENERGY) && (
        <button onClick={() => store.tapEnergy(card.cardId)}>切换能量状态</button>
      )}
      {zone === ZoneType.HAND && can(GameCommandType.RETURN_HAND_CARD_TO_TOP) && (
        <button onClick={() => store.returnHandCardToTop(card.cardId)}>放回主卡组顶</button>
      )}
      {zone === ZoneType.ENERGY_DECK && can(GameCommandType.DRAW_ENERGY_TO_ZONE) && (
        <button onClick={() => store.drawEnergyToZone(card.cardId)}>放到能量区</button>
      )}
      {zone === ZoneType.INSPECTION_ZONE && can(GameCommandType.REVEAL_INSPECTED_CARD) && (
        <button onClick={() => store.revealInspectedCard(card.cardId)}>公开此卡</button>
      )}
      {zone === ZoneType.INSPECTION_ZONE && can(GameCommandType.REORDER_INSPECTED_CARD) && (
        <>
          <button
            disabled={index <= 0}
            onClick={() => store.reorderInspectedCard(card.cardId, index - 1)}
          >
            上移
          </button>
          <button
            disabled={index < 0 || index >= ids.length - 1}
            onClick={() => store.reorderInspectedCard(card.cardId, index + 1)}
          >
            下移
          </button>
        </>
      )}
    </>
  );
}
