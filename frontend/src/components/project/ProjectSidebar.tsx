import type { ChangeEvent, DragEvent } from 'react';
import { useRef, useState } from 'react';
import { Crop, Scissors, Trash2 } from 'lucide-react';
import { EXAMPLES } from '../../app/examples';
import type { WorkspaceProject } from '../../domain/project-types';

interface ProjectSidebarProps {
  project: WorkspaceProject;
  selectedTargetId: string | null;
  selectedTargetMolstarFocus: string;
  selectedTargetMolstarSelection: string;
  hasActiveSelection: boolean;
  interfaceDraft: string;
  compareValidationIds: string[];
  busy: boolean;
  onUploadTargetFiles: (files: File[]) => Promise<void>;
  onLoadExample: (exampleId: string) => Promise<void>;
  onSelectTarget: (targetId: string) => void;
  onRemoveTarget: (targetId: string) => void;
  onCropToSelection: () => void;
  onCutOffSelection: () => void;
  onInterfaceDraftFocus?: () => void;
  onInterfaceDraftBlur?: () => void;
  onSaveInterface: () => void;
  onGenerateBinders: () => void;
  onValidateRefolding: () => void;
  onSaveViewerState: () => void;
  onToggleValidationCompare: (validationId: string) => void;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const targetInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingTargetFiles, setIsDraggingTargetFiles] = useState(false);
  const selectedTarget = props.project.targets.find((target) => target.id === props.selectedTargetId) ?? null;

  const handleTargetFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? [...event.target.files] : [];
    if (files.length > 0) {
      await props.onUploadTargetFiles(files);
    }
    event.target.value = '';
  };

  const handleTargetDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDraggingTargetFiles(false);
    const files = [...event.dataTransfer.files];
    if (files.length > 0) {
      await props.onUploadTargetFiles(files);
    }
  };

  return (
    <aside className="project-sidebar">
      <section className="panel project-summary-panel">
        <p className="eyebrow">Project</p>
        <h1>{props.project.name}</h1>
        <p className="lede">
          Backend-shaped workspace with canonical targets, async jobs, generated binders, refolding validations, and saved viewer states.
        </p>
      </section>

      <section
        className={`panel project-section-panel target-panel${isDraggingTargetFiles ? ' dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDraggingTargetFiles(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setIsDraggingTargetFiles(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          void handleTargetDrop(event);
        }}
      >
        <div className="project-section-header">
          <h2>Targets</h2>
          <div className="project-section-actions target-section-actions">
            <div className="target-primary-actions">
              <button type="button" className="secondary-button" onClick={() => targetInputRef.current?.click()} disabled={props.busy}>
                upload
              </button>
              <label className="target-example-select-shell">
                <span className="sr-only">Load target example</span>
                <select
                  aria-label="Load target example"
                  className="select-input target-example-select"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) void props.onLoadExample(event.target.value);
                    event.target.value = '';
                  }}
                >
                  <option value="" disabled>
                    example
                  </option>
                  {EXAMPLES.map((example) => (
                    <option key={example.id} value={example.id}>
                      {example.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
        <div className="artifact-list">
          {props.project.targets.length === 0 ? (
            <div className="artifact-empty-state">
              <strong>No targets yet</strong>
              <span>Upload a structure file, or drag files anywhere into this panel to create the first target.</span>
            </div>
          ) : (
            props.project.targets.map((target) => (
              <div
                key={target.id}
                className={`artifact-card-shell${target.id === props.selectedTargetId ? ' selected' : ''}`}
              >
                <button
                  type="button"
                  className={`artifact-card${target.id === props.selectedTargetId ? ' selected' : ''}`}
                  onClick={() => props.onSelectTarget(target.id)}
                >
                  <strong>{target.name}</strong>
                  {target.id === props.selectedTargetId && (
                    <div className="artifact-card-details">
                      <div className="artifact-card-detail-row">
                        <span>{target.provenance.replace('_', ' ')}, chains: {target.chain_ids.join(', ')}</span>
                      </div>
                      <div className="artifact-card-detail-row">
                        <span className="artifact-card-selection">Focus: {props.selectedTargetMolstarFocus}</span>
                      </div>
                      <div className="artifact-card-detail-row">
                        <span className="artifact-card-selection">Selection: {props.selectedTargetMolstarSelection}</span>
                      </div>
                    </div>
                  )}
                </button>
                {target.id === props.selectedTargetId && (
                  <div className="artifact-card-tools">
                    <button
                      type="button"
                      className="artifact-card-tool"
                      aria-label={`Remove ${target.name}`}
                      title={`Remove ${target.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onRemoveTarget(target.id);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="artifact-card-tool"
                      aria-label="Crop to selection"
                      title="crop to selection"
                      disabled={!props.hasActiveSelection}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onCropToSelection();
                      }}
                    >
                      <Crop size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="artifact-card-tool"
                      aria-label="Cut off selection"
                      title="cut off selection"
                      disabled={!props.hasActiveSelection}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onCutOffSelection();
                      }}
                    >
                      <Scissors size={14} aria-hidden="true" />
                    </button>
                  </div>
                )}
                {target.id !== props.selectedTargetId && (
                  <button
                    type="button"
                    className="artifact-card-tool artifact-card-remove artifact-card-remove-floating"
                    aria-label={`Remove ${target.name}`}
                    title={`Remove ${target.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onRemoveTarget(target.id);
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
        <input
          ref={targetInputRef}
          hidden
          multiple
          type="file"
          accept=".pdb,.cif,.mmcif,.json"
          onChange={(event) => {
            void handleTargetFileInput(event);
          }}
        />
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
            <span>selection</span>
            <input
              value={props.interfaceDraft}
              onFocus={() => props.onInterfaceDraftFocus?.()}
              onBlur={() => props.onInterfaceDraftBlur?.()}
              placeholder="A1-10,B20-22"
            />
          </label>
          <div className="project-button-row">
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
