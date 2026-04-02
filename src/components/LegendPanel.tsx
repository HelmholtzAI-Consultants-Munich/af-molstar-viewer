import { AF_CONFIDENCE_COLORS } from '../lib/constants';
import type { PredictionBundle } from '../lib/types';

interface LegendPanelProps {
  bundle: PredictionBundle;
}

export function LegendPanel(props: LegendPanelProps) {
  return (
    <aside className="panel legend-panel">
      <div className="legend-header">Model Confidence</div>
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
      <p className="legend-copy">pLDDT is a per-residue measure of local confidence.</p>
      <dl className="metric-list">
        {Object.entries(props.bundle.summary).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value.toFixed(2)}</dd>
          </div>
        ))}
      </dl>
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
