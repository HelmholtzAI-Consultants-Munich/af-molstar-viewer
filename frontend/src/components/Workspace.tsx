import { useEffect, useRef } from 'react';
import { PaeHeatmap } from './PaeHeatmap';
import { MolstarPanel } from './MolstarPanel';
import { LegendPanel } from './LegendPanel';
import type { PaeInteractionPerformanceSettings } from '../lib/performance';
import type { MatrixViewport, PredictionBundle } from '../lib/types';
import { summarizeResidueSelection } from '../lib/utils';

interface WorkspaceProps {
  bundle: PredictionBundle;
  structureText: string;
  selectedResidues: number[] | null;
  focusedResidues: number[] | null;
  hoveredResidues: number[];
  pinnedResidues: number[];
  pinnedCell: { x: number; y: number } | null;
  hoveredCell: { x: number; y: number } | null;
  brushSelection: MatrixViewport | null;
  interactionPerformance: PaeInteractionPerformanceSettings;
  paeHoverSyncEnabled: boolean;
  paePairSelectionEnabled: boolean;
  onHoverResidues: (indices: number[]) => void;
  onHoverCell: (cell: { x: number; y: number } | null) => void;
  onPinResidues: (indices: number[]) => void;
  onPinCell: (cell: { x: number; y: number } | null) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
  onTogglePaeHoverSync: () => void;
  onTogglePaePairSelection: () => void;
  onClearPairSelection: () => void;
  onMolstarSelectionChange?: (indices: number[]) => void;
  onMolstarFocusChange?: (indices: number[]) => void;
}

export function Workspace(props: WorkspaceProps) {
  const hoverFrameRef = useRef<number | null>(null);
  const pendingHoverResiduesRef = useRef<number[] | null>(null);
  const hoverFrameBudgetRef = useRef(0);
  const lastHoverKeyRef = useRef('');

  useEffect(() => {
    return () => {
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!props.paeHoverSyncEnabled || props.pinnedCell !== null) {
      clearPendingHoverResidues();
    }
  }, [props.paeHoverSyncEnabled, props.pinnedCell]);

  const dispatchHoverResidues = (indices: number[]) => {
    const key = indices.join(',');
    if (key === lastHoverKeyRef.current) return;
    lastHoverKeyRef.current = key;
    props.onHoverResidues(indices);
  };

  const clearPendingHoverResidues = () => {
    pendingHoverResiduesRef.current = null;
    hoverFrameBudgetRef.current = 0;
    if (hoverFrameRef.current !== null) {
      cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
  };

  const scheduleHoverResidues = (indices: number[]) => {
    if (props.interactionPerformance.molstarHoverScheduling === 'sync') {
      clearPendingHoverResidues();
      dispatchHoverResidues(indices);
      return;
    }

    pendingHoverResiduesRef.current = indices;
    if (hoverFrameRef.current !== null) return;

    hoverFrameBudgetRef.current = 0;
    const tick = () => {
      hoverFrameBudgetRef.current += 1;
      if (hoverFrameBudgetRef.current < props.interactionPerformance.molstarHoverFrameStride) {
        hoverFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const next = pendingHoverResiduesRef.current ?? [];
      pendingHoverResiduesRef.current = null;
      hoverFrameRef.current = null;
      hoverFrameBudgetRef.current = 0;
      dispatchHoverResidues(next);
    };

    hoverFrameRef.current = requestAnimationFrame(tick);
  };

  return (
    <div className="workspace-grid">
      <PaeHeatmap
        matrix={props.bundle.paeMatrix}
        maxValue={props.bundle.paeMax}
        syntheticPae={Boolean(props.bundle.metadata.syntheticPae)}
        hoveredCell={props.hoveredCell}
        pinnedResidues={props.pinnedResidues}
        pinnedCell={props.pinnedCell}
        brushSelection={props.brushSelection}
        interactionPerformance={props.interactionPerformance}
        hoverSyncEnabled={props.paeHoverSyncEnabled}
        pairSelectionEnabled={props.paePairSelectionEnabled}
        onHoverCell={(cell) => {
          props.onHoverCell(cell);
          if (props.paeHoverSyncEnabled && props.pinnedCell === null) {
            scheduleHoverResidues(cell ? summarizeResidueSelection([cell.x, cell.y]) : []);
          }
        }}
        onClickCell={(cell) => {
          clearPendingHoverResidues();
          props.onPinCell(cell);
          props.onPinResidues(summarizeResidueSelection([cell.x, cell.y]));
          props.onHoverResidues([]);
        }}
        onBrushSelectionChange={props.onBrushSelectionChange}
        onToggleHoverSync={props.onTogglePaeHoverSync}
        onTogglePairSelection={props.onTogglePaePairSelection}
        onClearPairSelection={() => {
          clearPendingHoverResidues();
          props.onClearPairSelection();
        }}
      />
      <MolstarPanel
        bundle={props.bundle}
        structureText={props.structureText}
        selectedResidues={props.selectedResidues}
        focusedResidues={props.focusedResidues}
        hoveredResidues={props.hoveredResidues}
        pinnedResidues={props.pinnedResidues}
        pinnedCell={props.pinnedCell}
        brushSelection={props.brushSelection}
        onHoverResidue={(index) => props.onHoverResidues(index === null ? [] : [index])}
        onClickResidue={(index) => {
          clearPendingHoverResidues();
          props.onPinCell(null);
        }}
        onSelectionResiduesChange={(indices) => {
          clearPendingHoverResidues();
          props.onPinCell(null);
          props.onMolstarSelectionChange?.(indices);
        }}
        onFocusResiduesChange={props.onMolstarFocusChange}
      />
      <LegendPanel bundle={props.bundle} />
    </div>
  );
}
