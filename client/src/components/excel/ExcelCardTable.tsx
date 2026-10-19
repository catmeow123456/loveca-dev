import { getExcelCardSummary, type ExcelCardRow } from '@/lib/excelCardView';

interface ExcelCardTableProps {
  label: string;
  showCaption?: boolean;
  showState?: boolean;
  startRow: number;
  rows: readonly ExcelCardRow[];
  count: number;
  selectedCardId: string | null;
  onSelect: (card: ExcelCardRow) => void;
}

export function ExcelCardTable({
  label,
  rows,
  count,
  selectedCardId,
  onSelect,
  showCaption = false,
  showState = false,
  startRow,
}: ExcelCardTableProps) {
  const headerRow = startRow + (showCaption ? 1 : 0);
  return (
    <table
      className={`excel-table excel-card-table${showState ? ' excel-card-table-with-state' : ''}`}
      aria-label={label}
    >
      {showCaption && (
        <caption>
          <span className="excel-axis-number" aria-hidden="true">
            {startRow}
          </span>
          {label} · {count} 张{rows.length < count ? `（${count - rows.length} 张未公开）` : ''}
        </caption>
      )}
      <colgroup>
        <col className="excel-card-row" />
        <col className="excel-card-code" />
        <col className="excel-card-name" />
        <col />
        <col className="excel-card-type" />
        <col className="excel-card-value" />
        {showState && <col className="excel-card-state" />}
      </colgroup>
      <thead>
        <tr>
          {[
            '序号',
            '卡号',
            '名称',
            '卡牌效果',
            '类型',
            '费用 / 分数',
            ...(showState ? ['状态'] : []),
          ].map((label, index) => (
            <th
              key={label}
              scope="col"
              aria-label={index === 0 ? '序号' : undefined}
              data-sheet-row={index === 0 ? headerRow : undefined}
            >
              <span className={index === 0 ? 'sr-only' : undefined}>{label}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((card, index) => {
          const { front } = card;
          const summary = getExcelCardSummary(front);
          return (
            <tr
              key={card.objectId}
              aria-selected={selectedCardId === card.cardId}
              onClick={() => onSelect(card)}
            >
              <th scope="row">{headerRow + 1 + index}</th>
              <td title={front.cardCode}>{front.cardCode}</td>
              <td>
                <button
                  title={summary.name}
                  aria-pressed={selectedCardId === card.cardId}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(card);
                  }}
                >
                  {summary.name}
                </button>
              </td>
              <td className="excel-card-effect">{summary.preview}</td>
              <td>{summary.type}</td>
              <td title={summary.valueLabel}>{summary.value}</td>
              {showState && <td title={card.state}>{card.state || '—'}</td>}
            </tr>
          );
        })}
        {!rows.length && (
          <tr>
            <th scope="row">{headerRow + 1}</th>
            <td colSpan={showState ? 6 : 5}>{count ? '没有可公开的卡牌信息' : '空'}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
