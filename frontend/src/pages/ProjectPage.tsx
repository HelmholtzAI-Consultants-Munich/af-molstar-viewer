import { useProjectWorkspace } from '../features/project/useProjectWorkspace';
import { ProjectSidebar } from '../features/project/ProjectSidebar';
import { ArtifactWorkspace } from '../features/project/ArtifactWorkspace';
import { getLatestViewerState } from '../features/viewer/viewer-state';
import type { ProjectApi } from '../services/project/project-api';

interface ProjectPageProps {
  api?: ProjectApi;
}

export function ProjectPage(props: ProjectPageProps) {
  const workspace = useProjectWorkspace({ api: props.api });

  if (workspace.loading) {
    return (
      <main className="app-shell">
        <section className="panel empty-panel">
          <h2>Loading project workspace…</h2>
        </section>
      </main>
    );
  }

  if (!workspace.project) {
    return (
      <main className="app-shell">
        <section className="panel empty-panel">
          <h2>Project unavailable</h2>
          <p>{workspace.error ?? 'Unable to start the project workspace.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell app-shell-project">
      {workspace.error && <div className="panel error-panel">{workspace.error}</div>}

      <div className="project-layout">
        <ProjectSidebar
          project={workspace.project}
          selectedTargetId={workspace.selectedTargetId}
          focusDisplayString={workspace.focusDisplayString}
          selectionDisplayString={workspace.selectionDisplayString}
          hasActiveSelection={workspace.hasActiveSelection}
          selectionDraft={workspace.selectionDraft}
          compareValidationIds={workspace.compareValidationIds}
          busy={workspace.busy}
          onUploadTargetFiles={workspace.onUploadTargetFiles}
          onLoadExample={workspace.onLoadExample}
          onSelectTarget={workspace.onSelectTarget}
          onRemoveTarget={(targetId) => {
            void workspace.onRemoveTarget(targetId);
          }}
          onCropToSelection={workspace.onCropToSelection}
          onCutOffSelection={workspace.onCutOffSelection}
          onDownloadStructure={workspace.onDownloadStructure}
          onDownloadViewerState={workspace.onDownloadViewerState}
          onDraftFocus={workspace.onDraftFocus}
          onDraftChange={workspace.onDraftChange}
          onDraftBlur={workspace.onDraftBlur}
          onSaveInterface={workspace.onSaveInterface}
          onGenerateBinders={workspace.onGenerateBinders}
          onValidateRefolding={workspace.onValidateRefolding}
          onSaveViewerState={() => {
            void workspace.onSaveViewerState();
          }}
          onToggleValidationCompare={workspace.onToggleValidationCompare}
        />

        <section className="project-main">
          <section className="panel viewer-context-panel">
            <div className="project-section-header">
              <div>
                <p className="eyebrow">Selected target</p>
                <h2>{workspace.selectedTarget?.name ?? 'No target selected'}</h2>
              </div>
              {workspace.selectedTarget && (
                <div className="viewer-context-meta">
                  <span>{workspace.selectedTarget.provenance.replace('_', ' ')}</span>
                  <span>{workspace.selectedTarget.selection}</span>
                </div>
              )}
            </div>
          </section>

          {workspace.selectedArtifact ? (
            <ArtifactWorkspace
              key={workspace.selectedArtifact.artifactId}
              artifact={workspace.selectedArtifact}
              viewerConfiguration="target"
              viewerStatePayload={workspace.selectedTargetViewerState?.payload ?? null}
              selectionDraft={workspace.selectionDraft}
              selectionIndices={workspace.selectionIndices}
              focusIndices={workspace.focusIndices}
              draftFocused={workspace.isDraftFocused}
              selectionEnabled={workspace.selectionEnabled}
              selectionSyncNonce={workspace.selectionSyncNonce}
              onSelectionIndicesChange={workspace.onSelectionIndicesChange}
              onSelectionModeChange={workspace.onSelectionModeChange}
              onFocusIndicesChange={workspace.onFocusIndicesChange}
              onViewerStateChange={(payload) => {
                workspace.onViewerStateChange(workspace.selectedArtifact!.artifactId, 'target', 'Current target view', payload);
              }}
              onNativeViewerStateDownloadReady={workspace.onNativeViewerStateDownloadReady}
            />
          ) : (
            <section className="panel empty-panel">
              <h2>No viewer artifact loaded</h2>
              <p>Select a target to load its Mol* workspace.</p>
            </section>
          )}

          {workspace.compareValidations.length > 0 && (
            <section className="panel compare-shell-panel">
              <div className="project-section-header">
                <div>
                  <p className="eyebrow">Comparison</p>
                  <h2>Side-by-side binder validations</h2>
                </div>
              </div>
              <div className="compare-grid">
                {workspace.compareValidations.map((validation) => {
                  const artifact = workspace.viewerArtifacts[validation.id];
                  const viewerState = getLatestViewerState(workspace.project, validation.id, 'validate_refolding');
                  return (
                    <div key={validation.id} className="compare-column">
                      <div className="compare-column-header">
                        <strong>{validation.name}</strong>
                        <span>{validation.id}</span>
                      </div>
                      {artifact ? (
                        <ArtifactWorkspace
                          key={artifact.artifactId}
                          artifact={artifact}
                          viewerConfiguration="validate_refolding"
                          viewerStatePayload={viewerState?.payload ?? null}
                          selectionDraft={workspace.selectionDraft}
                          selectionIndices={null}
                          focusIndices={null}
                          draftFocused={workspace.isDraftFocused}
                          selectionEnabled={workspace.selectionEnabled}
                          onViewerStateChange={(payload) => {
                            workspace.onViewerStateChange(validation.id, 'validate_refolding', 'Current validate refolding view', payload);
                          }}
                        />
                      ) : (
                        <div className="panel empty-panel compare-empty-panel">
                          <h2>Loading validation…</h2>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
