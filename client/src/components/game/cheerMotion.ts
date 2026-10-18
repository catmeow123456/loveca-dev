import { judgeLiveWithHeartCounts } from '@/lib/liveJudgmentPreview';
import type { HeartRequirement } from '@game/domain/entities/card';
import { useGameStore } from '@/store/gameStore';
import { HEART_ICON_SOURCE_BY_COLOR } from '@/lib/modifierIconAssets';
import { HeartColor } from '@game/shared/types/enums';
import './cheerMotion.css';

export interface CheerMotionCard {
  id: string;
  objectId: string;
  hearts: { color: HeartColor; count: number }[];
}

const colors: Partial<Record<HeartColor, string>> = {
  PINK: '#ff9bca',
  RED: '#ff9292',
  BLUE: '#8ecaff',
  PURPLE: '#c4a4ff',
  GREEN: '#7bdda3',
  YELLOW: '#ffe897',
  RAINBOW: '#e5e0ff',
};
const images = new Map<string, HTMLImageElement>();
async function load(src: string) {
  if (images.has(src)) return;
  const image = new Image();
  image.src = src;
  images.set(src, image);
  await image.decode().catch(() => {
    images.delete(src);
  });
}
export async function warmCheerAssets() {
  await Promise.all([load('/back.jpg'), ...Object.values(HEART_ICON_SOURCE_BY_COLOR).map(load)]);
}
export function readCheerJudgmentLabels(panel: HTMLElement | null) {
  return ['[data-cheer-outcome]', '[data-cheer-requirement-summary]'].map((selector) => ({
    selector,
    width: panel?.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? 0,
    content: panel?.querySelector<HTMLElement>(selector)?.cloneNode(true) as
      HTMLElement | undefined,
  }));
}
type Token = {
  color: HeartColor;
  amount: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  delay: number;
  arrived: boolean;
  sourceX: number;
  emitted: boolean;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => n * n * (3 - 2 * n);
function position(token: Token, p: number) {
  const t = smooth(p),
    u = 1 - t;
  // Bend toward the destination so hearts at the strip's right edge stay inside the panel.
  const bend =
    Math.min(66, Math.max(28, Math.abs(token.ex - token.sx) * 0.35)) *
    (token.ex < token.sx ? -1 : 1);
  return {
    x:
      u * u * u * token.sx +
      3 * u * u * t * (token.sx + bend) +
      3 * u * t * t * (token.ex + bend) +
      t * t * t * token.ex,
    y:
      u * u * u * token.sy +
      3 * u * u * t * (token.sy + 30) +
      3 * u * t * t * (token.ey - 35) +
      t * t * t * token.ey,
  };
}

/** Presentation of already-resolved public cheer cards. Never delays or changes rule state. */
export function playCheerMotion(options: {
  panel: HTMLElement;
  cards: CheerMotionCard[];
  members: Map<HeartColor, number>;
  before: Map<HeartColor, number>;
  labels: ReturnType<typeof readCheerJudgmentLabels>;
  speed: number;
  requirements: HeartRequirement | null;
  playerName: string;
  firstBatch: boolean;
  phase?: (label: string) => void;
  done: () => void;
}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.createElement('div');
  root.className = 'cheer-motion-overlay';
  root.setAttribute('aria-hidden', 'true');
  const panel = options.panel;
  // All copies live inside the panel, so they move with its entrance animation.
  // Build them synchronously before paint; no final face/count is exposed first.
  panel.append(root);
  const panelBounds = panel.getBoundingClientRect();
  const width = panel.clientWidth;
  const height = panel.clientHeight;
  const localRect = (node: Element) => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.x - panelBounds.x - panel.clientLeft,
      y: rect.y - panelBounds.y - panel.clientTop,
      width: rect.width,
      height: rect.height,
      right: rect.right - panelBounds.x - panel.clientLeft,
      bottom: rect.bottom - panelBounds.y - panel.clientTop,
    };
  };
  const canvas = document.createElement('canvas');
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  root.append(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const restores: (() => void)[] = [];
  const animations: Animation[] = [];
  const counts = new Map(options.before);
  const masks = new Map<HeartColor, HTMLElement>();
  const tokens: Token[] = [];
  let raf = 0,
    stopped = false,
    resultsReleased = false,
    lastPhase = '';
  const copyOver = (node: HTMLElement) => {
    const rect = localRect(node);
    const computed = getComputedStyle(node);
    const copy = node.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-cheer-heart-color');
    copy.removeAttribute('data-cheer-total');
    copy.removeAttribute('data-cheer-outcome');
    Object.assign(copy.style, {
      position: 'absolute',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      visibility: 'visible',
      font: computed.font,
      color: computed.color,
      textAlign: computed.textAlign,
      letterSpacing: computed.letterSpacing,
      whiteSpace: computed.whiteSpace,
    });
    root.append(copy);
    const old = node.style.visibility;
    node.style.visibility = 'hidden';
    restores.push(() => {
      node.style.visibility = old;
    });
    return copy;
  };
  const scrollArea = panel.querySelector<HTMLElement>('.touch-scroll');
  const viewport = scrollArea && localRect(scrollArea);
  if (viewport)
    root.style.clipPath = `inset(${Math.max(0, viewport.y)}px ${Math.max(0, width - viewport.right)}px ${Math.max(0, height - viewport.bottom)}px ${Math.max(0, viewport.x)}px)`;
  const resultMasks: { node: HTMLElement; copy: HTMLElement; visibility: string }[] = [];
  if (!reduced)
    for (const { selector, content, width } of options.labels.some((label) => label.content)
      ? options.labels
      : readCheerJudgmentLabels(panel).map((label) => {
          if (label.content) label.content.textContent = '声援中';
          return label;
        })) {
      const node = panel?.querySelector<HTMLElement>(selector);
      if (!node || !content) continue;
      const visibility = node.style.visibility;
      const copy = copyOver(node);
      if (selector === '[data-cheer-requirement-summary]') {
        const rect = localRect(node);
        copy.style.width = `${Math.max(rect.width, width)}px`;
        copy.style.left = `${rect.right - Math.max(rect.width, width)}px`;
        copy.style.whiteSpace = 'nowrap';
      }
      copy.replaceChildren(...Array.from(content.childNodes));
      copy.removeAttribute('data-cheer-requirement-summary');
      resultMasks.push({ node, copy, visibility });
    }
  const totalNode = panel?.querySelector<HTMLElement>('[data-cheer-total]');
  const totalCopy = totalNode && !reduced ? copyOver(totalNode) : null;
  const updateTotal = () => {
    if (totalCopy)
      totalCopy.textContent = `成员心 + 判心 · 总计 ${Array.from(counts.values()).reduce((a, b) => a + b, 0)}`;
  };
  updateTotal();
  for (const node of panel?.querySelectorAll<HTMLElement>('[data-cheer-heart-color]') ?? []) {
    const color = node.dataset.cheerHeartColor as HeartColor;
    if (reduced) continue;
    const copy = copyOver(node);
    copy.dataset.cheerMotionCount = color;
    copy.style.whiteSpace = 'nowrap';
    copy.querySelector('[data-cheer-heart-count]')!.textContent = String(counts.get(color) ?? 0);
    const detail = copy.querySelector('.text-\\[10px\\]');
    if (detail)
      detail.textContent = `成员 ${options.members.get(color) ?? 0} / 判心 ${(counts.get(color) ?? 0) - (options.members.get(color) ?? 0)}`;
    masks.set(color, copy);
  }
  const cardCopies: {
    node: HTMLElement;
    copy: HTMLElement;
    inner: HTMLElement;
    delay: number;
    visible: string;
    summary: HTMLElement | null;
    summaryVisibility: string;
    contentX: number;
  }[] = [];
  // Stagger a short batch, rather than adding a full animation per card.
  const stagger = Math.min(38, 560 / Math.max(1, options.cards.length - 1));
  const flipDuration = 200;
  const emergeAt = 100;
  const flightDuration = 320;
  const arrivalAt = emergeAt + flightDuration;
  const endAt = stagger * Math.max(0, options.cards.length - 1) + arrivalAt + 80;
  root.dataset.cheerMotionState = 'preparing';
  const stripNode = panel.querySelector<HTMLElement>('[data-cheer-strip]');
  const strip = stripNode && localRect(stripNode);
  const initialScroll = stripNode?.scrollLeft ?? 0;
  let expectedScroll = initialScroll;
  const scrollStops: { at: number; left: number }[] = [{ at: 0, left: initialScroll }];
  const cardLayer = document.createElement('div');
  cardLayer.className = 'cheer-motion-cards';
  if (strip)
    cardLayer.style.clipPath = `inset(${strip.y}px ${width - strip.right}px ${height - strip.bottom}px ${strip.x}px)`;
  root.append(cardLayer);
  const progress = document.createElement('span');
  progress.className = 'cheer-motion-progress';
  if (strip && options.cards.length > 4 && !reduced) {
    progress.style.right = `${width - strip.right + 8}px`;
    progress.style.top = `${strip.bottom - 14}px`;
    progress.textContent = `翻牌 0/${options.cards.length}`;
    root.append(progress);
  }

  options.cards.forEach(({ id, hearts }, i) => {
    const node = panel?.querySelector<HTMLElement>(`[data-cheer-card-id="${CSS.escape(id)}"]`);
    if (!node) return;
    const rect = localRect(node);
    const image = node.querySelector('img');
    if (!image || rect.width === 0) return;

    const delay = i * stagger;
    if (strip && stripNode) {
      const left = Math.min(
        stripNode.scrollWidth - stripNode.clientWidth,
        Math.max(initialScroll, rect.right + initialScroll - strip.right + 10)
      );
      scrollStops.push({ at: delay + emergeAt - 20, left });
    }
    const summary =
      node.parentElement?.querySelector<HTMLElement>('[data-cheer-card-summary]') ?? null;
    const summaryVisibility = summary?.style.visibility ?? '';
    if (summary && !reduced) {
      summary.style.visibility = 'hidden';
      restores.push(() => {
        summary.style.visibility = summaryVisibility;
      });
    }
    // Copies share the real strip scroll position, including cards not yet in view.
    if (!reduced) {
      const copy = document.createElement('div');
      copy.className = 'cheer-motion-flip';
      Object.assign(copy.style, {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      const inner = document.createElement('div');
      inner.className = 'cheer-motion-flip-inner';
      inner.style.transform = 'rotateY(-180deg)';
      for (const [src, side] of [
        [image.src, 'front'],
        ['/back.jpg', 'back'],
      ]) {
        const face = document.createElement('img');
        // A cold card image can arrive during the flip. Keep a back instead of a blank face.
        const waitingForFront = side === 'front' && !(image.complete && image.naturalWidth > 0);
        face.src = waitingForFront ? '/back.jpg' : src;
        if (waitingForFront) {
          const showFront = () => {
            face.src = src;
          };
          image.addEventListener('load', showFront, { once: true });
          restores.push(() => image.removeEventListener('load', showFront));
        }
        face.className = `cheer-motion-face cheer-motion-${side}`;
        inner.append(face);
      }
      copy.append(inner);
      cardLayer.append(copy);
      const visible = node.style.visibility;
      node.style.visibility = 'hidden';
      restores.push(() => {
        node.style.visibility = visible;
      });
      cardCopies.push({
        node,
        copy,
        inner,
        delay,
        visible,
        summary,
        summaryVisibility,
        contentX: rect.x + initialScroll,
      });
    }
    hearts.forEach((heart, j) => {
      const color = heart.color;
      const target = panel?.querySelector<HTMLElement>(`[data-cheer-heart-color="${color}"] img`);
      if (!target) return;
      const to = localRect(target);
      const token: Token = {
        color,
        amount: heart.count,
        sx: rect.x + rect.width * 0.092,
        sourceX: rect.x + initialScroll + rect.width * 0.092,
        emitted: false,
        sy: rect.y + rect.height * 0.085 + j * 9,
        ex: to.x + to.width / 2,
        ey: to.y + to.height / 2,
        delay,
        arrived: false,
      };
      tokens.push(token);
    });
  });
  // One threshold for the entire LIVE group, using the same allocation rules as the verdict.
  const isSuccessful = () =>
    options.requirements !== null && judgeLiveWithHeartCounts(counts, options.requirements).success;
  const initiallySuccessful = isSuccessful();
  let successAt: number | null = null;
  let successNotice: HTMLElement | null = null;
  let successLabelOffset = 0;
  const successDuration = 1150;
  const announcer = document.createElement('span');
  announcer.className = 'sr-only';
  announcer.setAttribute('role', 'status');
  panel.append(announcer);
  restores.push(() => announcer.remove());
  const showSuccess = (now: number) => {
    successAt = now;
    const group = panel.querySelector('[data-cheer-live-group]')?.closest('section');
    if (!group) return;
    const rect = localRect(group);
    const top =
      viewport && rect.y > viewport.bottom - 100
        ? Math.max(viewport.y + 8, viewport.bottom - rect.height - 8)
        : rect.y;
    successLabelOffset = viewport ? Math.min(0, viewport.bottom - top - rect.height - 8) / 2 : 0;
    successNotice = document.createElement('div');
    successNotice.className = 'cheer-motion-success';
    successNotice.dataset.cheerLiveSuccess = '';
    Object.assign(successNotice.style, {
      left: `${rect.x}px`,
      top: `${top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    successNotice.innerHTML =
      '<div class="cheer-success-halo"></div><div class="cheer-success-sweep"></div><div class="cheer-success-label"><span class="cheer-success-title">LIVE成功</span></div>';
    root.append(successNotice);
    announcer.textContent = `${options.playerName}，整组 LIVE 需求已满足，等待确认。`;
    const requirementMask = resultMasks.find((mask) =>
      mask.node.matches('[data-cheer-requirement-summary]')
    );
    if (requirementMask) requirementMask.copy.textContent = '需求满足';
  };
  const preparedAt = performance.now();
  let start: number | null = null;
  const matchAtStart = useGameStore.getState().playerViewState?.match;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    animations.forEach((a) => a.cancel());
    restores.forEach((r) => r());
    root.remove();
    window.removeEventListener('resize', finish);
    window.removeEventListener('scroll', onScroll, true);
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      stripNode?.removeEventListener(type, finish);
    options.done();
  };
  const onScroll = (event: Event) => {
    // Native scroll events from our own follow movement must not cancel the choreography.
    if (
      stripNode &&
      event.target === stripNode &&
      Math.abs(stripNode.scrollLeft - expectedScroll) < 1
    )
      return;
    finish();
  };
  window.addEventListener('resize', finish);
  window.addEventListener('scroll', onScroll, true);
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
    stripNode?.addEventListener(type, finish, { passive: true });
  const tick = (now: number) => {
    const current = useGameStore.getState().playerViewState?.match;
    if (
      !panel?.isConnected ||
      current?.matchId !== matchAtStart?.matchId ||
      current?.seq !== matchAtStart?.seq
    ) {
      finish();
      return;
    }
    if (start === null) {
      const transform = getComputedStyle(panel).transform;
      const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
      if (!reduced && matrix && (Math.abs(matrix.m41) > 0.5 || Math.abs(matrix.m42) > 0.5)) {
        if (now - preparedAt > 1600) {
          finish();
          return;
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      start = now;
      root.dataset.cheerMotionState = 'playing';
    }
    const time = (now - start) * options.speed;
    root.dataset.cheerMotionTime = String(Math.round(time));
    const phase = reduced ? '心数已更新' : time < endAt - 80 ? '翻牌 · 光棒心同步汇入' : '汇入完成';
    if (phase !== lastPhase) {
      lastPhase = phase;
      options.phase?.(phase);
    }
    ctx.clearRect(0, 0, width, height);
    if (stripNode) {
      const next = scrollStops.findIndex((stop) => stop.at > time);
      const a = scrollStops[Math.max(0, next - 1)];
      const b = scrollStops[next];
      expectedScroll =
        reduced || next === -1
          ? scrollStops.at(-1)!.left
          : a.left + (b.left - a.left) * clamp((time - a.at) / Math.max(1, b.at - a.at));
      stripNode.scrollLeft = expectedScroll;
      expectedScroll = stripNode.scrollLeft;
    }
    let flipped = 0;
    for (const card of cardCopies) {
      card.copy.style.left = `${card.contentX - expectedScroll}px`;
      const local = time - card.delay;
      const turn = smooth(clamp(local / flipDuration));
      card.inner.style.transform = `rotateY(${-180 * (1 - turn)}deg) translateY(${-2 * Math.sin(turn * Math.PI)}px)`;
      if (local >= emergeAt) {
        flipped++;
        if (card.summary) card.summary.style.visibility = card.summaryVisibility;
      }
      if (local >= flipDuration) {
        card.node.style.visibility = card.visible;
        card.copy.style.display = 'none';
      }
    }
    progress.textContent = `翻牌 ${flipped}/${options.cards.length}`;
    for (const token of tokens) {
      const local = time - token.delay;
      if (!token.emitted && (reduced || local >= emergeAt)) {
        token.sx = token.sourceX - expectedScroll;
        token.emitted = true;
      }
      const p = clamp((local - emergeAt) / flightDuration);
      if (!reduced && local >= emergeAt && local < arrivalAt) {
        const emerge = clamp((local - emergeAt) / 60);
        const point = position(token, p);
        point.y -= (1 - p) * 10 * smooth(emerge);
        // A short, tapered wake follows the glyph; never draw the whole route.
        if (p > 0.03)
          for (let k = 12; k >= 1; k--) {
            const q = p - k * 0.013;
            if (q < 0) continue;
            const a = position(token, q),
              b = position(token, Math.max(0, q - 0.016));
            ctx.beginPath();
            ctx.moveTo(b.x, b.y - (1 - q) * 10);
            ctx.lineTo(a.x, a.y - (1 - q) * 10);
            ctx.strokeStyle = colors[token.color] ?? '#ffffff';
            ctx.globalAlpha = (1 - k / 13) * 0.24;
            ctx.lineWidth = (1 - k / 13) * 3;
            ctx.lineCap = 'round';
            ctx.stroke();
          }
        const sprite = images.get(HEART_ICON_SOURCE_BY_COLOR[token.color]);
        const size = (10 + 16 * smooth(emerge)) * (1 - 0.48 * p);
        ctx.globalAlpha = Math.min(1, emerge * 4) * (p > 0.92 ? (1 - p) / 0.08 : 1);
        ctx.shadowColor = colors[token.color] ?? '#fff';
        ctx.shadowBlur = 7 * (1 - p);
        if (sprite?.complete && sprite.naturalWidth)
          ctx.drawImage(sprite, point.x - size / 2, point.y - size / 2, size, size);
        else {
          // First-use fallback while the tiny icon is decoding; keep the same heart shape.
          ctx.save();
          ctx.translate(point.x - size / 2, point.y - size / 2);
          ctx.scale(size / 24, size / 24);
          ctx.fillStyle = colors[token.color] ?? '#fff';
          ctx.fill(
            new Path2D('M12 21 C9 18 2 13 2 7 C2 1 10 1 12 6 C14 1 22 1 22 7 C22 13 15 18 12 21 Z')
          );
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
      if ((reduced || local >= arrivalAt) && !token.arrived) {
        token.arrived = true;
        const value = (counts.get(token.color) ?? 0) + token.amount;
        counts.set(token.color, value);
        const copy = masks.get(token.color);
        if (copy) {
          copy.querySelector('[data-cheer-heart-count]')!.textContent = String(value);
          const detail = copy.querySelector('.text-\\[10px\\]');
          if (detail)
            detail.textContent = `成员 ${options.members.get(token.color) ?? 0} / 判心 ${value - (options.members.get(token.color) ?? 0)}`;
          animations.push(
            copy.animate(
              [
                { transform: 'scale(1)' },
                { transform: 'scale(1.09)', offset: 0.28 },
                { transform: 'scale(1)' },
              ],
              { duration: 120 / options.speed, easing: 'ease-out' }
            )
          );
        }
        updateTotal();
      }
    }
    if (
      successAt === null &&
      isSuccessful() &&
      (!initiallySuccessful || (options.firstBatch && (reduced || time >= emergeAt)))
    )
      showSuccess(now);
    if (successNotice && successAt !== null) {
      const elapsed = now - successAt;
      const entrance = reduced ? 1 : smooth(clamp(elapsed / 170));
      const exit = 1 - smooth(clamp((elapsed - 850) / 300));
      successNotice.style.opacity = String(entrance * exit);
      successNotice.style.setProperty('--success-progress', String(clamp(elapsed / 650)));
      const label = successNotice.querySelector<HTMLElement>('.cheer-success-label')!;
      label.style.transform = reduced
        ? `translateY(${successLabelOffset}px)`
        : `translateY(${successLabelOffset + (1 - entrance) * 7}px) scale(${0.94 + 0.06 * entrance})`;
      if (reduced) successNotice.classList.add('cheer-success-reduced');
    }
    // Cards with DRAW / SCORE / no heart must also finish flipping before the verdict appears.
    if (
      !resultsReleased &&
      tokens.every((t) => t.arrived) &&
      cardCopies.every((card) => time >= card.delay + flipDuration)
    ) {
      resultsReleased = true;
      for (const mask of resultMasks) {
        mask.copy.remove();
        mask.node.style.visibility = mask.visibility;
      }
    }
    if (
      time >= (reduced ? 100 : endAt) &&
      (successAt === null || now - successAt >= successDuration)
    )
      finish();
    else raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return finish;
}
