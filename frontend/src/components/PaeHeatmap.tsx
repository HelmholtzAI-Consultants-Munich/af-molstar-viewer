import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { PaeInteractionPerformanceSettings } from '../lib/performance';
import type { MatrixViewport } from '../lib/types';
import {
  PAE_SELECTION_COLORS,
  PAE_PAIR_SELECTION_COLOR,
  PAE_MOLSTAR_SELECTION_STYLE,
  PAE_SELECTION_MAX_CROSS_BLOCKS,
} from '../lib/constants';
import { clamp, contiguousRuns } from '../lib/utils';
import {
  fullView,
  isFullView,
  panView,
  viewCellAt,
  viewFraction,
  zoomViewAt,
  type PaeView,
} from '../lib/pae-viewport';
import { parsePaeJson } from '../lib/parsers/pae';

interface PaeHeatmapProps {
  matrix: number[][];
  maxValue: number;
  syntheticPae: boolean;
  hoveredCell: { x: number; y: number } | null;
  pinnedResidues: number[];
  pinnedCell: { x: number; y: number } | null;
  selectedResidues: number[];
  brushSelection: MatrixViewport | null;
  interactionPerformance: PaeInteractionPerformanceSettings;
  hoverSyncEnabled: boolean;
  pairSelectionEnabled: boolean;
  onHoverCell: (cell: { x: number; y: number } | null) => void;
  onClickCell: (cell: { x: number; y: number }) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
  onToggleHoverSync: () => void;
  onTogglePairSelection: () => void;
  onClearPairSelection: () => void;
  onImportPaeData: (paeMatrix: number[][], paeMax: number) => void;
}

const PAE_COLOR_STOPS = [
  { offset: 0, color: { r: 22, g: 92, b: 42 } },
  { offset: 0.24, color: { r: 43, g: 138, b: 64 } },
  { offset: 0.52, color: { r: 88, g: 171, b: 94 } },
  { offset: 0.78, color: { r: 171, g: 217, b: 168 } },
  { offset: 1, color: { r: 243, g: 247, b: 239 } },
] as const;

interface Tick {
  value: number;
  ratio: number;
}

function paeColorChannels(ratio: number): { r: number; g: number; b: number } {
  const upperIndex = PAE_COLOR_STOPS.findIndex((stop) => ratio <= stop.offset);
  const upper = upperIndex === -1 ? PAE_COLOR_STOPS[PAE_COLOR_STOPS.length - 1] : PAE_COLOR_STOPS[upperIndex];
  const lower = upperIndex <= 0 ? PAE_COLOR_STOPS[0] : PAE_COLOR_STOPS[upperIndex - 1];
  const span = Math.max(upper.offset - lower.offset, Number.EPSILON);
  const localRatio = (ratio - lower.offset) / span;
  return {
    r: Math.round(lower.color.r + (upper.color.r - lower.color.r) * localRatio),
    g: Math.round(lower.color.g + (upper.color.g - lower.color.g) * localRatio),
    b: Math.round(lower.color.b + (upper.color.b - lower.color.b) * localRatio),
  };
}

function paeRatio(value: number, maxValue: number): number {
  return Math.min(1, Math.max(0, value / Math.max(maxValue, 1)));
}

function colorForPae(value: number, maxValue: number): string {
  const { r, g, b } = paeColorChannels(paeRatio(value, maxValue));
  return `rgb(${r}, ${g}, ${b})`;
}

function niceStep(maxValue: number, targetTickCount: number): number {
  const rough = Math.max(maxValue / Math.max(targetTickCount, 1), 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const candidates = [1, 2, 5, 10].map((factor) => factor * magnitude);
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - rough) < Math.abs(best - rough) ? candidate : best,
  );
}

/**
 * Round tick values inside the visible range, positioned as a fraction of it. At the full
 * view this reproduces what the axes showed before zoom existed.
 *
 * `forceTerminal` appends the far end when it is not already a round multiple, which the
 * y axis has always done. It is dropped when zoomed, where a tick at an arbitrary residue
 * next to round ones reads as noise.
 */
function buildRangeTicks(start: number, end: number, forceTerminal: boolean): Tick[] {
  const span = end - start;
  if (span <= 0) return [];
  const step = niceStep(span, 6);
  const values: number[] = [];
  for (let value = Math.ceil(start / step) * step; value <= end + 1e-9; value += step) {
    values.push(Math.round(value));
  }
  if (forceTerminal && values.at(-1) !== Math.round(end)) {
    values.push(Math.round(end));
  }
  return values.map((value) => ({ value, ratio: (value - start) / span }));
}

function buildLegendTicks(maxValue: number): Tick[] {
  if (maxValue <= 0) return [{ value: 0, ratio: 0 }];
  const roundedMax = Math.max(1, Math.round(maxValue / 5) * 5);
  const step = niceStep(roundedMax, 6);
  const ticks: number[] = [0];
  for (let value = step; value < roundedMax; value += step) {
    ticks.push(value);
  }
  if (ticks.at(-1) !== roundedMax) ticks.push(roundedMax);
  return ticks.map((value) => ({
    value,
    ratio: roundedMax === 0 ? 0 : value / roundedMax,
  }));
}

function filterAxisLabelTicks(ticks: Tick[]): Tick[] {
  if (ticks.length < 3) return ticks;

  const filtered = [...ticks];
  const last = filtered[filtered.length - 1];
  const penultimate = filtered[filtered.length - 2];
  const minLabelGap = 0.12;

  if (last.ratio - penultimate.ratio < minLabelGap) {
    filtered.splice(filtered.length - 2, 1);
  }

  return filtered;
}

function filterXAxisTickLabels(ticks: Tick[]): Tick[] {
  if (ticks.length === 0) return ticks;
  const last = ticks[ticks.length - 1];
  if (1 - last.ratio < 0.08) {
    return ticks.slice(0, -1);
  }
  return ticks;
}

function tickAnchor(index: number, total: number) {
  if (index === 0) return 'start';
  if (index === total - 1) return 'end';
  return 'middle';
}

function drawDiagonalSegment(
  context: CanvasRenderingContext2D,
  start: number,
  end: number,
  cellWidth: number,
  cellHeight: number,
  color: string,
  lineWidth = 2.25,
) {
  if (end < start) return;
  if (typeof context.save === 'function') context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  // Corner to corner: cell i's own diagonal runs from (i, i) to (i + 1, i + 1), so a run of
  // cells covers start -> end + 1. Butt caps let neighbouring runs of different colours meet
  // exactly at the shared corner rather than overlapping by half a stroke.
  context.lineCap = 'butt';
  context.beginPath();
  context.moveTo(start * cellWidth, start * cellHeight);
  context.lineTo((end + 1) * cellWidth, (end + 1) * cellHeight);
  context.stroke();
  if (typeof context.restore === 'function') context.restore();
}

function drawBrushDiagonalHighlights(
  context: CanvasRenderingContext2D,
  selection: MatrixViewport,
  size: number,
  cellWidth: number,
  cellHeight: number,
) {
  type SegmentKind = 'inside' | 'aboveBelow' | 'leftRight' | null;

  let segmentStart = -1;
  let segmentKind: SegmentKind = null;

  const flushSegment = (endIndex: number) => {
    if (segmentKind === null || segmentStart < 0) return;
    const color =
      segmentKind === 'inside'
        ? PAE_SELECTION_COLORS.xRange
        : segmentKind === 'aboveBelow'
          ? PAE_SELECTION_COLORS.yRange
          : PAE_SELECTION_COLORS.overlap;
    drawDiagonalSegment(context, segmentStart, endIndex, cellWidth, cellHeight, color);
    segmentStart = -1;
    segmentKind = null;
  };

  for (let index = 0; index < size; index += 1) {
    const xIn = index >= selection.xStart && index <= selection.xEnd;
    const yIn = index >= selection.yStart && index <= selection.yEnd;
    const kind: SegmentKind = xIn && yIn ? 'inside' : xIn ? 'aboveBelow' : yIn ? 'leftRight' : null;

    if (kind === segmentKind) continue;
    flushSegment(index - 1);
    if (kind !== null) {
      segmentStart = index;
      segmentKind = kind;
    }
  }

  flushSegment(size - 1);
}

function drawBrushCornerGuides(
  context: CanvasRenderingContext2D,
  selection: MatrixViewport,
  cellWidth: number,
  cellHeight: number,
) {
  const frameLeft = selection.xStart * cellWidth;
  const frameTop = selection.yStart * cellHeight;
  const frameRight = (selection.xEnd + 1) * cellWidth;
  const frameBottom = (selection.yEnd + 1) * cellHeight;
  const corners = [
    { x: frameLeft, y: frameTop },
    { x: frameRight, y: frameTop },
    { x: frameLeft, y: frameBottom },
    { x: frameRight, y: frameBottom },
  ];

  if (typeof context.save === 'function') context.save();
  context.strokeStyle = 'rgba(255, 255, 255, 0.98)';
  context.lineWidth = 1;
  if (typeof context.setLineDash === 'function') context.setLineDash([4, 4]);
  context.beginPath();
  for (const corner of corners) {
    if (Math.abs(corner.x - corner.y) < 0.5) continue;
    context.moveTo(corner.x, corner.y);
    context.lineTo(corner.x, corner.x);
    context.moveTo(corner.x, corner.y);
    context.lineTo(corner.y, corner.y);
  }
  context.stroke();
  if (typeof context.restore === 'function') context.restore();
}

type SelectionRun = { start: number; end: number };

function drawSelectionBlockGuides(
  context: CanvasRenderingContext2D,
  runs: SelectionRun[],
  cellWidth: number,
  cellHeight: number,
) {
  if (runs.length < 2) return;

  const style = PAE_MOLSTAR_SELECTION_STYLE.guide;
  if (typeof context.save === 'function') context.save();
  context.strokeStyle = style.stroke;
  context.lineWidth = style.lineWidth;
  if (typeof context.setLineDash === 'function') context.setLineDash([...style.dash]);
  context.beginPath();

  for (const yRun of runs) {
    for (const xRun of runs) {
      if (xRun === yRun) continue;
      const left = xRun.start * cellWidth;
      const right = (xRun.end + 1) * cellWidth;
      const top = yRun.start * cellHeight;
      const bottom = (yRun.end + 1) * cellHeight;
      // Runs are sorted and disjoint, so one lies wholly after the other and the gap is never zero.
      const after = xRun.start > yRun.end;

      // Along the block's rows, back to the diagonal square that owns those rows.
      const rowSquareEdge = after ? (yRun.end + 1) * cellWidth : yRun.start * cellWidth;
      const blockRowEdge = after ? left : right;
      context.moveTo(rowSquareEdge, top);
      context.lineTo(blockRowEdge, top);
      context.moveTo(rowSquareEdge, bottom);
      context.lineTo(blockRowEdge, bottom);

      // Along the block's columns, on to the diagonal square that owns those columns.
      const columnSquareEdge = after ? xRun.start * cellHeight : (xRun.end + 1) * cellHeight;
      const blockColumnEdge = after ? bottom : top;
      context.moveTo(left, blockColumnEdge);
      context.lineTo(left, columnSquareEdge);
      context.moveTo(right, blockColumnEdge);
      context.lineTo(right, columnSquareEdge);
    }
  }

  context.stroke();
  if (typeof context.restore === 'function') context.restore();
}

function drawMolstarSelection(
  context: CanvasRenderingContext2D,
  runs: SelectionRun[],
  cellWidth: number,
  cellHeight: number,
) {
  if (runs.length === 0) return;

  const rectFor = (xRun: SelectionRun, yRun: SelectionRun) => ({
    x: xRun.start * cellWidth,
    y: yRun.start * cellHeight,
    width: (xRun.end - xRun.start + 1) * cellWidth,
    height: (yRun.end - yRun.start + 1) * cellHeight,
  });

  const paint = (
    style: { fill: string; stroke?: string; lineWidth?: number; dash?: readonly number[] },
    rect: { x: number; y: number; width: number; height: number },
  ) => {
    if (typeof context.save === 'function') context.save();
    context.fillStyle = style.fill;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (style.stroke) {
      context.strokeStyle = style.stroke;
      context.lineWidth = style.lineWidth ?? 1;
      if (typeof context.setLineDash === 'function') context.setLineDash([...(style.dash ?? [])]);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
    if (typeof context.restore === 'function') context.restore();
  };

  if (runs.length * (runs.length - 1) < PAE_SELECTION_MAX_CROSS_BLOCKS) {
    drawSelectionBlockGuides(context, runs, cellWidth, cellHeight);

    // Cross blocks first, so a neighbouring block edge never overdraws a diagonal square.
    for (const yRun of runs) {
      for (const xRun of runs) {
        if (xRun === yRun) continue;
        paint(PAE_MOLSTAR_SELECTION_STYLE.crossBlock, rectFor(xRun, yRun));
      }
    }
  }

  for (const run of runs) {
    paint(PAE_MOLSTAR_SELECTION_STYLE.diagonal, rectFor(run, run));
  }

  // The selection itself: a bright line along the matrix diagonal over the selected residues,
  // drawn last so nothing washes over it.
  for (const run of runs) {
    drawDiagonalSegment(
      context,
      run.start,
      run.end,
      cellWidth,
      cellHeight,
      PAE_MOLSTAR_SELECTION_STYLE.diagonalLine.stroke,
      PAE_MOLSTAR_SELECTION_STYLE.diagonalLine.lineWidth,
    );
  }
}

function drawPinnedPairMarker(
  context: CanvasRenderingContext2D,
  pinnedCell: { x: number; y: number },
  cellWidth: number,
  cellHeight: number,
) {
  const min = Math.min(pinnedCell.x, pinnedCell.y);
  const max = Math.max(pinnedCell.x, pinnedCell.y);
  const left = min * cellWidth;
  const top = min * cellHeight;
  const right = (max + 1) * cellWidth;
  const bottom = (max + 1) * cellHeight;

  if (typeof context.save === 'function') context.save();
  context.strokeStyle = PAE_PAIR_SELECTION_COLOR;
  context.lineWidth = 1.5;
  if (typeof context.setLineDash === 'function') context.setLineDash([7, 5]);

  if (pinnedCell.x === pinnedCell.y) {
    context.strokeRect(pinnedCell.x * cellWidth, pinnedCell.y * cellHeight, cellWidth, cellHeight);
    if (typeof context.restore === 'function') context.restore();
    return;
  }

  context.beginPath();
  if (pinnedCell.y < pinnedCell.x) {
    context.moveTo(left, top);
    context.lineTo(right, top);
    context.moveTo(right, top);
    context.lineTo(right, bottom);
  } else {
    context.moveTo(left, top);
    context.lineTo(left, bottom);
    context.moveTo(left, bottom);
    context.lineTo(right, bottom);
  }
  context.stroke();
  if (typeof context.restore === 'function') context.restore();
}

const MAX_BITMAP_CELLS = 4096;

/**
 * Rasterise the whole matrix at one pixel per cell, so the view can be drawn with a single
 * `drawImage`. The bitmap is in cell units, so it is independent of layout and of
 * devicePixelRatio: nothing but the matrix itself invalidates it.
 *
 * Returns null when the canvas API is too thin for it (the jsdom stub) or the matrix is
 * too large to hold as a bitmap, and the caller falls back to filling cells one by one.
 */
function buildMatrixBitmap(matrix: number[][], maxValue: number): HTMLCanvasElement | null {
  const size = matrix.length;
  if (size <= 0 || size > MAX_BITMAP_CELLS) return null;

  const bitmap = document.createElement('canvas');
  bitmap.width = size;
  bitmap.height = size;
  const context = bitmap.getContext('2d');
  if (
    !context ||
    typeof context.createImageData !== 'function' ||
    typeof context.putImageData !== 'function'
  ) {
    return null;
  }

  // One lookup per distinct ratio rather than a colour computation per cell.
  const lut = new Uint8Array(256 * 3);
  for (let step = 0; step < 256; step += 1) {
    const { r, g, b } = paeColorChannels(step / 255);
    lut[step * 3] = r;
    lut[step * 3 + 1] = g;
    lut[step * 3 + 2] = b;
  }

  const image = context.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y += 1) {
    const row = matrix[y];
    for (let x = 0; x < size; x += 1) {
      const step = Math.round(paeRatio(row[x], maxValue) * 255) * 3;
      const offset = (y * size + x) * 4;
      data[offset] = lut[step];
      data[offset + 1] = lut[step + 1];
      data[offset + 2] = lut[step + 2];
      data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return bitmap;
}

const ZOOM_HINT = '⇧ scroll to zoom · ⇧ drag to pan';
const WHEEL_ZOOM_RATE = 0.0015;
const WHEEL_LINE_HEIGHT = 16;
const WHEEL_PAGE_HEIGHT = 400;

/**
 * Chrome reports pixels, Firefox lines, some setups pages. Without this, zoom is inert on
 * one and violent on another.
 *
 * Takes whichever axis moved further, because a shifted scroll is delivered horizontally:
 * macOS turns shift + two-finger scroll into `deltaX` with `deltaY` at zero.
 */
function normalizeWheelDelta(event: WheelEvent): number {
  const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (event.deltaMode === 1) return raw * WHEEL_LINE_HEIGHT;
  if (event.deltaMode === 2) return raw * WHEEL_PAGE_HEIGHT;
  return raw;
}

/** Shift, or ctrl — which is how a trackpad pinch arrives. A bare wheel scrolls the drawer. */
function isZoomGesture(event: WheelEvent): boolean {
  return event.shiftKey || event.ctrlKey;
}

function mapClientToCell(
  canvas: HTMLCanvasElement,
  size: number,
  view: PaeView,
  clientX: number,
  clientY: number,
) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: viewCellAt(view, size, view.x0, (clientX - rect.left) / rect.width),
    y: viewCellAt(view, size, view.y0, (clientY - rect.top) / rect.height),
  };
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}`));
    reader.readAsText(file);
  });
}

export function PaeHeatmap(props: PaeHeatmapProps) {
  const matrixCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const wheelAccumRef = useRef<{ delta: number; clientX: number; clientY: number } | null>(null);
  const wheelFrameRef = useRef<number | null>(null);
  const bitmapRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapMatrixRef = useRef<number[][] | null>(null);
  const bitmapMaxValueRef = useRef<number | null>(null);
  const pendingHoverCellRef = useRef<{ x: number; y: number } | null>(null);
  const lastHoverCellKeyRef = useRef('none');
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [frameDrag, setFrameDrag] = useState<{
    startClientX: number;
    startClientY: number;
    selection: MatrixViewport;
  } | null>(null);
  const [panDrag, setPanDrag] = useState<{ startClientX: number; startClientY: number; startView: PaeView } | null>(null);
  const [dropDepth, setDropDepth] = useState(0);
  const [dropError, setDropError] = useState<string | null>(null);
  const size = props.matrix.length;
  const [view, setView] = useState<PaeView>(() => fullView(size));
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Keyed on matrix identity, not size: a dropped-in pAE with the same residue count is
  // still a different protein, and its old view would be meaningless. The ref skips the
  // mount run, where the initial state is already the full view.
  const viewMatrixRef = useRef(props.matrix);
  useEffect(() => {
    if (viewMatrixRef.current === props.matrix) return;
    viewMatrixRef.current = props.matrix;
    setView(fullView(props.matrix.length));
  }, [props.matrix]);
  const atFullView = isFullView(view, size);
  const yAxisTicks = useMemo(
    () => buildRangeTicks(view.y0, view.y0 + view.span, atFullView),
    [view, atFullView],
  );
  const yAxisLabelTicks = useMemo(() => filterAxisLabelTicks(yAxisTicks), [yAxisTicks]);
  const xAxisTicks = useMemo(() => buildRangeTicks(view.x0, view.x0 + view.span, false), [view]);
  const xAxisLabelTickValues = useMemo(() => new Set(filterXAxisTickLabels(xAxisTicks).map((tick) => tick.value)), [xAxisTicks]);
  const legendTicks = useMemo(() => buildLegendTicks(props.maxValue), [props.maxValue]);
  const selectionRuns = useMemo(
    () => contiguousRuns(props.selectedResidues.filter((index) => index >= 0 && index < size)),
    [props.selectedResidues, size],
  );
  const activeBrush =
    dragStart && dragCurrent
      ? {
          xStart: Math.min(dragStart.x, dragCurrent.x),
          xEnd: Math.max(dragStart.x, dragCurrent.x),
          yStart: Math.min(dragStart.y, dragCurrent.y),
          yEnd: Math.max(dragStart.y, dragCurrent.y),
        }
      : props.brushSelection;
  // The wrap has no `overflow: hidden` (the brush clear button sits deliberately at
  // left: 100%), so a zoomed-in brush box would otherwise stretch far outside the panel
  // and, being interactive, swallow clicks over its neighbours. Clamp it to the view and
  // drop it entirely once it no longer intersects.
  const brushBox = (() => {
    if (!props.brushSelection) return null;
    const left = viewFraction(view, view.x0, props.brushSelection.xStart);
    const right = viewFraction(view, view.x0, props.brushSelection.xEnd + 1);
    const top = viewFraction(view, view.y0, props.brushSelection.yStart);
    const bottom = viewFraction(view, view.y0, props.brushSelection.yEnd + 1);
    if (right <= 0 || left >= 1 || bottom <= 0 || top >= 1) return null;
    const clampedLeft = clamp(left, 0, 1);
    const clampedTop = clamp(top, 0, 1);
    return {
      left: clampedLeft,
      top: clampedTop,
      width: clamp(right, 0, 1) - clampedLeft,
      height: clamp(bottom, 0, 1) - clampedTop,
      clearVisible: right >= 0 && right <= 1 && top >= 0 && top <= 1,
      clearLeft: right,
      clearTop: top,
    };
  })();

  const pairCloseAnchor = (() => {
    if (!props.pinnedCell) return null;
    const x = viewFraction(view, view.x0, props.pinnedCell.x + 0.5);
    const y = viewFraction(view, view.y0, props.pinnedCell.y + 0.5);
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
  })();

  const pinnedPairBounds =
    props.pairSelectionEnabled && props.pinnedCell && props.pinnedResidues.length > 1
      ? {
          min: Math.min(props.pinnedCell.x, props.pinnedCell.y),
          max: Math.max(props.pinnedCell.x, props.pinnedCell.y),
        }
      : null;

  useEffect(() => {
    return () => {
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current);
      }
    };
  }, []);

  const commitHoverCell = (cell: { x: number; y: number } | null) => {
    const key = cell ? `${cell.x}:${cell.y}` : 'none';
    if (key === lastHoverCellKeyRef.current) return;
    lastHoverCellKeyRef.current = key;
    props.onHoverCell(cell);
  };

  const scheduleHoverCell = (cell: { x: number; y: number } | null) => {
    if (props.interactionPerformance.heatmapHoverScheduling === 'sync') {
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
      pendingHoverCellRef.current = null;
      commitHoverCell(cell);
      return;
    }

    pendingHoverCellRef.current = cell;
    if (hoverFrameRef.current !== null) return;

    hoverFrameRef.current = requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      const next = pendingHoverCellRef.current;
      pendingHoverCellRef.current = null;
      commitHoverCell(next);
    });
  };

  useEffect(() => {
    const canvas = matrixCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    if (bitmapMatrixRef.current !== props.matrix || bitmapMaxValueRef.current !== props.maxValue) {
      bitmapRef.current = buildMatrixBitmap(props.matrix, props.maxValue);
      bitmapMatrixRef.current = props.matrix;
      bitmapMaxValueRef.current = props.maxValue;
    }

    const bitmap = bitmapRef.current;
    if (bitmap && typeof context.drawImage === 'function') {
      // Smooth only when shrinking. Magnified cells want hard edges, but with more cells
      // than device pixels nearest-neighbour would drop whole rows and columns.
      // Measured in device pixels, not CSS pixels: the destination is drawn under the
      // devicePixelRatio transform, so on a 2x display downsampling starts twice as late.
      context.imageSmoothingEnabled = (width * window.devicePixelRatio) / view.span < 1;
      context.drawImage(bitmap, view.x0, view.y0, view.span, view.span, 0, 0, width, height);
      return;
    }

    const cellWidth = width / view.span;
    const cellHeight = height / view.span;
    const firstX = Math.max(0, Math.floor(view.x0));
    const firstY = Math.max(0, Math.floor(view.y0));
    const lastX = Math.min(size - 1, Math.ceil(view.x0 + view.span));
    const lastY = Math.min(size - 1, Math.ceil(view.y0 + view.span));

    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) {
        context.fillStyle = colorForPae(props.matrix[y][x], props.maxValue);
        // Overpaint by half a pixel so fractional cell edges do not leave hairline seams.
        context.fillRect(
          (x - view.x0) * cellWidth,
          (y - view.y0) * cellHeight,
          cellWidth + 0.5,
          cellHeight + 0.5,
        );
      }
    }
  }, [props.matrix, props.maxValue, size, view]);

  useEffect(() => {
    if (!frameDrag) return;

    const handleMove = (event: MouseEvent) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas || size <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const cellWidth = rect.width / view.span;
      const cellHeight = rect.height / view.span;
      const deltaX = Math.round((event.clientX - frameDrag.startClientX) / Math.max(cellWidth, 1));
      const deltaY = Math.round((event.clientY - frameDrag.startClientY) / Math.max(cellHeight, 1));
      const width = frameDrag.selection.xEnd - frameDrag.selection.xStart;
      const height = frameDrag.selection.yEnd - frameDrag.selection.yStart;
      const xStart = clamp(frameDrag.selection.xStart + deltaX, 0, size - width - 1);
      const yStart = clamp(frameDrag.selection.yStart + deltaY, 0, size - height - 1);

      props.onBrushSelectionChange({
        xStart,
        xEnd: xStart + width,
        yStart,
        yEnd: yStart + height,
      });
    };

    const handleUp = () => {
      setFrameDrag(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [frameDrag, props, size]);

  useEffect(() => {
    if (!dragStart) return;

    const handleMove = (event: MouseEvent) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const cell = mapClientToCell(canvas, size, view, event.clientX, event.clientY);
      setDragCurrent({ x: cell.x, y: cell.y });
      props.onBrushSelectionChange({
        xStart: Math.min(dragStart.x, cell.x),
        xEnd: Math.max(dragStart.x, cell.x),
        yStart: Math.min(dragStart.y, cell.y),
        yEnd: Math.max(dragStart.y, cell.y),
      });
    };

    const handleUp = (event: MouseEvent) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const cell = mapClientToCell(canvas, size, view, event.clientX, event.clientY);
      const minX = Math.min(dragStart.x, cell.x);
      const maxX = Math.max(dragStart.x, cell.x);
      const minY = Math.min(dragStart.y, cell.y);
      const maxY = Math.max(dragStart.y, cell.y);
      if (maxX === minX && maxY === minY) {
        if (props.pairSelectionEnabled) {
          props.onClickCell({ x: cell.x, y: cell.y });
        }
        props.onBrushSelectionChange(null);
      } else {
        props.onBrushSelectionChange({
          xStart: minX,
          xEnd: maxX,
          yStart: minY,
          yEnd: maxY,
        });
      }
      setDragStart(null);
      setDragCurrent(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragStart, props, size]);

  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    const applyPendingWheel = () => {
      wheelFrameRef.current = null;
      const pending = wheelAccumRef.current;
      wheelAccumRef.current = null;
      const canvas = overlayCanvasRef.current;
      if (!pending || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const fx = clamp((pending.clientX - rect.left) / rect.width, 0, 1);
      const fy = clamp((pending.clientY - rect.top) / rect.height, 0, 1);
      setView((current) => zoomViewAt(current, size, Math.exp(pending.delta * WHEEL_ZOOM_RATE), fx, fy));
    };

    const handleWheel = (event: WheelEvent) => {
      if (!isZoomGesture(event)) return;
      const delta = normalizeWheelDelta(event);
      if (delta === 0) return;

      // Always consume it, including at the zoom limits: the modifier says the gesture was
      // meant for the matrix, and a bare wheel already scrolls the drawer.
      event.preventDefault();
      lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      wheelAccumRef.current = {
        delta: (wheelAccumRef.current?.delta ?? 0) + delta,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      if (wheelFrameRef.current === null) {
        wheelFrameRef.current = requestAnimationFrame(applyPendingWheel);
      }
    };

    // Native and non-passive: React 18 registers wheel passively, so a JSX onWheel could
    // not preventDefault. On the wrap rather than the canvas, because the brush handle and
    // the clear buttons stack above the canvas and would otherwise be dead zones.
    wrap.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      wrap.removeEventListener('wheel', handleWheel);
      if (wheelFrameRef.current !== null) {
        cancelAnimationFrame(wheelFrameRef.current);
        wheelFrameRef.current = null;
      }
    };
  }, [size]);

  useEffect(() => {
    if (!panDrag) return;

    const handleMove = (event: MouseEvent) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cell = rect.width / panDrag.startView.span;
      setView(
        panView(
          panDrag.startView,
          size,
          -(event.clientX - panDrag.startClientX) / cell,
          -(event.clientY - panDrag.startClientY) / cell,
        ),
      );
    };

    const handleUp = () => setPanDrag(null);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [panDrag, size]);

  // A wheel event fires no mousemove, so without this the crosshair stays on a cell that is
  // no longer under the cursor and Mol* highlights the wrong residue.
  useEffect(() => {
    const pointer = lastPointerRef.current;
    const canvas = overlayCanvasRef.current;
    if (!pointer || !canvas) return;
    const cell = mapClientToCell(canvas, size, view, pointer.clientX, pointer.clientY);
    scheduleHoverCell({ x: cell.x, y: cell.y });
    if (dragStart) {
      setDragCurrent({ x: cell.x, y: cell.y });
      props.onBrushSelectionChange({
        xStart: Math.min(dragStart.x, cell.x),
        xEnd: Math.max(dragStart.x, cell.x),
        yStart: Math.min(dragStart.y, cell.y),
        yEnd: Math.max(dragStart.y, cell.y),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    const dpr = window.devicePixelRatio;
    const cellWidth = width / view.span;
    const cellHeight = height / view.span;
    // Translate by the view origin, never scale: stroke widths, dashes and button offsets
    // are in CSS pixels and must not grow with the zoom. Every module-level draw* helper
    // multiplies matrix indices by cellWidth, so this is the only place that knows the origin.
    context.setTransform(dpr, 0, 0, dpr, -view.x0 * cellWidth * dpr, -view.y0 * cellHeight * dpr);
    context.clearRect(view.x0 * cellWidth, view.y0 * cellHeight, width, height);

    drawMolstarSelection(context, selectionRuns, cellWidth, cellHeight);

    if (props.hoveredCell && !frameDrag) {
      if (typeof context.save === 'function') context.save();
      context.strokeStyle = '#111111';
      context.lineWidth = 1;
      if (typeof context.setLineDash === 'function') context.setLineDash([4, 4]);
      const x = props.hoveredCell.x * cellWidth;
      const y = props.hoveredCell.y * cellHeight;
      context.beginPath();
      const viewLeft = view.x0 * cellWidth;
      const viewTop = view.y0 * cellHeight;
      context.moveTo(viewLeft, y + cellHeight / 2);
      context.lineTo(viewLeft + width, y + cellHeight / 2);
      context.moveTo(x + cellWidth / 2, viewTop);
      context.lineTo(x + cellWidth / 2, viewTop + height);
      context.stroke();
      context.strokeRect(x, y, cellWidth, cellHeight);
      if (typeof context.restore === 'function') context.restore();
    }

    if (props.pairSelectionEnabled && props.pinnedCell && props.pinnedResidues.length > 1 && !activeBrush) {
      drawPinnedPairMarker(context, props.pinnedCell, cellWidth, cellHeight);
    }

    if (activeBrush) {
      const x = activeBrush.xStart * cellWidth;
      const y = activeBrush.yStart * cellHeight;
      const brushWidth = (activeBrush.xEnd - activeBrush.xStart + 1) * cellWidth;
      const brushHeight = (activeBrush.yEnd - activeBrush.yStart + 1) * cellHeight;

      if (typeof context.save === 'function') context.save();
      context.fillStyle = 'rgba(139, 143, 148, 0.32)';
      context.fillRect(x, y, brushWidth, brushHeight);
      if (typeof context.restore === 'function') context.restore();
      drawBrushCornerGuides(context, activeBrush, cellWidth, cellHeight);
      if (typeof context.save === 'function') context.save();
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.25;
      context.strokeRect(x, y, brushWidth, brushHeight);
      if (typeof context.restore === 'function') context.restore();
      drawBrushDiagonalHighlights(context, activeBrush, size, cellWidth, cellHeight);
    }
  }, [
    activeBrush,
    dragCurrent,
    dragStart,
    frameDrag,
    props.hoveredCell,
    props.pairSelectionEnabled,
    props.pinnedCell,
    props.pinnedResidues.length,
    selectionRuns,
    size,
    view,
  ]);

  const beginPan = (clientX: number, clientY: number) => {
    setPanDrag({ startClientX: clientX, startClientY: clientY, startView: viewRef.current });
  };

  const mapPointer = (clientX: number, clientY: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return null;
    return mapClientToCell(canvas, size, viewRef.current, clientX, clientY);
  };

  const handleFileDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDropDepth(0);

    const file = [...event.dataTransfer.files].find((entry) => entry.type === 'application/json' || entry.name.toLowerCase().endsWith('.json')) ?? event.dataTransfer.files[0];
    if (!file) return;

    try {
      const text = await readFileText(file);
      const parsed = parsePaeJson(text);
      props.onImportPaeData(parsed.matrix, parsed.maxValue);
      setDropError(null);
    } catch (error) {
      setDropError(error instanceof Error ? error.message : 'Unable to import pAE JSON');
    }
  };

  return (
    <section
      className={`panel heatmap-panel${dropDepth > 0 ? ' dropping' : ''}${dropError ? ' drop-error' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDropDepth((current) => current + 1);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDropDepth((current) => Math.max(0, current - 1));
      }}
      onDrop={(event) => {
        void handleFileDrop(event);
      }}
    >
      <div className="heatmap-chart">
        <div className="heatmap-chart-main">
          <div className="heatmap-plot-row">
            <div className="heatmap-y-label">Aligned residue</div>
            <div className="heatmap-y-ticks" aria-hidden="true">
              {yAxisLabelTicks.map((tick, index) => {
                const anchor = tickAnchor(index, yAxisLabelTicks.length);
                return (
                  <span
                    key={`y-${tick.value}`}
                    className={`heatmap-tick heatmap-tick-${anchor}`}
                    style={{ top: `${tick.ratio * 100}%` }}
                  >
                    {tick.value}
                  </span>
                );
              })}
            </div>
            <div className="heatmap-canvas-wrap" ref={canvasWrapRef}>
              {!atFullView && (
                <div className="heatmap-zoom-badge">
                  {/* The axes already label the visible range on each side, and after a
                      diagonal pan those two ranges differ, so report the span instead. */}
                  <span>
                    {Math.round(view.span)}&times;{Math.round(view.span)} residues
                  </span>
                  <button type="button" onClick={() => setView(fullView(size))}>
                    Reset
                  </button>
                </div>
              )}
              {props.syntheticPae && (
                <div className="heatmap-overlay-notice" aria-live="polite">
                  <strong>Empty pAE</strong>
                  <span>This model did not include predicted aligned error data.</span>
                </div>
              )}
              {dropDepth > 0 && (
                <div className="heatmap-drop-overlay" aria-live="polite">
                  <strong>Drop pAE JSON</strong>
                  <span>Release to import pAE data into this artifact.</span>
                </div>
              )}
              <canvas
                ref={matrixCanvasRef}
                className="heatmap-matrix-canvas"
                aria-hidden="true"
              />
              <canvas
                ref={overlayCanvasRef}
                className={`heatmap-canvas${panDrag ? ' panning' : ''}`}
                // Native tooltip, as elsewhere in the app: it waits for the pointer to settle
                // and gets out of the way the moment it moves again.
                title={atFullView ? ZOOM_HINT : undefined}
                onMouseMove={(event) => {
                  if (props.interactionPerformance.suppressHoverWhileInteracting && (dragStart || frameDrag)) {
                    return;
                  }
                  lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
                  const cell = mapPointer(event.clientX, event.clientY);
                  if (!cell) return;
                  scheduleHoverCell({ x: cell.x, y: cell.y });
                }}
                onMouseLeave={() => {
                  lastPointerRef.current = null;
                  scheduleHoverCell(null);
                }}
                onMouseDown={(event) => {
                  if (event.shiftKey) {
                    event.preventDefault();
                    scheduleHoverCell(null);
                    beginPan(event.clientX, event.clientY);
                    return;
                  }
                  const cell = mapPointer(event.clientX, event.clientY);
                  if (!cell) return;
                  if (props.interactionPerformance.suppressHoverWhileInteracting) {
                    scheduleHoverCell(null);
                  }
                  setDragStart({ x: cell.x, y: cell.y });
                  setDragCurrent({ x: cell.x, y: cell.y });
                }}
              />
              {props.brushSelection && brushBox && size > 0 && (
                <>
                  <div
                    className={`heatmap-frame-drag-handle${frameDrag ? ' dragging' : ''}`}
                    style={{
                      left: `${brushBox.left * 100}%`,
                      top: `${brushBox.top * 100}%`,
                      width: `${brushBox.width * 100}%`,
                      height: `${brushBox.height * 100}%`,
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (props.interactionPerformance.suppressHoverWhileInteracting) {
                        scheduleHoverCell(null);
                      }
                      // This handle sits above the canvas and swallows the event, so a
                      // shift-drag started over your own brush has to pan from here.
                      if (event.shiftKey) {
                        beginPan(event.clientX, event.clientY);
                        return;
                      }
                      setFrameDrag({
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        selection: props.brushSelection!,
                      });
                    }}
                  />
                  {!frameDrag && brushBox.clearVisible && (
                    <button
                      type="button"
                      className="heatmap-close-button"
                      style={{
                        left: `${brushBox.clearLeft * 100}%`,
                        top: `${brushBox.clearTop * 100}%`,
                      }}
                      aria-label="Clear selection"
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onBrushSelectionChange(null);
                      }}
                    >
                      ×
                    </button>
                  )}
                </>
              )}
              {pinnedPairBounds && pairCloseAnchor && !activeBrush && !frameDrag && (
                <button
                  type="button"
                  className="heatmap-close-button heatmap-pair-close-button"
                  style={{
                    left: `calc(${pairCloseAnchor.x * 100}% + 20px)`,
                    top: `calc(${pairCloseAnchor.y * 100}% - 20px)`,
                  }}
                  aria-label="Clear pair"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onClearPairSelection();
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
          <div className="heatmap-x-axis-row">
            <div className="heatmap-axis-spacer" aria-hidden="true" />
            <div className="heatmap-y-ticks-spacer" aria-hidden="true" />
            <div className="heatmap-x-ticks" aria-hidden="true">
              {xAxisTicks.map((tick, index) => {
                const anchor = tickAnchor(index, xAxisTicks.length);
                return (
                  <span
                    key={`x-${tick.value}`}
                    className={`heatmap-tick heatmap-tick-${anchor}`}
                    style={{ left: `${tick.ratio * 100}%` }}
                  >
                    {xAxisLabelTickValues.has(tick.value) && (
                      <span className={`heatmap-tick-label heatmap-tick-label-${anchor}`}>{tick.value}</span>
                    )}
                  </span>
                );
              })}
              <span className="heatmap-axis-end-label">{Math.round(view.x0 + view.span)}</span>
            </div>
          </div>
          <div className="heatmap-x-label">Scored residue</div>
          <div className="heatmap-colorbar-row">
            <div className="heatmap-axis-spacer" aria-hidden="true" />
            <div className="heatmap-y-ticks-spacer" aria-hidden="true" />
            <div className="heatmap-colorbar-group">
              <div className="heatmap-gradient" />
              <div className="heatmap-colorbar-ticks" aria-hidden="true">
                {legendTicks.map((tick, index) => {
                  const anchor = tickAnchor(index, legendTicks.length);
                  return (
                    <span
                      key={`legend-${tick.value}`}
                      className={`heatmap-tick heatmap-tick-${anchor}`}
                      style={{ left: `${tick.ratio * 100}%` }}
                    >
                      <span className={`heatmap-tick-label heatmap-tick-label-${anchor}`}>{tick.value}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="heatmap-colorbar-label">Expected position error (Ångströms)</div>
          <div className="heatmap-footer">
            <div className="heatmap-actions">
              <label className="switch-field">
                <span className="switch-label">pair hover</span>
                <span className="switch-control">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="pair hover"
                    checked={props.hoverSyncEnabled}
                    onChange={props.onToggleHoverSync}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                </span>
              </label>
              <label className="switch-field">
                <span className="switch-label">pair click</span>
                <span className="switch-control">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="pair click"
                    checked={props.pairSelectionEnabled}
                    onChange={props.onTogglePairSelection}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                </span>
              </label>
            </div>
            <div className="heatmap-description">
              <h3>Predicted Aligned Error (pAE)</h3>
              <p>
                pAE measures the confidence in the relative position of two residues&nbsp;&ndash;{' '}
                <strong>
                  <a
                    href="https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/pae-a-measure-of-global-confidence-in-alphafold-predictions/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    see&nbsp;guide
                  </a>
                </strong>{' '}
                for more information.
              </p>
            </div>
          </div>
          {dropError && <div className="heatmap-drop-error">{dropError}</div>}
        </div>
      </div>
    </section>
  );
}
