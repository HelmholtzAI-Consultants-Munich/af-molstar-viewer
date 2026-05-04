import type { ViewerConfiguration, ViewerStateSnapshot, WorkspaceProject } from '../../domain/project';

export function getLatestViewerState(
  project: WorkspaceProject | null,
  artifactId: string | null,
  viewerConfiguration: ViewerConfiguration,
) {
  if (!project || !artifactId) return null;
  return (
    project.viewer_states
      .filter(
        (state) => state.artifact_id === artifactId && state.viewer_configuration === viewerConfiguration,
      )
      .sort((left, right) => right.updated_at - left.updated_at)[0] ?? null
  );
}

export function upsertViewerState(project: WorkspaceProject, snapshot: ViewerStateSnapshot) {
  const existingIndex = project.viewer_states.findIndex((state) => state.id === snapshot.id);
  if (existingIndex >= 0) {
    const viewerStates = [...project.viewer_states];
    viewerStates.splice(existingIndex, 1, snapshot);
    return { ...project, viewer_states: viewerStates };
  }
  return {
    ...project,
    viewer_states: [...project.viewer_states, snapshot],
  };
}
