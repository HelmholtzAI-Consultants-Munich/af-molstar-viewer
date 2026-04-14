import { useMemo, useState } from 'react';
import { Workspace } from '../Workspace';
import type { LoadedViewerArtifact } from '../../domain/project-types';
import { resolvePaeInteractionPerformance } from '../../lib/performance';

const PAE_HOVER_SYNC_RESIDUE_THRESHOLD = 800;

interface ArtifactWorkspaceProps {
  artifact: LoadedViewerArtifact;
  selectedResidues: number[] | null;
  focusedResidues?: number[] | null;
  onSelectionResiduesChange?: (indices: number[]) => void;
  onFocusResiduesChange?: (indices: number[]) => void;
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

  const interactionPerformance = useMemo(
    () => resolvePaeInteractionPerformance(props.artifact.bundle.residues.length),
    [props.artifact.bundle.residues.length],
  );

  return (
    <Workspace
      bundle={props.artifact.bundle}
      structureText={props.artifact.structureText}
      selectedResidues={props.selectedResidues}
      focusedResidues={props.focusedResidues ?? null}
      hoveredResidues={hoveredResidues}
      pinnedResidues={pinnedResidues}
      pinnedCell={pinnedCell}
      hoveredCell={hoveredCell}
      brushSelection={brushSelection}
      interactionPerformance={interactionPerformance}
      paeHoverSyncEnabled={paeHoverSyncEnabled}
      paePairSelectionEnabled={paePairSelectionEnabled}
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
      onMolstarSelectionChange={props.onSelectionResiduesChange}
      onMolstarFocusChange={props.onFocusResiduesChange}
    />
  );
}
