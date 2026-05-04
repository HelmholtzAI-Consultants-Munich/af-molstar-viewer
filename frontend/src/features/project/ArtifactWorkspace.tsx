import { useMemo, useState } from 'react';
import { Workspace } from '../viewer/Workspace';
import type { LoadedViewerArtifact, ViewerConfiguration } from '../../domain/project';
import { resolvePaeInteractionPerformance } from '../../lib/performance';

const PAE_HOVER_SYNC_RESIDUE_THRESHOLD = 800;

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
  onSelectionIndicesChange?: (indices: number[]) => void;
  onSelectionModeChange?: (enabled: boolean) => void;
  onFocusIndicesChange?: (indices: number[]) => void;
  onViewerStateChange?: (payload: Record<string, unknown>) => void;
}

export function ArtifactWorkspace(props: ArtifactWorkspaceProps) {
  const [hoveredResidues, setHoveredResidues] = useState<number[]>([]);
  const [pinnedResidues, setPinnedResidues] = useState<number[]>([]);
  const [pinnedCell, setPinnedCell] = useState<{ x: number; y: number } | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [brushSelection, setBrushSelection] = useState<{ xStart: number; xEnd: number; yStart: number; yEnd: number } | null>(null);
  const [paeHoverSyncEnabled, setPaeHoverSyncEnabled] = useState(
    props.artifact.bundle.residues.length <= PAE_HOVER_SYNC_RESIDUE_THRESHOLD,
  );
  const [paePairSelectionEnabled, setPaePairSelectionEnabled] = useState(true);
  const [colorByPLDDTToggleStatus, setColorByPLDDTToggleStatus] = useState(props.artifact.bundle.metadata.looksLikePLDDTs);
  const [colorByPLDDTEnabled, setColorByPLDDTEnabled] = useState(props.artifact.bundle.metadata.looksLikePLDDTs);

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
      pinnedResidues={pinnedResidues}
      pinnedCell={pinnedCell}
      hoveredCell={hoveredCell}
      brushSelection={brushSelection}
      interactionPerformance={interactionPerformance}
      paeHoverSyncEnabled={paeHoverSyncEnabled}
      paePairSelectionEnabled={paePairSelectionEnabled}
      colorByPLDDTToggleStatus={colorByPLDDTToggleStatus}
      colorByPLDDTEnabled={colorByPLDDTEnabled}
      onHoverResidues={setHoveredResidues}
      onHoverCell={setHoveredCell}
      onPinResidues={setPinnedResidues}
      onPinCell={setPinnedCell}
      onBrushSelectionChange={setBrushSelection}
      onTogglePaeHoverSync={() => {
        setPaeHoverSyncEnabled((enabled) => {
          const next = !enabled;
          if (!next) setHoveredResidues([]);
          return next;
        });
      }}
      onTogglePaePairSelection={() => {
        setPaePairSelectionEnabled((enabled) => {
          const next = !enabled;
          if (!next) {
            setPinnedCell((currentPinnedCell) => {
              if (currentPinnedCell) {
                setPinnedResidues([]);
              }
              return null;
            });
          }
          return next;
        });
      }}
      onClearPairSelection={() => {
        setPinnedCell(null);
        setPinnedResidues([]);
      }}
      onToggleColorByPLDDT={() => setColorByPLDDTToggleStatus((enabled) => !enabled)}
      onEnableColorByPLDDT={() => {
        setColorByPLDDTEnabled((enabled) => {
          const next = !enabled;
          if (!next) {
            setColorByPLDDTToggleStatus(false);
          }
          return next;
        });
      }}
      onMolstarSelectionChange={props.onSelectionIndicesChange}
      onMolstarSelectionModeChange={props.onSelectionModeChange}
      onMolstarFocusChange={props.onFocusIndicesChange}
      onViewerStateChange={props.onViewerStateChange}
    />
  );
}
