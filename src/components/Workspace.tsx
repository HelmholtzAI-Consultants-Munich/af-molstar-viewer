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
  onHoverResidues: (indices: number[]) => void;
  onHoverCell: (cell: { x: number; y: number } | null) => void;
  onPinResidues: (indices: number[]) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
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
        onHoverCell={(cell) => {
          props.onHoverCell(cell);
          props.onHoverResidues(cell ? summarizeResidueSelection([cell.x, cell.y]) : []);
        }}
        onClickCell={(cell) => props.onPinResidues(summarizeResidueSelection([cell.x, cell.y]))}
        onBrushSelectionChange={props.onBrushSelectionChange}
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
