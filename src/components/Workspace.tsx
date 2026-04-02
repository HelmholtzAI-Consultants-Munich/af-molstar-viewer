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
  hoveredCell: { x: number; y: number } | null;
  brushSelection: MatrixViewport | null;
  paeHoverSyncEnabled: boolean;
  onHoverResidues: (indices: number[]) => void;
  onHoverCell: (cell: { x: number; y: number } | null) => void;
  onPinResidues: (indices: number[]) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
  onTogglePaeHoverSync: () => void;
}

export function Workspace(props: WorkspaceProps) {
  return (
    <div className="workspace-grid">
      <PaeHeatmap
        matrix={props.bundle.paeMatrix}
        maxValue={props.bundle.paeMax}
        hoveredCell={props.hoveredCell}
        pinnedResidues={props.pinnedResidues}
        brushSelection={props.brushSelection}
        hoverSyncEnabled={props.paeHoverSyncEnabled}
        onHoverCell={(cell) => {
          props.onHoverCell(cell);
          if (props.paeHoverSyncEnabled) {
            props.onHoverResidues(cell ? summarizeResidueSelection([cell.x, cell.y]) : []);
          }
        }}
        onClickCell={(cell) => props.onPinResidues(summarizeResidueSelection([cell.x, cell.y]))}
        onBrushSelectionChange={props.onBrushSelectionChange}
        onToggleHoverSync={props.onTogglePaeHoverSync}
      />
      <MolstarPanel
        bundle={props.bundle}
        structureText={props.structureText}
        hoveredResidues={props.hoveredResidues}
        pinnedResidues={props.pinnedResidues}
        brushSelection={props.brushSelection}
        onHoverResidue={(index) => props.onHoverResidues(index === null ? [] : [index])}
        onClickResidue={(index) => {
          if (index !== null) props.onPinResidues([index]);
        }}
      />
      <LegendPanel bundle={props.bundle} />
    </div>
  );
}
