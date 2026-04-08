import type {
  BinderCandidate,
  BinderValidation,
  JobRef,
  SourceStructure,
  TargetArtifact,
  ViewerStateSnapshot,
  WorkspaceProject,
} from '../../domain/project-types';

interface ProjectSidebarProps {
  project: WorkspaceProject;
  selectedTargetId: string | null;
  interfaceDraft: string;
  compareValidationIds: string[];
  busy: boolean;
  onSelectTarget: (targetId: string) => void;
  onInterfaceDraftChange: (value: string) => void;
  onSaveInterface: () => void;
  onExtractTarget: (sourceStructureId: string) => void;
  onCropTarget: () => void;
  onGenerateBinders: () => void;
  onValidateRefolding: () => void;
  onSaveViewerState: () => void;
  onToggleValidationCompare: (validationId: string) => void;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const selectedTarget = props.project.targets.find((target) => target.id === props.selectedTargetId) ?? null;
  const templateSource = props.project.source_structures.find((source) => source.chain_ids.length > 1) ?? props.project.source_structures[0] ?? null;

  return (
    <aside className="project-sidebar">
      <section className="panel project-summary-panel">
        <p className="eyebrow">Project</p>
        <h1>{props.project.name}</h1>
        <p className="lede">
          Backend-shaped workspace with canonical targets, async jobs, generated binders, refolding validations, and saved viewer states.
        </p>
      </section>

      <section className="panel project-section-panel">
        <div className="project-section-header">
          <h2>Targets</h2>
          {templateSource && (
            <button type="button" className="secondary-button" onClick={() => props.onExtractTarget(templateSource.id)} disabled={props.busy}>
              Extract from template
            </button>
          )}
        </div>
        <div className="artifact-list">
          {props.project.targets.map((target) => (
            <button
              key={target.id}
              type="button"
              className={`artifact-card${target.id === props.selectedTargetId ? ' selected' : ''}`}
              onClick={() => props.onSelectTarget(target.id)}
            >
              <strong>{target.name}</strong>
              <span>{target.provenance.replace('_', ' ')}</span>
              <span>chains: {target.chain_ids.join(', ')}</span>
            </button>
          ))}
        </div>
      </section>

      {selectedTarget && (
        <section className="panel project-section-panel">
          <div className="project-section-header">
            <h2>Target Interface</h2>
            <button type="button" className="secondary-button" onClick={props.onSaveInterface} disabled={props.busy}>
              Save
            </button>
          </div>
          <label className="stacked-field">
            <span>target_interface_residues</span>
            <input
              value={props.interfaceDraft}
              onChange={(event) => props.onInterfaceDraftChange(event.target.value)}
              placeholder="A1-10,B20-22"
            />
          </label>
          <div className="project-button-row">
            <button type="button" className="secondary-button" onClick={props.onCropTarget} disabled={props.busy}>
              Crop target
            </button>
            <button type="button" className="primary-button" onClick={props.onGenerateBinders} disabled={props.busy}>
              Generate binders
            </button>
          </div>
        </section>
      )}

      <section className="panel project-section-panel">
        <div className="project-section-header">
          <h2>Generated Binders</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={props.onValidateRefolding}
            disabled={props.busy || props.project.binder_candidates.length === 0}
          >
            Validate refolding
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

      <section className="panel project-section-panel">
        <div className="project-section-header">
          <h2>Refolding Validations</h2>
          <button type="button" className="secondary-button" onClick={props.onSaveViewerState} disabled={props.busy || !selectedTarget}>
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

      <section className="panel project-section-panel">
        <h2>Jobs</h2>
        <ul className="compact-list">
          {props.project.jobs.length === 0 ? (
            <li>No jobs running</li>
          ) : (
            props.project.jobs.map((job) => (
              <li key={job.job_id}>
                <strong>{job.job_type}</strong>
                <span>{job.status}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="panel project-section-panel">
        <h2>Saved Viewer States</h2>
        <ul className="compact-list">
          {props.project.viewer_states.length === 0 ? (
            <li>No saved states yet</li>
          ) : (
            props.project.viewer_states.map((state) => (
              <li key={state.id}>
                <strong>{state.label}</strong>
                <span>{state.artifact_id}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </aside>
  );
}
