import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { registerCoverKeyboard, useAppPresentation, WORKBOOK_ICON } from '@/lib/appPresentation';
import { ExcelRibbon, ExcelRibbonTabs } from './ExcelRibbon';

const ROWS = 80;
const COLUMNS = 26;
const CELL_LIMIT = 2000;
const STORAGE_KEY = 'loveca.presentation.workbook';
const columnNames = Array.from({ length: COLUMNS }, (_, index) => String.fromCharCode(65 + index));
type Cells = Record<string, string>;
type Position = readonly [row: number, column: number];
// Also retain edits across cover/uncover when browser storage is unavailable.
let memoryCells: Cells | null = null;
const addressOf = ([row, column]: Position) => `${columnNames[column]}${row + 1}`;

function readCells(): Cells {
  if (memoryCells) return memoryCells;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return (memoryCells = {});
    const cells: Cells = {};
    for (const [address, value] of Object.entries(saved)) {
      if (/^[A-Z]([1-9]|[1-7][0-9]|80)$/.test(address) && typeof value === 'string')
        cells[address] = value.slice(0, CELL_LIMIT);
    }
    memoryCells = cells;
  } catch {
    // Keep this page usable if stored text is corrupt or storage is blocked.
  }
  return (memoryCells ??= {});
}

/** A local scratch worksheet, deliberately independent of the game store and player data. */
export function WorksheetCover() {
  const restore = useAppPresentation((state) => state.setCovered);
  const [cells, setCells] = useState(readCells);
  const [selected, setSelected] = useState<Position>([0, 0]);
  const [saveStatus, setSaveStatus] = useState('本地文档');
  const cellInput = useRef<HTMLInputElement>(null);
  const formulaInput = useRef<HTMLInputElement>(null);
  const address = addressOf(selected);
  const value = cells[address] ?? '';

  useLayoutEffect(() => {
    cellInput.current?.focus({ preventScroll: true });
    cellInput.current?.closest('td')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  const save = (next: Cells) => {
    memoryCells = next;
    setCells(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSaveStatus('已保存在此标签页');
    } catch {
      setSaveStatus('已暂存，刷新前请复制内容');
    }
  };
  const edit = (text: string) => {
    const next = { ...cells };
    if (text) next[address] = text.slice(0, CELL_LIMIT);
    else delete next[address];
    save(next);
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (!/[\t\r\n]/.test(text)) return; // Native paste preserves the current text selection.
    event.preventDefault();
    const next = { ...cells };
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    for (const [rowOffset, line] of lines.slice(0, ROWS - selected[0]).entries()) {
      for (const [columnOffset, content] of line
        .split('\t')
        .slice(0, COLUMNS - selected[1])
        .entries()) {
        const target = addressOf([selected[0] + rowOffset, selected[1] + columnOffset]);
        if (content) next[target] = content.slice(0, CELL_LIMIT);
        else delete next[target];
      }
    }
    save(next);
  };

  useEffect(
    () =>
      registerCoverKeyboard((event) => {
        if (
          event.isComposing ||
          event.keyCode === 229 ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey
        )
          return;
        if (event.target === formulaInput.current && event.key === 'Enter') {
          event.preventDefault();
          cellInput.current?.focus();
          return;
        }
        if (event.target !== cellInput.current) return;
        let [row, column] = selected;
        if (event.key === 'Tab') {
          const nextIndex = row * COLUMNS + column + (event.shiftKey ? -1 : 1);
          // At the ends, native Tab leaves the grid for the workbook controls.
          if (nextIndex < 0 || nextIndex >= ROWS * COLUMNS) return;
          row = Math.floor(nextIndex / COLUMNS);
          column = nextIndex % COLUMNS;
        } else if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          row += event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1;
          row = Math.max(0, Math.min(ROWS - 1, row));
        } else return;
        event.preventDefault();
        setSelected([row, column]);
      }),
    [selected]
  );

  return (
    <section
      className="worksheet-cover"
      aria-label="工作记录工作表"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header className="worksheet-cover-header">
        <span
          className="worksheet-cover-icon"
          style={{ backgroundImage: `url("${WORKBOOK_ICON}")` }}
          aria-hidden="true"
        />
        <strong>工作簿</strong>
        <span className="worksheet-save-status" role="status">
          {saveStatus}
        </span>
        <button type="button" onClick={() => restore(false)}>
          返回工作区
        </button>
      </header>
      <div className="worksheet-cover-tabs">
        <ExcelRibbonTabs />
      </div>
      <div className="worksheet-cover-ribbon">
        <ExcelRibbon />
      </div>
      <div className="worksheet-cover-formula">
        <output aria-label="当前单元格">{address}</output>
        <span aria-hidden="true">fx</span>
        <input
          ref={formulaInput}
          aria-label="单元格内容"
          value={value}
          maxLength={CELL_LIMIT}
          onChange={(event) => edit(event.target.value)}
          onPaste={paste}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="worksheet-cover-scroll">
        <table className="worksheet-cover-grid" role="grid" aria-label="工作表1">
          <colgroup>
            <col className="worksheet-cover-row-number" />
            {columnNames.map((name) => (
              <col key={name} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="worksheet-cover-corner" aria-label="行列标" />
              {columnNames.map((name, column) => (
                <th key={name} scope="col" data-selected={selected[1] === column || undefined}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, row) => (
              <tr key={row}>
                <th scope="row" data-selected={selected[0] === row || undefined}>
                  {row + 1}
                </th>
                {columnNames.map((name, column) => {
                  const currentAddress = `${name}${row + 1}`;
                  const active = row === selected[0] && column === selected[1];
                  return (
                    <td
                      key={name}
                      role="gridcell"
                      aria-label={currentAddress}
                      aria-selected={active}
                      onClick={() => {
                        if (active) cellInput.current?.focus();
                        else setSelected([row, column]);
                      }}
                    >
                      {active ? (
                        <input
                          ref={cellInput}
                          aria-label={`编辑 ${currentAddress}`}
                          value={value}
                          maxLength={CELL_LIMIT}
                          onChange={(event) => edit(event.target.value)}
                          onPaste={paste}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      ) : (
                        cells[currentAddress]
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="worksheet-cover-footer">
        <span aria-hidden="true">＋</span>
        <span className="worksheet-cover-sheet">工作表1</span>
        <span className="worksheet-cover-selection">{address}</span>
        <span aria-hidden="true">100%</span>
      </footer>
    </section>
  );
}
