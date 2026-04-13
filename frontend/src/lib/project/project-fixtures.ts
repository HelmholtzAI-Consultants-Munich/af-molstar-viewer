import seedManifest from '../../../../fixtures/project-seed.json';
import type { ViewerArtifactSource, WorkspaceProject } from '../../domain/project-types';
import { createLocalFixtureFile } from './local-fixture-files';

interface RawViewerAsset {
  artifact_id: string;
  label: string;
  files: Array<{ name: string; path: string }>;
}

interface RawGeneratedOutputs {
  binder_run: { id: string; name: string };
  binder_candidates: Array<{ id: string; name: string }>;
  validation_run: { id: string; name: string };
  binder_validations: Array<{ id: string; name: string; binder_candidate_id: string; viewer_asset_id: string }>;
}

interface RawSeedManifest {
  project: { id: string; name: string };
  source_structures: WorkspaceProject['source_structures'];
  targets: WorkspaceProject['targets'];
  viewer_assets: RawViewerAsset[];
  generated_outputs: RawGeneratedOutputs;
}

const rawSeedManifest = seedManifest as unknown as RawSeedManifest;

export function createSeedProject(): WorkspaceProject {
  return structuredClone({
    id: rawSeedManifest.project.id,
    name: rawSeedManifest.project.name,
    source_structures: rawSeedManifest.source_structures,
    targets: rawSeedManifest.targets,
    binder_runs: [],
    binder_candidates: [],
    validation_runs: [],
    binder_validations: [],
    viewer_states: [],
    jobs: [],
  });
}

export function getGeneratedOutputs() {
  return structuredClone(rawSeedManifest.generated_outputs);
}

export function resolveViewerArtifactSource(artifactId: string): ViewerArtifactSource {
  const asset = rawSeedManifest.viewer_assets.find((entry) => entry.artifact_id === artifactId);
  if (!asset) {
    throw new Error(`No viewer asset fixture for ${artifactId}`);
  }
  return {
    artifact_id: asset.artifact_id,
    label: asset.label,
    files: asset.files.map((file) => createLocalFixtureFile(file.name, file.path)),
  };
}
