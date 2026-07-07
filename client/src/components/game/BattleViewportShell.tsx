import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  installBattleViewportDiagnostics,
  readBattleViewportSignature,
  subscribeToBattleViewportChanges,
} from '@/lib/battleViewport';
import { cn } from '@/lib/utils';

type BattleViewportStyle = CSSProperties & Record<`--battle-viewport-${string}`, string | number>;

const DEFAULT_BATTLE_VIEWPORT_STYLE: BattleViewportStyle = {
  '--battle-viewport-width': '100vw',
  '--battle-viewport-height': '100dvh',
  '--battle-viewport-height-46': '46dvh',
  '--battle-viewport-height-52': '52dvh',
  '--battle-viewport-height-82': '82dvh',
  '--battle-viewport-height-86': '86dvh',
  '--battle-viewport-height-88': '88dvh',
  '--battle-viewport-offset-left': '0px',
  '--battle-viewport-offset-top': '0px',
  '--battle-viewport-scale': 1,
};

const HEIGHT_FRACTION_VARIABLES = [
  ['--battle-viewport-height-46', 0.46],
  ['--battle-viewport-height-52', 0.52],
  ['--battle-viewport-height-82', 0.82],
  ['--battle-viewport-height-86', 0.86],
  ['--battle-viewport-height-88', 0.88],
] as const;

interface BattleViewportShellProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export const BattleViewportShell = memo(function BattleViewportShell({
  children,
  className,
}: BattleViewportShellProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const writeViewportVariables = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const signature = readBattleViewportSignature();
    if (!signature) {
      return;
    }

    root.style.setProperty('--battle-viewport-width', `${signature.width}px`);
    root.style.setProperty('--battle-viewport-height', `${signature.height}px`);
    for (const [propertyName, fraction] of HEIGHT_FRACTION_VARIABLES) {
      root.style.setProperty(propertyName, `${signature.height * fraction}px`);
    }
    root.style.setProperty('--battle-viewport-offset-left', `${signature.offsetLeft}px`);
    root.style.setProperty('--battle-viewport-offset-top', `${signature.offsetTop}px`);
    root.style.setProperty('--battle-viewport-scale', String(signature.scale));
  }, []);

  useLayoutEffect(() => {
    const scheduleWrite = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        writeViewportVariables();
      });
    };

    writeViewportVariables();
    const unsubscribe = subscribeToBattleViewportChanges(scheduleWrite);

    return () => {
      unsubscribe();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [writeViewportVariables]);

  useLayoutEffect(
    () => installBattleViewportDiagnostics(import.meta.env.DEV),
    []
  );

  return (
    <div
      ref={rootRef}
      className={cn('battle-viewport-shell relative overflow-hidden', className)}
      style={DEFAULT_BATTLE_VIEWPORT_STYLE}
    >
      {children}
    </div>
  );
});
