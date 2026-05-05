import type { ChangeEvent, DragEvent } from 'react';
import { useRef, useState } from 'react';
import { Crop, Scissors, Trash2, View, Save } from 'lucide-react';
import { EXAMPLES } from '../import/examples';
import type { WorkspaceProject } from '../../domain/project';

interface TargetListProps {
  project: WorkspaceProject;
  selectedTargetId: string | null;
  focusDisplayString: string;
  selectionDisplayString: string;
  hasActiveSelection: boolean;
  busy: boolean;
  onUploadTargetFiles: (files: File[]) => Promise<void>;
  onLoadExample: (exampleId: string) => Promise<void>;
  onSelectTarget: (targetId: string) => void;
  onRemoveTarget: (targetId: string) => void;
  onCropToSelection: () => void;
  onCutOffSelection: () => void;
  onDownloadStructure: () => void;
  onDownloadViewerState: () => void;
}

export function TargetList(props: TargetListProps) {
  const targetInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingTargetFiles, setIsDraggingTargetFiles] = useState(false);

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
                      <span className="artifact-card-focus">{props.focusDisplayString}</span>
                    </div>
                    <div className="artifact-card-detail-row">
                      <span className="artifact-card-selection">{props.selectionDisplayString}</span>
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
              {target.id === props.selectedTargetId && (
                <div className="artifact-card-download-actions">
                  <button
                    type="button"
                    className="artifact-card-tool"
                    aria-label="download structure"
                    title="download structure"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onDownloadStructure();
                    }}
                  >
                    <Save size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="artifact-card-tool"
                    aria-label="download Mol* session"
                    title="download Mol* session"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onDownloadViewerState();
                    }}
                  >
                    <View size={14} aria-hidden="true" />
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
  );
}
