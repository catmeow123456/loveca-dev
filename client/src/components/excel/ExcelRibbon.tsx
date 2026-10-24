import type { ReactNode } from 'react';

/** Only an explicitly supplied View menu is interactive; cover chrome stays decorative. */
export function ExcelRibbonTabs({ viewMenu }: { viewMenu?: ReactNode }) {
  return (
    <div
      className="excel-ribbon-tabs"
      aria-hidden={viewMenu ? undefined : true}
      inert={!viewMenu}
      data-interactive={viewMenu ? true : undefined}
    >
      {['开始', '插入', '数据', '公式', '协作', '视图', '效率工具'].map((label, index) =>
        label === '视图' && viewMenu ? (
          <div key={label}>{viewMenu}</div>
        ) : (
          <span
            key={label}
            aria-hidden="true"
            inert
            className={index === 0 ? 'excel-ribbon-tab-active' : undefined}
          >
            {label}
          </span>
        )
      )}
    </div>
  );
}

export function ExcelRibbon() {
  return (
    <div className="excel-ribbon" aria-hidden="true" inert>
      <div className="excel-ribbon-group excel-ribbon-history">
        <span className="excel-ribbon-symbol">↶</span>
        <span className="excel-ribbon-symbol">↷</span>
        <span className="excel-ribbon-paint" />
      </div>
      <div className="excel-ribbon-group">
        <span className="excel-ribbon-field excel-ribbon-font">
          默认字体 <small>▾</small>
        </span>
        <span className="excel-ribbon-field">
          10 <small>▾</small>
        </span>
        <b className="excel-ribbon-symbol">B</b>
        <i className="excel-ribbon-symbol">I</i>
        <u className="excel-ribbon-symbol">U</u>
        <span className="excel-ribbon-ink">A</span>
      </div>
      <div className="excel-ribbon-group">
        <span className="excel-ribbon-symbol">▦</span>
        <small>▾</small>
        <span className="excel-ribbon-align" />
        <span className="excel-ribbon-align excel-ribbon-align-center" />
        <span>换行</span>
        <span className="excel-ribbon-muted">合并 ▾</span>
      </div>
      <div className="excel-ribbon-group">
        <span className="excel-ribbon-field excel-ribbon-format">
          常规 <small>▾</small>
        </span>
        <span>%</span>
        <span>.00</span>
      </div>
      <div className="excel-ribbon-group">
        <span>筛选 ▾</span>
        <span>排序 ▾</span>
        <span>冻结 ▾</span>
        <span>∑ 求和 ▾</span>
      </div>
      <div className="excel-ribbon-group">
        <span>条件格式 ▾</span>
        <span>数据 ▾</span>
        <span>保护</span>
      </div>
      <div className="excel-ribbon-group">
        <span>插入 ▾</span>
        <span>图表 ▾</span>
        <span>打印</span>
      </div>
    </div>
  );
}

/** A single axis shared by every merged region in the current worksheet. */
export function ExcelColumnHeadings({
  withState = false,
  selectedColumns,
}: {
  withState?: boolean;
  selectedColumns?: readonly [number, number];
}) {
  return (
    <div className="excel-sheet-columns" aria-hidden="true" inert>
      <span className="excel-axis-corner" />
      {Array.from({ length: withState ? 13 : 12 }, (_, index) => (
        <span
          key={index}
          data-active={
            selectedColumns && index >= selectedColumns[0] && index <= selectedColumns[1]
              ? true
              : undefined
          }
        >
          {String.fromCharCode(65 + index)}
        </span>
      ))}
    </div>
  );
}

/** Empty worksheet cells are decorative and never expose game data or receive focus. */
export function ExcelBlankRows({
  startRow,
  withState = false,
}: {
  startRow: number;
  withState?: boolean;
}) {
  return (
    <div className="excel-blank-grid" aria-hidden="true" inert>
      <div className="excel-blank-columns">
        <div className="excel-blank-numbers">
          {Array.from({ length: 80 }, (_, index) => (
            <span key={index}>{startRow + index}</span>
          ))}
        </div>
        {Array.from({ length: withState ? 13 : 12 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );
}
