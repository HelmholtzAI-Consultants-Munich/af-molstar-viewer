import type { WorkspaceProject } from '../../domain/project';
import { Origami } from 'lucide-react';

interface BinderListProps {
  project: WorkspaceProject;
  busy: boolean;
  onValidateRefolding: () => void;
}

export function BinderList(props: BinderListProps) {
  return (
    <section className="panel project-section-panel">
      <div className="project-section-header">
        <h2>Generated Binders</h2>
        <button 
          type="button" 
          className="secondary-button target-section-actions" 
          aria-label={"re-fold in isolation"}
          title={"re-fold in isolation"}
          onClick={props.onValidateRefolding} 
          disabled={props.busy || props.project.binder_candidates.length === 0}>
          <Origami size={14} aria-hidden="true" /> 
        </button>
      </div>
      <ul className="compact-list">
        {props.project.binder_candidates.length === 0 ? (
          <li>No binder candidates yet</li>
        ) : (
          props.project.binder_candidates.map((candidate) => (
            <li key={candidate.id}>
              <strong>{candidate.name}</strong>
              <span>{candidate.id}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
