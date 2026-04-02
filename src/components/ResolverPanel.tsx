import { useEffect, useMemo, useState } from 'react';
import type { BundleChoice, DiscoveryGroup } from '../lib/types';

interface ResolverPanelProps {
  groups: DiscoveryGroup[];
  onResolve: (groupId: string, choice: BundleChoice) => Promise<void>;
  loading: boolean;
}

export function ResolverPanel(props: ResolverPanelProps) {
  const initialChoiceState = useMemo(
    () =>
      Object.fromEntries(
        props.groups.map((group) => [
          group.id,
          {
            structure: group.structureOptions[0] ?? '',
            paeJson: group.paeJsonOptions[0] ?? '',
            scoreJson: group.scoreJsonOptions[0] ?? '',
            confidenceJson: group.confidenceJsonOptions[0] ?? '',
            summaryJson: group.summaryJsonOptions[0] ?? '',
          },
        ]),
      ) as Record<string, BundleChoice>,
    [props.groups],
  );
  const [choices, setChoices] = useState<Record<string, BundleChoice>>(initialChoiceState);

  useEffect(() => {
    setChoices(initialChoiceState);
  }, [initialChoiceState]);

  if (props.groups.length === 0) return null;

  return (
    <section className="panel resolver-panel">
      <div className="resolver-header">
        <h2>Resolver: Ambiguous bundle matches</h2>
      </div>
      <div className="resolver-grid">
        {props.groups.map((group) => {
          const choice = choices[group.id] ?? initialChoiceState[group.id];
          const updateChoice = (field: keyof BundleChoice, value: string) =>
            setChoices((current) => ({ ...current, [group.id]: { ...current[group.id], [field]: value } }));
          return (
            <article key={group.id} className="resolver-card">
              <h3>{group.name}</h3>
              {group.reasons.length > 0 && <p className="resolver-reason">{group.reasons.join(' · ')}</p>}
              {group.structureOptions.length > 0 && (
                <label>
                  Structure
                  <select value={choice.structure ?? ''} onChange={(event) => updateChoice('structure', event.target.value)}>
                    {group.structureOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {group.paeJsonOptions.length > 0 && (
                <label>
                  AF2 PAE JSON
                  <select value={choice.paeJson ?? ''} onChange={(event) => updateChoice('paeJson', event.target.value)}>
                    {group.paeJsonOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {group.scoreJsonOptions.length > 0 && (
                <label>
                  ColabFold scores
                  <select value={choice.scoreJson ?? ''} onChange={(event) => updateChoice('scoreJson', event.target.value)}>
                    {group.scoreJsonOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {group.confidenceJsonOptions.length > 0 && (
                <label>
                  AF3 confidences
                  <select value={choice.confidenceJson ?? ''} onChange={(event) => updateChoice('confidenceJson', event.target.value)}>
                    {group.confidenceJsonOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {group.summaryJsonOptions.length > 0 && (
                <label>
                  AF3 summary
                  <select value={choice.summaryJson ?? ''} onChange={(event) => updateChoice('summaryJson', event.target.value)}>
                    {group.summaryJsonOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className="secondary-button" disabled={props.loading} onClick={() => void props.onResolve(group.id, choice)}>
                Resolve and load
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
