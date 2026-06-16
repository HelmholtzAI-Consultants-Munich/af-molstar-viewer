import { useMemo, useState } from 'react';
import { Workspace } from '../viewer/Workspace';
import type { LoadedViewerArtifact, ViewerConfiguration } from '../../domain/project';
import type { MatrixViewport } from '../../lib/types';
import { resolvePaeInteractionPerformance } from '../../lib/performance';

export const PAE_HOVER_SYNC_RESIDUE_THRESHOLD = 800;

interface ArtifactWorkspaceProps {
  artifact: LoadedViewerArtifact;
  viewerConfiguration: ViewerConfiguration;
  viewerStatePayload?: Record<string, unknown> | null;
  selectionDraft: string;
  selectionIndices: number[] | null;
  draftFocused: boolean;
  selectionEnabled: boolean;
  selectionSyncNonce?: number;
  focusIndices?: number[] | null;
  brushSelection: MatrixViewport | null;
  pinnedResidues: number[];
  pinnedCell: { x: number; y: number } | null;
  paeHoverSyncEnabled: boolean;
  paePairSelectionEnabled: boolean;
  colorByPLDDTToggleStatus: boolean;
  colorByPLDDTEnabled: boolean;
  paeDrawerOpen: boolean;
  onSelectionIndicesChange?: (indices: number[]) => void;
  onSelectionModeChange?: (enabled: boolean) => void;
  onFocusIndicesChange?: (indices: number[]) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
  onPinResidues: (indices: number[]) => void;
  onPinCell: (cell: { x: number; y: number } | null) => void;
  onTogglePaeHoverSync: () => void;
  onTogglePaePairSelection: () => void;
  onClearPairSelection: () => void;
  onToggleColorByPLDDT: () => void;
  onEnableColorByPLDDT: () => void;
  onTogglePaeDrawer: () => void;
  onImportPaeData: (paeMatrix: number[][], paeMax: number) => void;
  onViewerStateChange?: (payload: Record<string, unknown>) => void;
  onNativeViewerStateDownloadReady?: (download: (() => void) | null) => void;
}

export function ArtifactWorkspace(props: ArtifactWorkspaceProps) {
  const [hoveredResidues, setHoveredResidues] = useState<number[]>([]);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);

  const interactionPerformance = useMemo(
    () => resolvePaeInteractionPerformance(props.artifact.bundle.residues.length),
    [props.artifact.bundle.residues.length],
  );

  return (
    <Workspace
      viewerConfiguration={props.viewerConfiguration}
      viewerStatePayload={props.viewerStatePayload ?? null}
      selectionDraft={props.selectionDraft}
      bundle={props.artifact.bundle}
      structureText={props.artifact.structureText}
      selectedResidues={props.selectionIndices}
      draftFocused={props.draftFocused}
      selectionModeEnabled={props.selectionEnabled}
      selectionSyncNonce={props.selectionSyncNonce ?? 0}
      focusedResidues={props.focusIndices ?? null}
      hoveredResidues={hoveredResidues}
      pinnedResidues={props.pinnedResidues}
      pinnedCell={props.pinnedCell}
      hoveredCell={hoveredCell}
      brushSelection={props.brushSelection}
      interactionPerformance={interactionPerformance}
      paeHoverSyncEnabled={props.paeHoverSyncEnabled}
      paePairSelectionEnabled={props.paePairSelectionEnabled}
      colorByPLDDTToggleStatus={props.colorByPLDDTToggleStatus}
      colorByPLDDTEnabled={props.colorByPLDDTEnabled}
      paeDrawerOpen={props.paeDrawerOpen}
      onHoverResidues={setHoveredResidues}
      onHoverCell={setHoveredCell}
      onPinResidues={props.onPinResidues}
      onPinCell={props.onPinCell}
      onBrushSelectionChange={props.onBrushSelectionChange}
      onTogglePaeHoverSync={() => {
        props.onTogglePaeHoverSync();
        if (props.paeHoverSyncEnabled) {
          setHoveredResidues([]);
        }
      }}
      onTogglePaePairSelection={props.onTogglePaePairSelection}
      onClearPairSelection={props.onClearPairSelection}
      onToggleColorByPLDDT={props.onToggleColorByPLDDT}
      onEnableColorByPLDDT={props.onEnableColorByPLDDT}
      onTogglePaeDrawer={props.onTogglePaeDrawer}
      onImportPaeData={props.onImportPaeData}
      onMolstarSelectionChange={props.onSelectionIndicesChange}
      onMolstarSelectionModeChange={props.onSelectionModeChange}
      onMolstarFocusChange={props.onFocusIndicesChange}
      onViewerStateChange={props.onViewerStateChange}
      onNativeViewerStateDownloadReady={props.onNativeViewerStateDownloadReady}
    />
  );
}
