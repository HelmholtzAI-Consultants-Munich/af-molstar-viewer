import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Workspace } from '../components/Workspace';
import { createToyBundle } from './helpers';

const viewerSpy = vi.fn();

vi.mock('../components/MolstarPanel', () => ({
  MolstarPanel: (props: Record<string, unknown>) => {
    viewerSpy(props);
    return <div data-testid="molstar-panel">Molstar mock</div>;
  },
}));

function Harness() {
  const bundle = createToyBundle();
  const [hoveredResidues, setHoveredResidues] = useState<number[]>([]);
  const [pinnedResidues, setPinnedResidues] = useState<number[]>([]);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [brushSelection, setBrushSelection] = useState<{ xStart: number; xEnd: number; yStart: number; yEnd: number } | null>(null);
  const [paeHoverSyncEnabled, setPaeHoverSyncEnabled] = useState(true);

  return (
    <Workspace
      bundle={bundle}
      structureText="ATOM"
      hoveredResidues={hoveredResidues}
      pinnedResidues={pinnedResidues}
      hoveredCell={hoveredCell}
      brushSelection={brushSelection}
      paeHoverSyncEnabled={paeHoverSyncEnabled}
      onHoverResidues={setHoveredResidues}
      onHoverCell={setHoveredCell}
      onPinResidues={setPinnedResidues}
      onBrushSelectionChange={setBrushSelection}
      onTogglePaeHoverSync={() =>
        setPaeHoverSyncEnabled((value) => {
          const next = !value;
          if (!next) setHoveredResidues([]);
          return next;
        })
      }
    />
  );
}

describe('workspace interactions', () => {
  beforeEach(() => {
    viewerSpy.mockClear();
  });

  it('links PAE hover into Molstar residue hover props', () => {
    render(<Harness />);
    const heatmap = document.querySelector('.heatmap-canvas') as HTMLCanvasElement;
    Object.defineProperty(heatmap, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 300, height: 300 }),
    });

    fireEvent.mouseMove(heatmap, { clientX: 150, clientY: 0 });

    const lastCall = viewerSpy.mock.calls.at(-1)?.[0] as { hoveredResidues: number[] };
    expect(lastCall.hoveredResidues).toEqual([0, 1]);
  });

  it('stores a brush selection instead of zooming the PAE view', () => {
    render(<Harness />);

    const heatmap = document.querySelector('.heatmap-canvas') as HTMLCanvasElement;
    Object.defineProperty(heatmap, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 300, height: 300 }),
    });
    fireEvent.mouseDown(heatmap, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(heatmap, { clientX: 150, clientY: 150 });
    fireEvent.mouseUp(heatmap, { clientX: 150, clientY: 150 });

    const lastCall = viewerSpy.mock.calls.at(-1)?.[0] as { brushSelection: { xStart: number; xEnd: number; yStart: number; yEnd: number } | null };
    expect(lastCall.brushSelection).toEqual({ xStart: 0, xEnd: 1, yStart: 0, yEnd: 1 });
    expect(screen.queryByText(/Zoomed to residues/i)).not.toBeInTheDocument();
  });

  it('can disable PAE-to-Molstar hover syncing', () => {
    render(<Harness />);
    const heatmap = document.querySelector('.heatmap-canvas') as HTMLCanvasElement;
    Object.defineProperty(heatmap, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 300, height: 300 }),
    });

    fireEvent.click(screen.getAllByRole('switch', { name: /3d hover/i })[0]);
    fireEvent.mouseMove(heatmap, { clientX: 150, clientY: 0 });

    const lastCall = viewerSpy.mock.calls.at(-1)?.[0] as { hoveredResidues: number[] };
    expect(lastCall.hoveredResidues).toEqual([]);
  });
});
