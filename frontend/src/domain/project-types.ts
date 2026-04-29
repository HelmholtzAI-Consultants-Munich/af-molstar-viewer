import type { PredictionBundle } from '../lib/types';

export type ArtifactKind = 'target' | 'binder_candidate' | 'binder_validation';
export type TargetProvenance = 'uploaded' | 'template_extracted' | 'cropped';
export type ViewerConfiguration = 'target' | 'validate_refolding';
export type JobType =
  | 'import'
  | 'crop_target'
  | 'cut_target'
  | 'generate_binders'
  | 'validate_refolding';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface SourceStructure {
  id: string;
  name: string;
  chain_ids: string[];
}

export interface TargetArtifact {
  id: string;
  name: string;
  provenance: TargetProvenance;
  parent_target_id?: string | null;
  source_structure_id?: string | null;
  source_job_id?: string | null;
  selection: string;
  chain_ids: string[];
  viewer_asset_id: string;
}

export interface BinderCandidate {
  id: string;
  name: string;
  binder_run_id: string;
  target_id: string;
}

export interface BinderValidation {
  id: string;
  name: string;
  validation_run_id: string;
  binder_candidate_id: string;
  target_id: string;
  viewer_asset_id: string;
}

export interface BinderRun {
  id: string;
  name: string;
  target_id: string;
  binder_candidate_ids: string[];
  source_job_id?: string | null;
}

export interface ValidationRun {
  id: string;
  name: string;
  target_id: string;
  binder_candidate_ids: string[];
  binder_validation_ids: string[];
  source_job_id?: string | null;
}

export interface JobRef {
  job_id: string;
  job_type: JobType;
  status: JobStatus;
  project_id: string;
  created_at: number;
  finished_at?: number | null;
  progress_message?: string | null;
  target_ids: string[];
  binder_run_id?: string | null;
  binder_candidate_ids: string[];
  validation_run_id?: string | null;
  binder_validation_ids: string[];
}

export interface ViewerStateSnapshot {
  id: string;
  artifact_id: string;
  viewer_configuration: ViewerConfiguration;
  label: string;
  payload: Record<string, unknown>;
  updated_at: number;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  source_structures: SourceStructure[];
  targets: TargetArtifact[];
  binder_runs: BinderRun[];
  binder_candidates: BinderCandidate[];
  validation_runs: ValidationRun[];
  binder_validations: BinderValidation[];
  viewer_states: ViewerStateSnapshot[];
  jobs: JobRef[];
}

export interface ViewerFileRef {
  name: string;
  url?: string;
  text?: string;
}

export interface ViewerArtifactSource {
  artifact_id: string;
  label: string;
  files: ViewerFileRef[];
}

export interface LoadedViewerArtifact {
  artifactId: string;
  label: string;
  bundle: PredictionBundle;
  structureText: string;
}
