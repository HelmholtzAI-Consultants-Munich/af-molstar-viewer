import { clamp } from './utils';

/**
 * The window of the pAE matrix currently on screen.
 *
 * Bounds are fractional cells, not the inclusive integer indices of `MatrixViewport`:
 * a cursor-anchored zoom only lands on whole cells by coincidence, and rounding the
 * origin every notch would make the anchored cell drift under the pointer.
 *
 * `span` is deliberately one field rather than separate x and y extents. The canvas is
 * square, so an equal span keeps cells square and the matrix diagonal at 45 degrees,
 * which every overlay in the panel is drawn around.
 */
export interface PaeView {
  x0: number;
  y0: number;
  span: number;
}

export const PAE_MIN_VIEW_SPAN = 8;

export function fullView(size: number): PaeView {
  return { x0: 0, y0: 0, span: Math.max(size, 1) };
}

export function isFullView(view: PaeView, size: number): boolean {
  return view.span >= size && view.x0 <= 0 && view.y0 <= 0;
}

/**
 * The only way to build a valid view. Span is clamped before the origin: clamping the
 * other way round pins the wrong edge when zooming out against a boundary.
 */
export function clampView(view: PaeView, size: number): PaeView {
  const extent = Math.max(size, 1);
  const span = clamp(view.span, Math.min(PAE_MIN_VIEW_SPAN, extent), extent);
  return {
    x0: clamp(view.x0, 0, extent - span),
    y0: clamp(view.y0, 0, extent - span),
    span,
  };
}

/**
 * Zoom by `factor` about a point given as a fraction of the canvas, keeping the matrix
 * cell under that point in place. Clamping may pull the view off the anchor at an edge.
 */
export function zoomViewAt(
  view: PaeView,
  size: number,
  factor: number,
  fx: number,
  fy: number,
): PaeView {
  const extent = Math.max(size, 1);
  const span = clamp(view.span * factor, Math.min(PAE_MIN_VIEW_SPAN, extent), extent);
  return clampView(
    {
      x0: view.x0 + fx * (view.span - span),
      y0: view.y0 + fy * (view.span - span),
      span,
    },
    size,
  );
}

export function panView(view: PaeView, size: number, dxCells: number, dyCells: number): PaeView {
  return clampView({ x0: view.x0 + dxCells, y0: view.y0 + dyCells, span: view.span }, size);
}

/** A matrix index as a 0..1 position across the view. Outside the view it falls outside 0..1. */
export function viewFraction(view: PaeView, axisOrigin: number, index: number): number {
  return (index - axisOrigin) / view.span;
}

/** A 0..1 position across the view as a whole matrix cell. */
export function viewCellAt(view: PaeView, size: number, axisOrigin: number, fraction: number): number {
  return clamp(Math.floor(axisOrigin + fraction * view.span), 0, Math.max(size - 1, 0));
}
