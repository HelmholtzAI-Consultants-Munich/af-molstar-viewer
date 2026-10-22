import { describe, expect, it } from 'vitest';
import {
  PAE_MIN_VIEW_SPAN,
  clampView,
  fullView,
  isFullView,
  panView,
  viewCellAt,
  viewFraction,
  zoomViewAt,
  type PaeView,
} from '../lib/pae-viewport';

const SIZE = 100;

describe('clampView', () => {
  it('keeps the whole matrix as the widest view', () => {
    expect(clampView({ x0: 0, y0: 0, span: 500 }, SIZE)).toEqual({ x0: 0, y0: 0, span: SIZE });
  });

  it('stops the view escaping the matrix', () => {
    expect(clampView({ x0: 90, y0: -30, span: 20 }, SIZE)).toEqual({ x0: 80, y0: 0, span: 20 });
  });

  it('will not zoom past the minimum span', () => {
    expect(clampView({ x0: 10, y0: 10, span: 1 }, SIZE).span).toBe(PAE_MIN_VIEW_SPAN);
  });

  it('collapses the minimum span for a matrix smaller than it', () => {
    // The toy bundle shared by the other tests is 3x3, well under PAE_MIN_VIEW_SPAN.
    expect(clampView({ x0: 0, y0: 0, span: 1 }, 3)).toEqual({ x0: 0, y0: 0, span: 3 });
  });

  it('clamps the span before the origin, so zooming out at an edge keeps the view inside', () => {
    // Against the right edge: widening to 60 leaves room for x0 = 40 at most.
    expect(clampView({ x0: 80, y0: 80, span: 60 }, SIZE)).toEqual({ x0: 40, y0: 40, span: 60 });
  });
});

describe('zoomViewAt', () => {
  const anchoredCell = (view: PaeView, fraction: number) => view.x0 + fraction * view.span;

  it('holds the cell under the cursor in place', () => {
    const view = fullView(SIZE);
    const zoomed = zoomViewAt(view, SIZE, 0.5, 0.25, 0.75);

    expect(anchoredCell(zoomed, 0.25)).toBeCloseTo(anchoredCell(view, 0.25), 10);
    expect(zoomed.y0 + 0.75 * zoomed.span).toBeCloseTo(view.y0 + 0.75 * view.span, 10);
    expect(zoomed.span).toBe(50);
  });

  it('holds the anchor across repeated notches', () => {
    const start = fullView(SIZE);
    const target = anchoredCell(start, 0.6);
    let view = start;
    for (let step = 0; step < 8; step += 1) {
      view = zoomViewAt(view, SIZE, 0.8, 0.6, 0.6);
    }

    expect(anchoredCell(view, 0.6)).toBeCloseTo(target, 8);
  });

  it('returns to where it started when zooming in and back out', () => {
    const start = { x0: 20, y0: 30, span: 40 };
    const zoomed = zoomViewAt(start, SIZE, 0.5, 0.35, 0.65);
    const restored = zoomViewAt(zoomed, SIZE, 2, 0.35, 0.65);

    expect(restored.x0).toBeCloseTo(start.x0, 10);
    expect(restored.y0).toBeCloseTo(start.y0, 10);
    expect(restored.span).toBeCloseTo(start.span, 10);
  });

  it('stays inside the matrix when zooming out at a corner', () => {
    const corner = { x0: SIZE - PAE_MIN_VIEW_SPAN, y0: SIZE - PAE_MIN_VIEW_SPAN, span: PAE_MIN_VIEW_SPAN };
    const zoomed = zoomViewAt(corner, SIZE, 4, 1, 1);

    expect(zoomed.x0).toBeGreaterThanOrEqual(0);
    expect(zoomed.x0 + zoomed.span).toBeLessThanOrEqual(SIZE);
    expect(zoomed.y0 + zoomed.span).toBeLessThanOrEqual(SIZE);
  });
});

describe('panView', () => {
  it('moves the view by whole and fractional cells', () => {
    expect(panView({ x0: 20, y0: 20, span: 10 }, SIZE, 5, -7)).toEqual({ x0: 25, y0: 13, span: 10 });
  });

  it('stops at the edges instead of running off', () => {
    expect(panView({ x0: 2, y0: 95, span: 10 }, SIZE, -50, 50)).toEqual({ x0: 0, y0: 90, span: 10 });
  });
});

describe('viewFraction and viewCellAt', () => {
  const view = { x0: 40, y0: 10, span: 20 };

  it('puts the view origin at 0 and its far edge at 1', () => {
    expect(viewFraction(view, view.x0, 40)).toBe(0);
    expect(viewFraction(view, view.x0, 60)).toBe(1);
    expect(viewFraction(view, view.x0, 50)).toBe(0.5);
  });

  it('reports positions outside the view beyond 0..1, so callers can cull them', () => {
    expect(viewFraction(view, view.x0, 20)).toBeLessThan(0);
    expect(viewFraction(view, view.x0, 80)).toBeGreaterThan(1);
  });

  it('round-trips a cell through its fraction', () => {
    for (const cell of [40, 45, 51, 59]) {
      const fraction = viewFraction(view, view.x0, cell);
      expect(viewCellAt(view, SIZE, view.x0, fraction)).toBe(cell);
    }
  });

  it('never maps outside the matrix', () => {
    expect(viewCellAt(view, SIZE, view.x0, -5)).toBe(0);
    expect(viewCellAt(view, SIZE, view.x0, 5)).toBe(SIZE - 1);
  });
});

describe('fullView and isFullView', () => {
  it('starts at the whole matrix', () => {
    expect(fullView(SIZE)).toEqual({ x0: 0, y0: 0, span: SIZE });
    expect(isFullView(fullView(SIZE), SIZE)).toBe(true);
  });

  it('knows when the view is zoomed', () => {
    expect(isFullView({ x0: 0, y0: 0, span: 50 }, SIZE)).toBe(false);
    expect(isFullView({ x0: 10, y0: 0, span: SIZE }, SIZE)).toBe(false);
  });
});
