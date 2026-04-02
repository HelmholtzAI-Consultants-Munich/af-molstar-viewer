import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatrixViewport } from '../lib/types';
import { PAE_SELECTION_COLORS } from '../lib/constants';
import { clamp } from '../lib/utils';

interface PaeHeatmapProps {
  matrix: number[][];
  maxValue: number;
  hoveredCell: { x: number; y: number } | null;
  pinnedResidues: number[];
  brushSelection: MatrixViewport | null;
  onHoverCell: (cell: { x: number; y: number } | null) => void;
  onClickCell: (cell: { x: number; y: number }) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
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

function tickAnchor(index: number, total: number) {
  if (index === 0) return 'start';
  if (index === total - 1) return 'end';
  return 'middle';
}

export function PaeHeatmap(props: PaeHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const size = props.matrix.length;
  const pinnedSet = useMemo(() => new Set(props.pinnedResidues), [props.pinnedResidues]);
  const axisTicks = useMemo(() => buildAxisTicks(size), [size]);
  const axisLabelTicks = useMemo(() => filterAxisLabelTicks(axisTicks), [axisTicks]);
  const legendTicks = useMemo(() => buildLegendTicks(props.maxValue), [props.maxValue]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientWidth;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    context.scale(window.devicePixelRatio, window.devicePixelRatio);
    context.clearRect(0, 0, width, height);

    const cellWidth = width / Math.max(size, 1);
    const cellHeight = height / Math.max(size, 1);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        context.fillStyle = colorForPae(props.matrix[y][x], props.maxValue);
        context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
      }
    }

    if (props.hoveredCell) {
      context.strokeStyle = '#fff36a';
      context.lineWidth = 2;
      const x = props.hoveredCell.x * cellWidth;
      const y = props.hoveredCell.y * cellHeight;
      context.beginPath();
      context.moveTo(0, y + cellHeight / 2);
      context.lineTo(width, y + cellHeight / 2);
      context.moveTo(x + cellWidth / 2, 0);
      context.lineTo(x + cellWidth / 2, height);
      context.stroke();
      context.strokeRect(x, y, cellWidth, cellHeight);
    }

    if (pinnedSet.size > 0) {
      const values = [...pinnedSet];
      const min = Math.min(...values);
      const max = Math.max(...values);
      context.strokeStyle = '#ff9a3c';
      context.lineWidth = 2;
      context.strokeRect(min * cellWidth, min * cellHeight, (max - min + 1) * cellWidth, (max - min + 1) * cellHeight);
    }

    const activeBrush =
      dragStart && dragCurrent
        ? {
            xStart: Math.min(dragStart.x, dragCurrent.x),
            xEnd: Math.max(dragStart.x, dragCurrent.x),
            yStart: Math.min(dragStart.y, dragCurrent.y),
            yEnd: Math.max(dragStart.y, dragCurrent.y),
          }
        : props.brushSelection;

    if (activeBrush) {
      const x = activeBrush.xStart * cellWidth;
      const y = activeBrush.yStart * cellHeight;
      const brushWidth = (activeBrush.xEnd - activeBrush.xStart + 1) * cellWidth;
      const brushHeight = (activeBrush.yEnd - activeBrush.yStart + 1) * cellHeight;

      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.strokeRect(x, y, brushWidth, brushHeight);

      const diagonal = context.createLinearGradient(x, y, x + brushWidth, y + brushHeight);
      diagonal.addColorStop(0, PAE_SELECTION_COLORS.xRange);
      diagonal.addColorStop(1, PAE_SELECTION_COLORS.yRange);
      context.strokeStyle = diagonal;
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + brushWidth, y + brushHeight);
      context.stroke();
    }
  }, [dragCurrent, dragStart, pinnedSet, props.brushSelection, props.hoveredCell, props.matrix, props.maxValue, size]);

  const mapPointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(Math.floor(((clientX - rect.left) / rect.width) * size), 0, size - 1);
    const y = clamp(Math.floor(((clientY - rect.top) / rect.height) * size), 0, size - 1);
    return {
      x,
      y,
      localX: x,
      localY: y,
    };
  };

  return (
    <section className="panel heatmap-panel">
      <div className="heatmap-chart">
        <div className="heatmap-chart-main">
          <div className="heatmap-plot-row">
            <div className="heatmap-y-label">Aligned residue</div>
            <div className="heatmap-y-ticks" aria-hidden="true">
              {axisLabelTicks.map((tick, index) => {
                const anchor = tickAnchor(index, axisLabelTicks.length);
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
            <div className="heatmap-plot-column">
              <canvas
                ref={canvasRef}
                className="heatmap-canvas"
                onMouseMove={(event) => {
                  const cell = mapPointer(event.clientX, event.clientY);
                  if (!cell) return;
                  props.onHoverCell({ x: cell.x, y: cell.y });
                  if (dragStart) {
                    setDragCurrent({ x: cell.localX, y: cell.localY });
                    props.onBrushSelectionChange({
                      xStart: Math.min(dragStart.x, cell.localX),
                      xEnd: Math.max(dragStart.x, cell.localX),
                      yStart: Math.min(dragStart.y, cell.localY),
                      yEnd: Math.max(dragStart.y, cell.localY),
                    });
                  }
                }}
                onMouseLeave={() => {
                  props.onHoverCell(null);
                }}
                onMouseDown={(event) => {
                  const cell = mapPointer(event.clientX, event.clientY);
                  if (!cell) return;
                  setDragStart({ x: cell.localX, y: cell.localY });
                  setDragCurrent({ x: cell.localX, y: cell.localY });
                }}
                onMouseUp={(event) => {
                  const cell = mapPointer(event.clientX, event.clientY);
                  if (!cell || !dragStart) return;
                  const minX = Math.min(dragStart.x, cell.localX);
                  const maxX = Math.max(dragStart.x, cell.localX);
                  const minY = Math.min(dragStart.y, cell.localY);
                  const maxY = Math.max(dragStart.y, cell.localY);
                  if (maxX === minX && maxY === minY) {
                    props.onClickCell({ x: cell.x, y: cell.y });
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
                }}
              />
              <div className="heatmap-x-ticks" aria-hidden="true">
                {axisLabelTicks.map((tick, index) => {
                  const anchor = tickAnchor(index, axisLabelTicks.length);
                  return (
                    <span
                      key={`x-${tick.value}`}
                      className={`heatmap-tick heatmap-tick-${anchor}`}
                      style={{ left: `${tick.ratio * 100}%` }}
                    >
                      {tick.value}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="heatmap-x-label">Scored residue</div>
          <div className="heatmap-colorbar-row">
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
                      {tick.value}
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
                pAE measures the confidence in the relative position of two residues -{' '}
                <strong>
                  see{' '}
                  <a
                    href="https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/pae-a-measure-of-global-confidence-in-alphafold-predictions/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    guides
                  </a>
                </strong>{' '}
                for more information.
              </p>
            </div>
            <div className="heatmap-actions">
              <button type="button" className="secondary-button" onClick={() => props.onBrushSelectionChange(null)}>
                Clear selection
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
