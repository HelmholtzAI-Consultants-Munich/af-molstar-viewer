import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PaeHeatmap } from '../components/PaeHeatmap';
import { PAE_MOLSTAR_SELECTION_STYLE } from '../lib/constants';
import { SYNC_PAE_INTERACTION_PERFORMANCE } from '../lib/performance';

const SIZE = 10;
const CANVAS_SIZE = 100;
const CELL = CANVAS_SIZE / SIZE;
const GUIDE_STROKE = PAE_MOLSTAR_SELECTION_STYLE.guide.stroke;

interface StrokedRect {
  strokeStyle: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StrokedSegment {
  strokeStyle: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

// The overlay effect bails out when the canvas has no layout size, which jsdom never gives it,
// so the canvas is stubbed with a real size and a context that records what gets stroked.
function stubCanvas(strokedRects: StrokedRect[], strokedSegments: StrokedSegment[]) {
  let penPosition = { x: 0, y: 0 };
  const context = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    scale: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    strokeRect: (x: number, y: number, width: number, height: number) => {
      strokedRects.push({ strokeStyle: context.strokeStyle, x, y, width, height });
    },
    beginPath: () => undefined,
    moveTo: (x: number, y: number) => {
      penPosition = { x, y };
    },
    lineTo: (x: number, y: number) => {
      strokedSegments.push({ strokeStyle: context.strokeStyle, from: penPosition, to: { x, y } });
      penPosition = { x, y };
    },
    stroke: () => undefined,
    fillText: () => undefined,
    setLineDash: () => undefined,
  };

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => context, configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { value: CANVAS_SIZE, configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { value: CANVAS_SIZE, configurable: true });
}

function renderHeatmap(selectedResidues: number[]) {
  const matrix = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 5));
  return render(
    <PaeHeatmap
      matrix={matrix}
      maxValue={30}
      syntheticPae={false}
      hoveredCell={null}
      pinnedResidues={[]}
      pinnedCell={null}
      selectedResidues={selectedResidues}
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
    />,
  );
}

describe('pAE Mol* selection overlay', () => {
  let strokedRects: StrokedRect[];
  let strokedSegments: StrokedSegment[];
  const originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')!;

  beforeEach(() => {
    strokedRects = [];
    strokedSegments = [];
    stubCanvas(strokedRects, strokedSegments);
  });

  afterEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext);
  });

  const diagonals = () => strokedRects.filter((rect) => rect.strokeStyle === PAE_MOLSTAR_SELECTION_STYLE.diagonal.stroke);
  const crossBlocks = () => strokedRects.filter((rect) => rect.strokeStyle === PAE_MOLSTAR_SELECTION_STYLE.crossBlock.stroke);
  const guides = () => strokedSegments.filter((segment) => segment.strokeStyle === PAE_MOLSTAR_SELECTION_STYLE.guide.stroke);

  it('draws nothing when no residues are selected', () => {
    renderHeatmap([]);

    expect(diagonals()).toEqual([]);
    expect(crossBlocks()).toEqual([]);
  });

  it('draws one square on the diagonal for a single stretch, with no blocks or guides', () => {
    renderHeatmap([1, 2, 3]);

    expect(diagonals()).toMatchObject([{ x: 1 * CELL, y: 1 * CELL, width: 3 * CELL, height: 3 * CELL }]);
    expect(crossBlocks()).toEqual([]);
    expect(guides()).toEqual([]);
  });

  it('adds the off-diagonal blocks between two disjoint stretches', () => {
    renderHeatmap([1, 2, 3, 6, 7]);

    expect(diagonals()).toMatchObject([
      { x: 1 * CELL, y: 1 * CELL, width: 3 * CELL, height: 3 * CELL },
      { x: 6 * CELL, y: 6 * CELL, width: 2 * CELL, height: 2 * CELL },
    ]);
    expect(crossBlocks()).toMatchObject([
      { x: 6 * CELL, y: 1 * CELL, width: 2 * CELL, height: 3 * CELL },
      { x: 1 * CELL, y: 6 * CELL, width: 3 * CELL, height: 2 * CELL },
    ]);
  });

  it('runs guides from each diagonal square along to its off-diagonal blocks', () => {
    renderHeatmap([1, 2, 3, 6, 7]);

    // Stretch A spans cells 1-3, stretch B spans 6-7. Each block gets two guides along its rows,
    // back to the square owning those rows, and two along its columns, on to the square owning those.
    expect(guides()).toEqual([
      // upper-right block (x in B, y in A), rows back to square A
      { strokeStyle: GUIDE_STROKE, from: { x: 4 * CELL, y: 1 * CELL }, to: { x: 6 * CELL, y: 1 * CELL } },
      { strokeStyle: GUIDE_STROKE, from: { x: 4 * CELL, y: 4 * CELL }, to: { x: 6 * CELL, y: 4 * CELL } },
      // ... and columns on to square B
      { strokeStyle: GUIDE_STROKE, from: { x: 6 * CELL, y: 4 * CELL }, to: { x: 6 * CELL, y: 6 * CELL } },
      { strokeStyle: GUIDE_STROKE, from: { x: 8 * CELL, y: 4 * CELL }, to: { x: 8 * CELL, y: 6 * CELL } },
      // lower-left block (x in A, y in B), mirrored
      { strokeStyle: GUIDE_STROKE, from: { x: 6 * CELL, y: 6 * CELL }, to: { x: 4 * CELL, y: 6 * CELL } },
      { strokeStyle: GUIDE_STROKE, from: { x: 6 * CELL, y: 8 * CELL }, to: { x: 4 * CELL, y: 8 * CELL } },
      { strokeStyle: GUIDE_STROKE, from: { x: 1 * CELL, y: 6 * CELL }, to: { x: 1 * CELL, y: 4 * CELL } },
      { strokeStyle: GUIDE_STROKE, from: { x: 4 * CELL, y: 6 * CELL }, to: { x: 4 * CELL, y: 4 * CELL } },
    ]);
  });

  it('still draws blocks and guides just under the cap', () => {
    // 4 stretches -> 12 cross blocks.
    renderHeatmap([0, 2, 4, 6]);

    expect(diagonals()).toHaveLength(4);
    expect(crossBlocks()).toHaveLength(12);
    expect(guides()).toHaveLength(48);
  });

  it('drops to diagonal squares only once the blocks would reach the cap', () => {
    // 5 stretches -> 20 cross blocks, which is the cap.
    renderHeatmap([0, 2, 4, 6, 8]);

    expect(diagonals()).toHaveLength(5);
    expect(crossBlocks()).toEqual([]);
    expect(guides()).toEqual([]);
  });

  it('ignores residue indices that have no row in the matrix', () => {
    renderHeatmap([8, 9, 10, 11]);

    expect(diagonals()).toMatchObject([{ x: 8 * CELL, y: 8 * CELL, width: 2 * CELL, height: 2 * CELL }]);
  });
});
