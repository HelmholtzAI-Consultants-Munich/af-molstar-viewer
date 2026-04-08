import seedManifest from '../../../../fixtures/project-seed.json';
import type { ViewerArtifactSource, WorkspaceProject } from '../../domain/project-types';

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

const FIXTURE_URLS: Record<string, string> = {
  'fixtures/examples/AF-Q14145-F1-model_v6.cif': new URL('../../../../fixtures/examples/AF-Q14145-F1-model_v6.cif', import.meta.url).href,
  'fixtures/examples/AF-Q14145-F1-predicted_aligned_error_v6.json': new URL('../../../../fixtures/examples/AF-Q14145-F1-predicted_aligned_error_v6.json', import.meta.url).href,
  'fixtures/test-inputs/colabfold-multimer/toy_multimer_unrelaxed_rank_001.pdb': new URL('../../../../fixtures/test-inputs/colabfold-multimer/toy_multimer_unrelaxed_rank_001.pdb', import.meta.url).href,
  'fixtures/test-inputs/colabfold-multimer/toy_multimer_scores.json': new URL('../../../../fixtures/test-inputs/colabfold-multimer/toy_multimer_scores.json', import.meta.url).href,
  'fixtures/examples/l73.pdb': new URL('../../../../fixtures/examples/l73.pdb', import.meta.url).href,
  'fixtures/examples/l73.json': new URL('../../../../fixtures/examples/l73.json', import.meta.url).href,
  'fixtures/examples/l77_s858427_mpnn2_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_002.pdb': new URL('../../../../fixtures/examples/l77_s858427_mpnn2_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_002.pdb', import.meta.url).href,
  'fixtures/examples/l77_s858427_mpnn2_scores_rank_001_alphafold2_ptm_model_1_seed_002.json': new URL('../../../../fixtures/examples/l77_s858427_mpnn2_scores_rank_001_alphafold2_ptm_model_1_seed_002.json', import.meta.url).href,
};

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
    files: asset.files.map((file) => ({
      name: file.name,
      url: FIXTURE_URLS[file.path] ?? (() => {
        throw new Error(`No static fixture URL configured for ${file.path}`);
      })(),
    })),
  };
}
