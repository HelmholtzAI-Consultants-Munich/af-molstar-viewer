import type { WorkspaceProject } from '../../domain/project';
import { BinderList } from './BinderList';
import { JobList } from './JobList';
import { SavedViewerStates } from './SavedViewerStates';
import { TargetInterfaceEditor } from './TargetInterfaceEditor';
import { TargetList } from './TargetList';
import { ValidationList } from './ValidationList';

interface ProjectSidebarProps {
  project: WorkspaceProject;
  selectedTargetId: string | null;
  focusDisplayString: string;
  selectionDisplayString: string;
  hasActiveSelection: boolean;
  selectionDraft: string;
  compareValidationIds: string[];
  busy: boolean;
  onUploadTargetFiles: (files: File[]) => Promise<void>;
  onLoadExample: (exampleId: string) => Promise<void>;
  onSelectTarget: (targetId: string) => void;
  onRemoveTarget: (targetId: string) => void | Promise<void>;
  onCropToSelection: () => void;
  onCutOffSelection: () => void;
  onDraftFocus?: () => void;
  onDraftChange?: (value: string) => void;
  onDraftBlur?: (value: string) => void;
  onSaveInterface: (value: string) => void;
  onGenerateBinders: (selectionDraft: string) => void;
  onValidateRefolding: () => void;
  onSaveViewerState: () => void;
  onToggleValidationCompare: (validationId: string) => void;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const selectedTarget = props.project.targets.find((target) => target.id === props.selectedTargetId) ?? null;

  return (
    <aside className="project-sidebar">
      <section className="panel project-summary-panel">
        <p className="eyebrow">Project</p>
        <h1>{props.project.name}</h1>
        <p className="lede">
          Backend-shaped workspace with canonical targets, async jobs, generated binders, refolding validations, and saved viewer states.
        </p>
      </section>

      <TargetList
        project={props.project}
        selectedTargetId={props.selectedTargetId}
        focusDisplayString={props.focusDisplayString}
        selectionDisplayString={props.selectionDisplayString}
        hasActiveSelection={props.hasActiveSelection}
        busy={props.busy}
        onUploadTargetFiles={props.onUploadTargetFiles}
        onLoadExample={props.onLoadExample}
        onSelectTarget={props.onSelectTarget}
        onRemoveTarget={(targetId) => {
          void props.onRemoveTarget(targetId);
        }}
        onCropToSelection={props.onCropToSelection}
        onCutOffSelection={props.onCutOffSelection}
      />

      <TargetInterfaceEditor
        selectedTarget={selectedTarget}
        selectionDraft={props.selectionDraft}
        busy={props.busy}
        onDraftFocus={props.onDraftFocus}
        onDraftChange={props.onDraftChange}
        onDraftBlur={props.onDraftBlur}
        onSaveInterface={props.onSaveInterface}
        onGenerateBinders={props.onGenerateBinders}
      />

      <BinderList project={props.project} busy={props.busy} onValidateRefolding={props.onValidateRefolding} />

      <ValidationList
        project={props.project}
        compareValidationIds={props.compareValidationIds}
        busy={props.busy}
        canSaveViewerState={selectedTarget !== null}
        onSaveViewerState={props.onSaveViewerState}
        onToggleValidationCompare={props.onToggleValidationCompare}
      />

      <JobList project={props.project} />

      <SavedViewerStates project={props.project} />
    </aside>
  );
}
