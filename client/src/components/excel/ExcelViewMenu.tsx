import { useEffect, useRef } from 'react';
import { useAppPresentation } from '@/lib/appPresentation';

export function ExcelViewMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const setMode = useAppPresentation((state) => state.setMode);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target))
        menu.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menu.current?.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      menu.current.open = false;
      menu.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, []);

  return (
    <details
      ref={menu}
      className="excel-view-menu"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          event.currentTarget.open = false;
      }}
    >
      <summary>视图</summary>
      <div className="excel-view-dropdown" role="group" aria-label="界面模式">
        <div className="excel-view-heading">界面模式</div>
        <button
          type="button"
          aria-pressed="true"
          onClick={() => {
            if (menu.current) menu.current.open = false;
            menu.current?.querySelector('summary')?.focus();
          }}
        >
          <span aria-hidden="true">✓</span>
          Excel 界面
        </button>
        <button type="button" aria-pressed="false" onClick={() => setMode('normal')}>
          <span aria-hidden="true" />
          普通界面
          <kbd>Ctrl+Alt+E</kbd>
        </button>
      </div>
    </details>
  );
}
