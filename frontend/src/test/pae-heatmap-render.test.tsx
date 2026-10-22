import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaeHeatmap } from '../components/PaeHeatmap';
import { SYNC_PAE_INTERACTION_PERFORMANCE } from '../lib/performance';

const SIZE = 20;
const CANVAS_SIZE = 200;

interface Blit {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dw: number;
  dh: number;
  smoothing: boolean;
}

interface Recorder {
  blits: Blit[];
  fills: number;
  transforms: Array<{ dx: number; dy: number }>;
}

const originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')!;

/**
 * Unlike the minimal stub in setup.ts, this context offers the bitmap API, so the
 * component takes its drawImage path instead of falling back to per-cell fills.
 */
function stubCanvas(recorder: Recorder) {
  const context = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    save: () => undefined,
    restore: () => undefined,
    setTransform: (_a: number, _b: number, _c: number, _d: number, dx: number, dy: number) => {
      recorder.transforms.push({ dx, dy });
    },
    clearRect: () => undefined,
    fillRect: () => {
      recorder.fills += 1;
    },
    strokeRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    fillText: () => undefined,
    setLineDash: () => undefined,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => undefined,
    drawImage: (
      _source: unknown,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      _dx: number,
      _dy: number,
      dw: number,
      dh: number,
    ) => {
      recorder.blits.push({ sx, sy, sw, sh, dw, dh, smoothing: context.imageSmoothingEnabled });
    },
  };

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => context, configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { value: CANVAS_SIZE, configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { value: CANVAS_SIZE, configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: CANVAS_SIZE, height: CANVAS_SIZE }),
  });
}

function renderHeatmap(size = SIZE, overrides: Record<string, unknown> = {}) {
  const matrix = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x + y) % 30));
  return render(
    <PaeHeatmap
      matrix={matrix}
      maxValue={30}
      syntheticPae={false}
      hoveredCell={null}
      pinnedResidues={[]}
      pinnedCell={null}
      selectedResidues={[]}
      brushSelection={null}
      interactionPerformance={SYNC_PAE_INTERACTION_PERFORMANCE}
      hoverSyncEnabled={false}
      pairSelectionEnabled={false}
      onHoverCell={() => undefined}
      onClickCell={() => undefined}
      onBrushSelectionChange={() => undefined}
      onToggleHoverSync={() => undefined}
      onTogglePairSelection={() => undefined}
      onClearPairSelection={() => undefined}
      onImportPaeData={() => undefined}
      {...overrides}
    />,
  );
}

describe('pAE matrix rendering', () => {
  let recorder: Recorder;

  beforeEach(() => {
    recorder = { blits: [], fills: 0, transforms: [] };
    stubCanvas(recorder);
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext);
  });

  it('blits the whole matrix in one call instead of filling cells', () => {
    renderHeatmap();

    expect(recorder.blits).toHaveLength(1);
    expect(recorder.blits[0]).toMatchObject({
      sx: 0,
      sy: 0,
      sw: SIZE,
      sh: SIZE,
      dw: CANVAS_SIZE,
      dh: CANVAS_SIZE,
    });
    expect(recorder.fills).toBe(0);
  });

  it('turns smoothing off while cells are magnified', () => {
    // 20 cells across 200px is 10px per cell, so the image is being enlarged.
    renderHeatmap();

    expect(recorder.blits[0].smoothing).toBe(false);
  });

  it('turns smoothing on when there are more cells than pixels', () => {
    renderHeatmap(400);

    expect(recorder.blits[0].smoothing).toBe(true);
  });

  it('counts device pixels, not CSS pixels, when deciding to smooth', () => {
    const original = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    try {
      // 300 cells over 200 CSS px is 400 device px: still magnifying, so no blur yet.
      renderHeatmap(300);
      expect(recorder.blits[0].smoothing).toBe(false);

      cleanup();
      recorder.blits.length = 0;
      renderHeatmap(600);
      expect(recorder.blits[0].smoothing).toBe(true);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true });
    }
  });

  const wrap = () => document.querySelector('.heatmap-canvas-wrap') as HTMLElement;
  const canvas = () => document.querySelector('.heatmap-canvas') as HTMLCanvasElement;
  const lastBlit = () => recorder.blits[recorder.blits.length - 1];

  it('zooms in toward the cursor on a wheel event', async () => {
    renderHeatmap();
    expect(lastBlit()).toMatchObject({ sx: 0, sy: 0, sw: SIZE, sh: SIZE });

    fireEvent.wheel(wrap(), { shiftKey: true, deltaY: -200, clientX: CANVAS_SIZE / 2, clientY: CANVAS_SIZE / 2 });

    await waitFor(() => expect(lastBlit().sw).toBeLessThan(SIZE));
    const blit = lastBlit();
    // Anchored at the centre, so the view closes in symmetrically.
    expect(blit.sx + blit.sw / 2).toBeCloseTo(SIZE / 2, 6);
    expect(blit.sy + blit.sh / 2).toBeCloseTo(SIZE / 2, 6);
    expect(blit.sw).toBe(blit.sh);
  });

  it('keeps consuming a zoom gesture at the zoom limits', async () => {
    renderHeatmap();

    const zoomIn = new WheelEvent('wheel', { shiftKey: true, deltaY: -200, clientX: 100, clientY: 100, cancelable: true, bubbles: true });
    wrap().dispatchEvent(zoomIn);
    expect(zoomIn.defaultPrevented).toBe(true);
    await waitFor(() => expect(lastBlit().sw).toBeLessThan(SIZE));

    // Back out to the whole matrix, then keep going: the gesture was aimed at the matrix,
    // so it must not leak into the drawer once there is nothing left to zoom out of.
    const zoomOut = new WheelEvent('wheel', { shiftKey: true, deltaY: 5000, clientX: 100, clientY: 100, cancelable: true, bubbles: true });
    wrap().dispatchEvent(zoomOut);
    await waitFor(() => expect(lastBlit().sw).toBe(SIZE));

    const beyondLimit = new WheelEvent('wheel', { shiftKey: true, deltaY: 200, clientX: 100, clientY: 100, cancelable: true, bubbles: true });
    wrap().dispatchEvent(beyondLimit);
    expect(beyondLimit.defaultPrevented).toBe(true);
  });

  it('maps the pointer through the zoomed view', async () => {
    const onHoverCell = vi.fn();
    renderHeatmap(SIZE, { onHoverCell });

    fireEvent.wheel(wrap(), { shiftKey: true, deltaY: -400, clientX: CANVAS_SIZE / 2, clientY: CANVAS_SIZE / 2 });
    await waitFor(() => expect(lastBlit().sw).toBeLessThan(SIZE));

    const { sx, sy, sw } = lastBlit();
    onHoverCell.mockClear();
    fireEvent.mouseMove(canvas(), { clientX: CANVAS_SIZE / 4, clientY: CANVAS_SIZE / 4 });

    expect(onHoverCell).toHaveBeenLastCalledWith({
      x: Math.floor(sx + 0.25 * sw),
      y: Math.floor(sy + 0.25 * sw),
    });
  });

  it('pans with shift+drag and stops at the matrix edge', async () => {
    renderHeatmap();
    fireEvent.wheel(wrap(), { shiftKey: true, deltaY: -400, clientX: CANVAS_SIZE / 2, clientY: CANVAS_SIZE / 2 });
    await waitFor(() => expect(lastBlit().sw).toBeLessThan(SIZE));
    const before = lastBlit();

    fireEvent.mouseDown(canvas(), { clientX: 150, clientY: 150, shiftKey: true });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 150 });
    await waitFor(() => expect(lastBlit().sx).toBeGreaterThan(before.sx));
    fireEvent.mouseUp(window);

    // Dragging far left must stop at 0 rather than running off the matrix.
    fireEvent.mouseDown(canvas(), { clientX: 150, clientY: 150, shiftKey: true });
    fireEvent.mouseMove(window, { clientX: 100000, clientY: 150 });
    await waitFor(() => expect(lastBlit().sx).toBe(0));
    fireEvent.mouseUp(window);
  });

  it('does not brush when shift is held', () => {
    const onBrushSelectionChange = vi.fn();
    renderHeatmap(SIZE, { onBrushSelectionChange });

    fireEvent.mouseDown(canvas(), { clientX: 10, clientY: 10, shiftKey: true });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(window, { clientX: 80, clientY: 80 });

    expect(onBrushSelectionChange).not.toHaveBeenCalled();
  });

  it('redraws the overlay against the new view, not just the matrix', async () => {
    renderHeatmap();
    // Both canvases start at the origin, so the overlay carries no translation.
    expect(recorder.transforms.every((t) => t.dx === 0 && t.dy === 0)).toBe(true);

    fireEvent.wheel(wrap(), { shiftKey: true, deltaY: -400, clientX: 0, clientY: 0 });
    await waitFor(() => expect(lastBlit().sw).toBeLessThan(SIZE));

    // Anchored at the top-left corner the origin stays at 0, so nudge the view off it.
    fireEvent.mouseDown(canvas(), { clientX: 150, clientY: 150, shiftKey: true });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(lastBlit().sx).toBeGreaterThan(0));
    fireEvent.mouseUp(window);

    const last = recorder.transforms[recorder.transforms.length - 1];
    expect(last.dx).toBeLessThan(0);
    expect(last.dy).toBeLessThan(0);
  });

  it('leaves a bare wheel to the drawer instead of zooming', async () => {
    renderHeatmap();

    const bare = new WheelEvent('wheel', { deltaY: -400, clientX: 100, clientY: 100, cancelable: true, bubbles: true });
    wrap().dispatchEvent(bare);

    await waitFor(() => expect(lastBlit().sw).toBe(SIZE));
    expect(bare.defaultPrevented).toBe(false);
  });

  it('zooms on a trackpad pinch, which arrives as ctrl+wheel', async () => {
    renderHeatmap();

    fireEvent.wheel(wrap(), { ctrlKey: true, deltaY: -400, clientX: 100, clientY: 100 });

    await waitFor(() => expect(lastBlit().sw).toBeLessThan(SIZE));
  });

  it('zooms on a shifted two-finger scroll, which arrives horizontally', async () => {
    renderHeatmap();

    // macOS turns shift + two-finger scroll into deltaX, leaving deltaY at zero.
    fireEvent.wheel(wrap(), { shiftKey: true, deltaX: -400, deltaY: 0, clientX: 100, clientY: 100 });

    await waitFor(() => expect(lastBlit().sw).toBeLessThan(SIZE));
  });

  it('offers the gesture hint as a resting tooltip, until the view is zoomed', async () => {
    renderHeatmap();

    expect(canvas().getAttribute('title')).toMatch(/scroll to zoom/);
    expect(canvas().getAttribute('title')).toMatch(/drag to pan/);

    fireEvent.wheel(wrap(), { shiftKey: true, deltaY: -400, clientX: 100, clientY: 100 });
    await waitFor(() => expect(lastBlit().sw).toBeLessThan(SIZE));

    // Once zoomed the badge carries the span and the reset control, so the hint stands down.
    expect(canvas().getAttribute('title')).toBeNull();
    const badge = document.querySelector('.heatmap-zoom-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toMatch(/^\d+×\d+ residues/);
  });

  it('returns to the whole matrix from the reset button', async () => {
    renderHeatmap();
    expect(document.querySelector('.heatmap-zoom-badge')).toBeNull();

    fireEvent.wheel(wrap(), { shiftKey: true, deltaY: -400, clientX: 100, clientY: 100 });
    await waitFor(() => expect(lastBlit().sw).toBeLessThan(SIZE));

    const badge = document.querySelector('.heatmap-zoom-badge') as HTMLElement;
    expect(badge).not.toBeNull();
    fireEvent.click(badge.querySelector('button')!);

    await waitFor(() => expect(lastBlit()).toMatchObject({ sx: 0, sy: 0, sw: SIZE, sh: SIZE }));
    expect(document.querySelector('.heatmap-zoom-badge')).toBeNull();
  });
});
