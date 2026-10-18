import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { GameCommandType } from '@game/application/game-commands';
import { useGameStore, type CommandDispatchResult } from '@/store/gameStore';
import { createActivationInkPainter } from './abilityActivationInk';
import { createActivationFlowPainter } from './abilityActivationFlow';
import { createActivationRainbowPainter } from './abilityActivationRainbow';
import './abilityActivationMotion.css';

export type AbilityActivationStyle = 'rainbow' | 'flow' | 'flow-original' | 'ink';
// Presentation-only override for the local comparison page; never part of game state.
export const AbilityActivationStyleContext = createContext<AbilityActivationStyle>('rainbow');

const DURATION_MS = 1000;
const LIFT_END = 0.25;
const SETTLE_START = 0.8;
const PERSPECTIVE_PX = 650;
const LIFT_HEIGHT_PX = 105 * 1.1;
// The approved hover's displayed width/height grows by exactly 10%, including
// perspective magnification from the extra height (rather than stacking both gains).
const HOVER_SCALE = (1.1 * (PERSPECTIVE_PX - LIFT_HEIGHT_PX)) / (PERSPECTIVE_PX - 105);
const REST_TRANSFORM = `perspective(${PERSPECTIVE_PX}px) translateZ(0px) scale(1)`;
const HOVER_TRANSFORM = `perspective(${PERSPECTIVE_PX}px) translateZ(${LIFT_HEIGHT_PX}px) scale(${HOVER_SCALE})`;
type Activate = (
  cardId: string,
  abilityId: string,
  instanceId?: string,
  afterSubmit?: () => void
) => CommandDispatchResult;
const activateImmediately: Activate = (cardId, abilityId, instanceId, afterSubmit) => {
  const result = useGameStore.getState().activateCardAbility(cardId, abilityId, instanceId);
  afterSubmit?.();
  return result;
};
const ActivationContext = createContext<{
  activateCardAbility: Activate;
  activatingCardId: string | null;
}>({
  activateCardAbility: activateImmediately,
  activatingCardId: null,
});
export const useAbilityActivationMotion = () => useContext(ActivationContext);

interface Activation {
  readonly cardId: string;
  readonly edgeStyle: AbilityActivationStyle;
  readonly target: HTMLElement;
  readonly execute: () => void;
  readonly isCurrent: () => boolean;
}

/** Presentation precedes the existing command; no game state is predicted or changed here. */
export function AbilityActivationProvider({ children }: { children: ReactNode }) {
  const edgeStyle = useContext(AbilityActivationStyleContext);
  const [activation, setActivation] = useState<Activation | null>(null);
  const pending = useRef<Activation | null>(null);
  const activate = useCallback<Activate>(
    (cardId, abilityId, instanceId, afterSubmit) => {
      if (pending.current) return { success: false, pending: true };
      const state = useGameStore.getState();
      const view = state.playerViewState;
      const card = state.getCardViewObject(cardId);
      const target = Array.from(
        document.querySelectorAll<HTMLElement>('[data-ability-activation-source]')
      )
        .filter(
          (node) =>
            node.dataset.abilityActivationSource === cardId &&
            node.getBoundingClientRect().width > 0 &&
            node.checkVisibility() &&
            !node.closest('[data-battle-animation-ignore="true"]')
        )
        .at(-1);
      // Only the player's already-visible source may receive a pre-command emphasis.
      if (
        !view ||
        !target ||
        card?.surface !== 'FRONT' ||
        !card.frontInfo ||
        state.getBattleSurfaceCapabilities().isReadOnly ||
        !state.canUseAction(GameCommandType.ACTIVATE_ABILITY)
      ) {
        const result = state.activateCardAbility(cardId, abilityId, instanceId);
        afterSubmit?.();
        return result;
      }
      const epoch = state.publicBattleLog.presentationEpoch;
      const request: Activation = {
        cardId,
        edgeStyle,
        target,
        execute: () => {
          useGameStore.getState().activateCardAbility(cardId, abilityId, instanceId);
          afterSubmit?.();
        },
        isCurrent: () => {
          const current = useGameStore.getState();
          return (
            target.isConnected &&
            current.gameSession === state.gameSession &&
            current.remoteSession === state.remoteSession &&
            current.replaySession === state.replaySession &&
            current.viewingPlayerId === state.viewingPlayerId &&
            current.playerViewState?.match.matchId === view.match.matchId &&
            current.playerViewState.match.seq === view.match.seq &&
            current.publicBattleLog.presentationEpoch === epoch &&
            !current.getBattleSurfaceCapabilities().isReadOnly
          );
        },
      };
      pending.current = request;
      setActivation(request);
      state.setHoveredCard(null);
      return { success: false, pending: true };
    },
    [edgeStyle]
  );
  const finish = useCallback((request: Activation, execute: boolean) => {
    if (pending.current !== request) return;
    pending.current = null;
    setActivation(null);
    if (execute && request.isCurrent()) request.execute();
  }, []);
  return (
    <ActivationContext.Provider
      value={{ activateCardAbility: activate, activatingCardId: activation?.cardId ?? null }}
    >
      {children}
      {activation &&
        createPortal(<ActivationInk activation={activation} finish={finish} />, activation.target)}
    </ActivationContext.Provider>
  );
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};

function ActivationInk({
  activation,
  finish,
}: {
  activation: Activation;
  finish: (request: Activation, execute: boolean) => void;
}) {
  const inkRef = useRef<HTMLCanvasElement>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  const floorHost = activation.target.parentElement;
  useLayoutEffect(() => {
    const target = activation.target;
    const ink = inkRef.current!;
    if (!activation.isCurrent()) {
      finish(activation, false);
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 80 : DURATION_MS;
    const paintInk =
      activation.edgeStyle === 'rainbow'
        ? createActivationRainbowPainter(ink)
        : activation.edgeStyle === 'ink'
          ? createActivationInkPainter(ink)
          : createActivationFlowPainter(ink, activation.edgeStyle === 'flow-original' ? 1 : 1.5);
    if (reduced) paintInk(0.35);
    const floor = floorRef.current;
    const floorRotation = getComputedStyle(target).rotate;
    target.dataset.abilityActivation = 'true';
    if (floorHost) floorHost.dataset.abilityActivationFloorHost = 'true';
    const origin = getComputedStyle(target).transformOrigin.split(' ').map(Number.parseFloat);
    const originX = origin[0] / target.offsetWidth;
    const originY = origin[1] / target.offsetHeight;
    const lift = reduced
      ? null
      : target.animate(
          [
            {
              transform: REST_TRANSFORM,
              offset: 0,
              easing: 'cubic-bezier(.18,.75,.25,1)',
            },
            {
              transform: HOVER_TRANSFORM,
              offset: LIFT_END,
              easing: 'ease-in-out',
            },
            {
              transform: HOVER_TRANSFORM,
              offset: SETTLE_START,
              easing: 'cubic-bezier(.45,0,.65,1)',
            },
            {
              transform: REST_TRANSFORM,
              offset: 1,
            },
          ],
          { duration, composite: 'add' }
        );
    const shadow = reduced
      ? null
      : target.animate(
          [
            { boxShadow: getComputedStyle(target).boxShadow },
            { boxShadow: '0 2px 1px #11111190, 0 1px 0 #ffffff60', offset: LIFT_END },
            { boxShadow: '0 2px 1px #11111190, 0 1px 0 #ffffff60', offset: SETTLE_START },
            { boxShadow: getComputedStyle(target).boxShadow },
          ],
          { duration }
        );
    let frame = 0,
      timer = 0,
      stopped = false;
    const start = performance.now();
    const paint = (now: number) => {
      const t = clamp((now - start) / duration);
      ink.dataset.progress = t.toFixed(3);
      ink.style.opacity = String(
        reduced ? Math.sin(Math.PI * t) * 0.55 : smooth(t / 0.18) * (1 - smooth((t - 0.78) / 0.22))
      );
      if (!reduced) paintInk(t);
      if (floor) {
        const elevation =
          smooth(t / LIFT_END) * (1 - smooth((t - SETTLE_START) / (1 - SETTLE_START)));
        // The footprint follows the card's planar enlargement, not its perspective
        // magnification. Keep the shadow on the table, with 10% more separation.
        const floorScale = 1 + (HOVER_SCALE - 1) * elevation;
        const width = target.offsetWidth * floorScale;
        const height = target.offsetHeight * floorScale;
        floor.style.left = `${target.offsetLeft - (width - target.offsetWidth) * originX}px`;
        floor.style.top = `${target.offsetTop - (height - target.offsetHeight) * originY + target.offsetHeight * 0.176 * elevation}px`;
        floor.style.width = `${width}px`;
        floor.style.height = `${height}px`;
        floor.style.rotate = floorRotation;
        floor.style.opacity = reduced ? '0' : String(0.8 * elevation);
      }
      if (!stopped) frame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      lift?.cancel();
      shadow?.cancel();
      delete target.dataset.abilityActivation;
      if (floorHost) delete floorHost.dataset.abilityActivationFloorHost;
      ink.style.opacity = '0';
      if (floor) floor.style.opacity = '0';
    };
    const cancel = () => {
      cleanup();
      finish(activation, false);
    };
    const unsubscribe = useGameStore.subscribe(() => {
      if (!activation.isCurrent()) cancel();
    });
    const onVisibility = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', onVisibility);
    paint(start);
    timer = window.setTimeout(() => {
      cleanup();
      finish(activation, true);
    }, duration);
    return () => {
      cleanup();
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activation, finish, floorHost]);
  return (
    <>
      {floorHost &&
        createPortal(
          <div
            ref={floorRef}
            className="ability-activation-floor"
            data-ability-activation-floor="true"
            aria-hidden="true"
          />,
          floorHost
        )}
      <canvas
        ref={inkRef}
        className="ability-activation-ink"
        aria-hidden="true"
        data-ability-activation-ink="true"
        data-ability-activation-style={activation.edgeStyle}
      />
    </>
  );
}
