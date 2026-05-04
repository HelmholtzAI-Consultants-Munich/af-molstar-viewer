import { useEffect, useState } from 'react';
import type { WorkspaceProject } from '../../domain/project';

interface TargetInterfaceEditorProps {
  selectedTarget: WorkspaceProject['targets'][number] | null;
  selectionDraft: string;
  busy: boolean;
  onDraftFocus?: () => void;
  onDraftChange?: (value: string) => void;
  onDraftBlur?: (value: string) => void;
  onSaveInterface: (value: string) => void;
  onGenerateBinders: (value: string) => void;
}

export function TargetInterfaceEditor(props: TargetInterfaceEditorProps) {
  const [selectionDraft, setSelectionDraft] = useState(props.selectionDraft);

  useEffect(() => {
    setSelectionDraft(props.selectionDraft);
  }, [props.selectionDraft]);

  if (!props.selectedTarget) return null;

  return (
    <section className="panel project-section-panel">
      <div className="project-section-header">
        <h2>Target Interface</h2>
        <button type="button" className="secondary-button" onClick={() => props.onSaveInterface(selectionDraft)} disabled={props.busy}>
          Save
        </button>
      </div>
      <label className="stacked-field">
        <span>selection</span>
        <input
          value={selectionDraft}
          onChange={(event) => {
            const next = event.target.value;
            setSelectionDraft(next);
            props.onDraftChange?.(next);
          }}
          onFocus={() => props.onDraftFocus?.()}
          onBlur={(event) => props.onDraftBlur?.(event.currentTarget.value)}
          placeholder="A1-10,B20-22"
        />
      </label>
      <div className="project-button-row">
        <button type="button" className="primary-button" onClick={() => props.onGenerateBinders(selectionDraft)} disabled={props.busy}>
          Generate binders
        </button>
      </div>
    </section>
  );
}
