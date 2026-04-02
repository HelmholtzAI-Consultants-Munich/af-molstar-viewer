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

function colorForPae(value: number, maxValue: number): string {
  const ratio = Math.min(1, Math.max(0, value / Math.max(maxValue, 1)));
  const start = { r: 13, g: 91, b: 36 };
  const end = { r: 241, g: 247, b: 239 };
  const r = Math.round(start.r + (end.r - start.r) * ratio);
  const g = Math.round(start.g + (end.g - start.g) * ratio);
  const b = Math.round(start.b + (end.b - start.b) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

export function PaeHeatmap(props: PaeHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const size = props.matrix.length;
  const pinnedSet = useMemo(() => new Set(props.pinnedResidues), [props.pinnedResidues]);

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
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Confidence map</p>
          <h2>Predicted aligned error</h2>
        </div>
        <button type="button" className="secondary-button" onClick={() => props.onBrushSelectionChange(null)}>
          Clear selection
        </button>
      </div>
      <div className="heatmap-shell">
        <div className="heatmap-axis heatmap-axis-top">
          1 - {size}
        </div>
        <div className="heatmap-axis heatmap-axis-left">
          1 - {size}
        </div>
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
      </div>
      <div className="heatmap-scale">
        <span>0 Å</span>
        <div className="heatmap-gradient" />
        <span>{props.maxValue.toFixed(1)} Å</span>
      </div>
    </section>
  );
}
