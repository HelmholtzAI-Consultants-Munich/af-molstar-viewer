import { AF_CONFIDENCE_COLORS } from '../lib/constants';
import type { PredictionBundle } from '../lib/types';

interface LegendPanelProps {
  bundle: PredictionBundle;
}

export function LegendPanel(props: LegendPanelProps) {
  // only show the legend if the bundle has pLDDTs
  if (!props.bundle.metadata.looksLikePLDDTs) return null;

  const meanConfidence =
    props.bundle.residues.length > 0
      ? props.bundle.residues.reduce((total, residue) => total + residue.confidence, 0) / props.bundle.residues.length
      : 0;

  return (
    <aside className="panel legend-panel">
      <ul className="legend-list">
        <li>
          <span className="legend-swatch" style={{ backgroundColor: AF_CONFIDENCE_COLORS['very-high'] }} />
          Very high (pLDDT &gt; 90)
        </li>
        <li>
          <span className="legend-swatch" style={{ backgroundColor: AF_CONFIDENCE_COLORS.high }} />
          High (90 &gt; pLDDT &gt; 70)
        </li>
        <li>
          <span className="legend-swatch" style={{ backgroundColor: AF_CONFIDENCE_COLORS.low }} />
          Low (70 &gt; pLDDT &gt; 50)
        </li>
        <li>
          <span className="legend-swatch" style={{ backgroundColor: AF_CONFIDENCE_COLORS['very-low'] }} />
          Very low (pLDDT &lt; 50)
        </li>
      </ul>
      <dl className="metric-list">
        <div>
          <dt>Mean confidence</dt>
          <dd>{meanConfidence.toFixed(1)}</dd>
        </div>
      </dl>
      <div className="legend-description">
        <h3>Model Confidence (pLDDT)</h3>
        <p>
          The predicted local distance difference test (pLDDT) is a per-residue measure of local confidence
          from&nbsp;0&nbsp;to&nbsp;100.{' '}
          <strong>
            <a
              href="https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/plddt-understanding-local-confidence/"
              target="_blank"
              rel="noreferrer"
            >
              Learn more
            </a>
          </strong>
          .
        </p>
      </div>
      {props.bundle.metadata.warnings.length > 0 && (
        <div className="warning-box">
          {props.bundle.metadata.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
    </aside>
  );
}
