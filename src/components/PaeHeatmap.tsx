import { useEffect, useMemo, useRef, useState } from 'react';
import type { PaeInteractionPerformanceSettings } from '../lib/performance';
import type { MatrixViewport } from '../lib/types';
import { PAE_SELECTION_COLORS, PAE_PAIR_SELECTION_COLOR } from '../lib/constants';
import { clamp } from '../lib/utils';

interface PaeHeatmapProps {
  matrix: number[][];
  maxValue: number;
  syntheticPae: boolean;
  hoveredCell: { x: number; y: number } | null;
  pinnedResidues: number[];
  pinnedCell: { x: number; y: number } | null;
  brushSelection: MatrixViewport | null;
  interactionPerformance: PaeInteractionPerformanceSettings;
  hoverSyncEnabled: boolean;
  pairSelectionEnabled: boolean;
  colorByPLDDTEnabled: boolean;
  onHoverCell: (cell: { x: number; y: number } | null) => void;
  onClickCell: (cell: { x: number; y: number }) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
  onToggleHoverSync: () => void;
  onTogglePairSelection: () => void;
  onClearPairSelection: () => void;
  onToggleColorByPLDDT: () => void;
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

function colorForPae(value: number, maxValue: number): string {
  const ratio = Math.min(1, Math.max(0, value / Math.max(maxValue, 1)));
  const upperIndex = PAE_COLOR_STOPS.findIndex((stop) => ratio <= stop.offset);
  const upper = upperIndex === -1 ? PAE_COLOR_STOPS[PAE_COLOR_STOPS.length - 1] : PAE_COLOR_STOPS[upperIndex];
  const lower = upperIndex <= 0 ? PAE_COLOR_STOPS[0] : PAE_COLOR_STOPS[upperIndex - 1];
  const span = Math.max(upper.offset - lower.offset, Number.EPSILON);
  const localRatio = (ratio - lower.offset) / span;
  const r = Math.round(lower.color.r + (upper.color.r - lower.color.r) * localRatio);
  const g = Math.round(lower.color.g + (upper.color.g - lower.color.g) * localRatio);
  const b = Math.round(lower.color.b + (upper.color.b - lower.color.b) * localRatio);
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

function buildAxisTicks(size: number): Tick[] {
  if (size <= 0) return [];
  const maxValue = size;
  const step = niceStep(maxValue, 6);
  const ticks: number[] = [0];
  for (let value = step; value < maxValue; value += step) {
    ticks.push(value);
  }
  if (ticks.at(-1) !== maxValue) ticks.push(maxValue);
  return ticks.map((value) => ({
    value,
    ratio: maxValue === 0 ? 0 : value / maxValue,
  }));
}

function buildRegularAxisTicks(size: number): Tick[] {
  if (size <= 0) return [];
  const step = niceStep(size, 6);
  const ticks: number[] = [0];
  for (let value = step; value <= size; value += step) {
    ticks.push(value);
  }
  return ticks.map((value) => ({
    value,
    ratio: size === 0 ? 0 : value / size,
  }));
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
) {
  if (end < start) return;
  if (typeof context.save === 'function') context.save();
  context.strokeStyle = color;
  context.lineWidth = 2.25;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo((start + 0.5) * cellWidth, (start + 0.5) * cellHeight);
  context.lineTo((end + 0.5) * cellWidth, (end + 0.5) * cellHeight);
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

function mapClientToCell(
  canvas: HTMLCanvasElement,
  size: number,
  clientX: number,
  clientY: number,
) {
  const rect = canvas.getBoundingClientRect();
  const x = clamp(Math.floor(((clientX - rect.left) / rect.width) * size), 0, size - 1);
  const y = clamp(Math.floor(((clientY - rect.top) / rect.height) * size), 0, size - 1);
  return {
    x,
    y,
    localX: x,
    localY: y,
  };
}

export function PaeHeatmap(props: PaeHeatmapProps) {
  const matrixCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const pendingHoverCellRef = useRef<{ x: number; y: number } | null>(null);
  const lastHoverCellKeyRef = useRef('none');
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [frameDrag, setFrameDrag] = useState<{
    startClientX: number;
    startClientY: number;
    selection: MatrixViewport;
  } | null>(null);
  const size = props.matrix.length;
  const yAxisTicks = useMemo(() => buildAxisTicks(size), [size]);
  const yAxisLabelTicks = useMemo(() => filterAxisLabelTicks(yAxisTicks), [yAxisTicks]);
  const xAxisTicks = useMemo(() => buildRegularAxisTicks(size), [size]);
  const xAxisLabelTickValues = useMemo(() => new Set(filterXAxisTickLabels(xAxisTicks).map((tick) => tick.value)), [xAxisTicks]);
  const legendTicks = useMemo(() => buildLegendTicks(props.maxValue), [props.maxValue]);
  const activeBrush =
    dragStart && dragCurrent
      ? {
          xStart: Math.min(dragStart.x, dragCurrent.x),
          xEnd: Math.max(dragStart.x, dragCurrent.x),
          yStart: Math.min(dragStart.y, dragCurrent.y),
          yEnd: Math.max(dragStart.y, dragCurrent.y),
        }
      : props.brushSelection;
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

    const cellWidth = width / Math.max(size, 1);
    const cellHeight = height / Math.max(size, 1);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        context.fillStyle = colorForPae(props.matrix[y][x], props.maxValue);
        context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
      }
    }
  }, [props.matrix, props.maxValue, size]);

  useEffect(() => {
    if (!frameDrag) return;

    const handleMove = (event: MouseEvent) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas || size <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const cellWidth = rect.width / size;
      const cellHeight = rect.height / size;
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
      const cell = mapClientToCell(canvas, size, event.clientX, event.clientY);
      setDragCurrent({ x: cell.localX, y: cell.localY });
      props.onBrushSelectionChange({
        xStart: Math.min(dragStart.x, cell.localX),
        xEnd: Math.max(dragStart.x, cell.localX),
        yStart: Math.min(dragStart.y, cell.localY),
        yEnd: Math.max(dragStart.y, cell.localY),
      });
    };

    const handleUp = (event: MouseEvent) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const cell = mapClientToCell(canvas, size, event.clientX, event.clientY);
      const minX = Math.min(dragStart.x, cell.localX);
      const maxX = Math.max(dragStart.x, cell.localX);
      const minY = Math.min(dragStart.y, cell.localY);
      const maxY = Math.max(dragStart.y, cell.localY);
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
    const canvas = overlayCanvasRef.current;
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

    const cellWidth = width / Math.max(size, 1);
    const cellHeight = height / Math.max(size, 1);

    if (props.hoveredCell && !frameDrag) {
      if (typeof context.save === 'function') context.save();
      context.strokeStyle = '#111111';
      context.lineWidth = 1;
      if (typeof context.setLineDash === 'function') context.setLineDash([4, 4]);
      const x = props.hoveredCell.x * cellWidth;
      const y = props.hoveredCell.y * cellHeight;
      context.beginPath();
      context.moveTo(0, y + cellHeight / 2);
      context.lineTo(width, y + cellHeight / 2);
      context.moveTo(x + cellWidth / 2, 0);
      context.lineTo(x + cellWidth / 2, height);
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
    size,
  ]);

  const mapPointer = (clientX: number, clientY: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return null;
    return mapClientToCell(canvas, size, clientX, clientY);
  };

  return (
    <section className="panel heatmap-panel">
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
            <div className="heatmap-canvas-wrap">
              {props.syntheticPae && (
                <div className="heatmap-overlay-notice" aria-live="polite">
                  <strong>Empty pAE</strong>
                  <span>This model did not include predicted aligned error data.</span>
                </div>
              )}
              <canvas
                ref={matrixCanvasRef}
                className="heatmap-matrix-canvas"
                aria-hidden="true"
              />
              <canvas
                ref={overlayCanvasRef}
                className="heatmap-canvas"
                onMouseMove={(event) => {
                  if (props.interactionPerformance.suppressHoverWhileInteracting && (dragStart || frameDrag)) {
                    return;
                  }
                  const cell = mapPointer(event.clientX, event.clientY);
                  if (!cell) return;
                  scheduleHoverCell({ x: cell.x, y: cell.y });
                }}
                onMouseLeave={() => {
                  scheduleHoverCell(null);
                }}
                onMouseDown={(event) => {
                  const cell = mapPointer(event.clientX, event.clientY);
                  if (!cell) return;
                  if (props.interactionPerformance.suppressHoverWhileInteracting) {
                    scheduleHoverCell(null);
                  }
                  setDragStart({ x: cell.localX, y: cell.localY });
                  setDragCurrent({ x: cell.localX, y: cell.localY });
                }}
              />
              {props.brushSelection && size > 0 && (
                <>
                  <div
                    className={`heatmap-frame-drag-handle${frameDrag ? ' dragging' : ''}`}
                    style={{
                      left: `${(props.brushSelection.xStart / size) * 100}%`,
                      top: `${(props.brushSelection.yStart / size) * 100}%`,
                      width: `${((props.brushSelection.xEnd - props.brushSelection.xStart + 1) / size) * 100}%`,
                      height: `${((props.brushSelection.yEnd - props.brushSelection.yStart + 1) / size) * 100}%`,
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (props.interactionPerformance.suppressHoverWhileInteracting) {
                        scheduleHoverCell(null);
                      }
                      setFrameDrag({
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        selection: props.brushSelection!,
                      });
                    }}
                  />
                  {!frameDrag && (
                    <button
                      type="button"
                      className="heatmap-close-button"
                      style={{
                        left: `${((props.brushSelection.xEnd + 1) / size) * 100}%`,
                        top: `${(props.brushSelection.yStart / size) * 100}%`,
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
              {pinnedPairBounds && !activeBrush && !frameDrag && (
                <button
                  type="button"
                  className="heatmap-close-button heatmap-pair-close-button"
                  style={{
                    left: `calc(${((props.pinnedCell!.x + 0.5) / size) * 100}% + 20px)`,
                    top: `calc(${((props.pinnedCell!.y + 0.5) / size) * 100}% - 20px)`,
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
              <span className="heatmap-axis-end-label">{size}</span>
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
              <label className="switch-field">
                <span className="switch-label">pLDDT coloring</span>
                <span className="switch-control">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="pLDDT color"
                    checked={props.colorByPLDDTEnabled}
                    onChange={props.onToggleColorByPLDDT}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
