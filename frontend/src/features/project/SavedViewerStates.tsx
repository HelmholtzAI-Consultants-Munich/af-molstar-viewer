import type { WorkspaceProject } from '../../domain/project';

interface SavedViewerStatesProps {
  project: WorkspaceProject;
}

export function SavedViewerStates(props: SavedViewerStatesProps) {
  return (
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
  );
}
