import { useEffect, useRef } from 'react';
import { PaeHeatmap } from './PaeHeatmap';
import { MolstarViewer } from './MolstarViewer';
import { LegendPanel } from './LegendPanel';
import type { ViewerConfiguration } from '../../domain/project';
import type { PaeInteractionPerformanceSettings } from '../../lib/performance';
import type { MatrixViewport, PredictionBundle } from '../../lib/types';
import { uniqueSortedNumbers } from '../../lib/utils';

interface WorkspaceProps {
  viewerConfiguration: ViewerConfiguration;
  viewerStatePayload: Record<string, unknown> | null;
  selectionDraft: string;
  bundle: PredictionBundle;
  structureText: string;
  selectedResidues: number[] | null;
  draftFocused: boolean;
  selectionModeEnabled: boolean;
  selectionSyncNonce?: number;
  focusedResidues: number[] | null;
  hoveredResidues: number[];
  pinnedResidues: number[];
  pinnedCell: { x: number; y: number } | null;
  hoveredCell: { x: number; y: number } | null;
  brushSelection: MatrixViewport | null;
  interactionPerformance: PaeInteractionPerformanceSettings;
  paeHoverSyncEnabled: boolean;
  paePairSelectionEnabled: boolean;
  colorByPLDDTToggleStatus: boolean;
  colorByPLDDTEnabled: boolean;
  onHoverResidues: (indices: number[]) => void;
  onHoverCell: (cell: { x: number; y: number } | null) => void;
  onPinResidues: (indices: number[]) => void;
  onPinCell: (cell: { x: number; y: number } | null) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
  onTogglePaeHoverSync: () => void;
  onTogglePaePairSelection: () => void;
  onClearPairSelection: () => void;
  onMolstarSelectionChange?: (indices: number[]) => void;
  onMolstarSelectionModeChange?: (enabled: boolean) => void;
  onMolstarFocusChange?: (indices: number[]) => void;
  onViewerStateChange?: (payload: Record<string, unknown>) => void;
  onToggleColorByPLDDT: () => void;
  onEnableColorByPLDDT: () => void;
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
    <div className={`workspace-grid${props.viewerConfiguration === 'target' ? ' target-workspace-grid' : ''}`}>
      <MolstarViewer
        viewerConfiguration={props.viewerConfiguration}
        viewerStatePayload={props.viewerStatePayload}
        selectionDraft={props.selectionDraft}
        bundle={props.bundle}
        structureText={props.structureText}
        selectedResidues={props.selectedResidues}
        draftFocused={props.draftFocused}
        selectionModeEnabled={props.selectionModeEnabled}
        selectionSyncNonce={props.selectionSyncNonce ?? 0}
        focusedResidues={props.focusedResidues}
        hoveredResidues={props.hoveredResidues}
        pinnedResidues={props.pinnedResidues}
        pinnedCell={props.pinnedCell}
        brushSelection={props.brushSelection}
        colorByPLDDTToggleStatus={props.colorByPLDDTToggleStatus}
        colorByPLDDTEnabled={props.colorByPLDDTEnabled}
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
        onSelectionModeChange={props.onMolstarSelectionModeChange}
        onFocusResiduesChange={props.onMolstarFocusChange}
        onViewerStateChange={props.onViewerStateChange}
      />
      {props.viewerConfiguration === 'validate_refolding' && (
        <>
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
            colorByPLDDTToggleStatus={props.colorByPLDDTToggleStatus}
            colorByPLDDTEnabled={props.colorByPLDDTEnabled}
            onHoverCell={(cell) => {
              props.onHoverCell(cell);
              if (props.paeHoverSyncEnabled && props.pinnedCell === null) {
                scheduleHoverResidues(cell ? uniqueSortedNumbers([cell.x, cell.y]) : []);
              }
            }}
            onClickCell={(cell) => {
              clearPendingHoverResidues();
              props.onPinCell(cell);
              props.onPinResidues(uniqueSortedNumbers([cell.x, cell.y]));
              props.onHoverResidues([]);
            }}
            onBrushSelectionChange={props.onBrushSelectionChange}
            onToggleHoverSync={props.onTogglePaeHoverSync}
            onTogglePairSelection={props.onTogglePaePairSelection}
            onClearPairSelection={() => {
              clearPendingHoverResidues();
              props.onClearPairSelection();
            }}
            onToggleColorByPLDDT={props.onToggleColorByPLDDT}
            onEnableColorByPLDDT={props.onEnableColorByPLDDT}
          />
          <LegendPanel bundle={props.bundle} />
        </>
      )}
    </div>
  );
}
