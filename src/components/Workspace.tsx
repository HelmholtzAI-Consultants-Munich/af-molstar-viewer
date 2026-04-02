import { PaeHeatmap } from './PaeHeatmap';
import { MolstarPanel } from './MolstarPanel';
import { LegendPanel } from './LegendPanel';
import type { MatrixViewport, PredictionBundle } from '../lib/types';
import { summarizeResidueSelection } from '../lib/utils';

interface WorkspaceProps {
  bundle: PredictionBundle;
  structureText: string;
  hoveredResidues: number[];
  pinnedResidues: number[];
  pinnedCell: { x: number; y: number } | null;
  hoveredCell: { x: number; y: number } | null;
  brushSelection: MatrixViewport | null;
  paeHoverSyncEnabled: boolean;
  paePairSelectionEnabled: boolean;
  onHoverResidues: (indices: number[]) => void;
  onHoverCell: (cell: { x: number; y: number } | null) => void;
  onPinResidues: (indices: number[]) => void;
  onPinCell: (cell: { x: number; y: number } | null) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
  onTogglePaeHoverSync: () => void;
  onTogglePaePairSelection: () => void;
}

export function Workspace(props: WorkspaceProps) {
  return (
    <div className="workspace-grid">
      <PaeHeatmap
        matrix={props.bundle.paeMatrix}
        maxValue={props.bundle.paeMax}
        hoveredCell={props.hoveredCell}
        pinnedResidues={props.pinnedResidues}
        pinnedCell={props.pinnedCell}
        brushSelection={props.brushSelection}
        hoverSyncEnabled={props.paeHoverSyncEnabled}
        pairSelectionEnabled={props.paePairSelectionEnabled}
        onHoverCell={(cell) => {
          props.onHoverCell(cell);
          if (props.paeHoverSyncEnabled) {
            props.onHoverResidues(cell ? summarizeResidueSelection([cell.x, cell.y]) : []);
          }
        }}
        onClickCell={(cell) => {
          props.onPinCell(cell);
          props.onPinResidues(summarizeResidueSelection([cell.x, cell.y]));
        }}
        onBrushSelectionChange={props.onBrushSelectionChange}
        onToggleHoverSync={props.onTogglePaeHoverSync}
        onTogglePairSelection={props.onTogglePaePairSelection}
      />
      <MolstarPanel
        bundle={props.bundle}
        structureText={props.structureText}
        hoveredResidues={props.hoveredResidues}
        pinnedResidues={props.pinnedResidues}
        brushSelection={props.brushSelection}
        onHoverResidue={(index) => props.onHoverResidues(index === null ? [] : [index])}
        onClickResidue={(index) => {
          props.onPinCell(null);
          if (index !== null) props.onPinResidues([index]);
        }}
      />
      <LegendPanel bundle={props.bundle} />
    </div>
  );
}
