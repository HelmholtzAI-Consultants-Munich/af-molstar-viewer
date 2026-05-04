import type { WorkspaceProject } from '../../domain/project';

interface ValidationListProps {
  project: WorkspaceProject;
  compareValidationIds: string[];
  busy: boolean;
  canSaveViewerState: boolean;
  onSaveViewerState: () => void;
  onToggleValidationCompare: (validationId: string) => void;
}

export function ValidationList(props: ValidationListProps) {
  return (
    <section className="panel project-section-panel">
      <div className="project-section-header">
        <h2>Refolding Validations</h2>
        <button type="button" className="secondary-button" onClick={props.onSaveViewerState} disabled={props.busy || !props.canSaveViewerState}>
          Save viewer state
        </button>
      </div>
      <ul className="compact-list">
        {props.project.binder_validations.length === 0 ? (
          <li>No validations yet</li>
        ) : (
          props.project.binder_validations.map((validation) => {
            const selected = props.compareValidationIds.includes(validation.id);
            return (
              <li key={validation.id} className={selected ? 'selected-list-item' : undefined}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => props.onToggleValidationCompare(validation.id)}
                    disabled={!selected && props.compareValidationIds.length >= 2}
                  />
                  <span>{validation.name}</span>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
