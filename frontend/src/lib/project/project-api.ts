import type {
  JobRef,
  TargetArtifact,
  ViewerArtifactSource,
  ViewerConfiguration,
  ViewerStateSnapshot,
  WorkspaceProject,
} from '../../domain/project-types';
import { canonicalizeSelectionDraft } from '../../domain/target-interface';
import { discoverGroups, loadBundle } from '../discovery';
import type { WorkerInputFile } from '../types';
import { createSeedProject, getGeneratedOutputs, resolveViewerArtifactSource } from './project-fixtures';

export interface ProjectApi {
  createProject(): Promise<WorkspaceProject>;
  getProject(projectId: string): Promise<WorkspaceProject>;
  getViewerArtifact(projectId: string, artifactId: string): Promise<ViewerArtifactSource>;
  removeTarget(projectId: string, targetId: string): Promise<WorkspaceProject>;
  updateTargetInterface(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<WorkspaceProject>;
  cropTargetToSelection(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef>;
  cutSelectionOffTarget(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef>;
  generateBinders(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef>;
  validateRefolding(projectId: string, binderCandidateIds: string[]): Promise<JobRef>;
  getJob(jobId: string): Promise<JobRef>;
  saveViewerState(
    projectId: string,
    artifactId: string,
    label: string,
    payload?: Record<string, unknown>,
    viewerConfiguration?: ViewerConfiguration,
  ): Promise<ViewerStateSnapshot>;
  uploadTarget(projectId: string, files: WorkerInputFile[]): Promise<{ project: WorkspaceProject; target: TargetArtifact }>;
}

interface LocalJobRecord {
  job: JobRef;
  apply: (job: JobRef) => void;
}

class LocalFixtureProjectApi implements ProjectApi {
  private project: WorkspaceProject | null = null;
  private jobs = new Map<string, LocalJobRecord>();
  private uploadedViewerArtifacts = new Map<string, ViewerArtifactSource>();
  private projectCounter = 1;
  private targetCounter = 1;
  private viewerStateCounter = 1;

  async createProject(): Promise<WorkspaceProject> {
    this.project = createSeedProject();
    this.project.id = `project-${this.projectCounter++}`;
    this.project.jobs = [];
    return structuredClone(this.project);
  }

  async getProject(projectId: string): Promise<WorkspaceProject> {
    const project = this.requireProject(projectId);
    return structuredClone(project);
  }

  async getViewerArtifact(projectId: string, artifactId: string): Promise<ViewerArtifactSource> {
    this.requireProject(projectId);
    const uploaded = this.uploadedViewerArtifacts.get(artifactId);
    if (uploaded) {
      return structuredClone(uploaded);
    }
    return resolveViewerArtifactSource(artifactId);
  }

  async removeTarget(projectId: string, targetId: string): Promise<WorkspaceProject> {
    const project = this.requireProject(projectId);
    const target = project.targets.find((entry) => entry.id === targetId);
    if (!target) throw new Error(`Unknown target ${targetId}`);

    const binderRunIds = new Set(project.binder_runs.filter((entry) => entry.target_id === targetId).map((entry) => entry.id));
    const binderCandidateIds = new Set(
      project.binder_candidates.filter((entry) => entry.target_id === targetId || binderRunIds.has(entry.binder_run_id)).map((entry) => entry.id),
    );
    const validationRunIds = new Set(
      project.validation_runs
        .filter(
          (entry) =>
            entry.target_id === targetId ||
            entry.binder_candidate_ids.some((candidateId) => binderCandidateIds.has(candidateId)),
        )
        .map((entry) => entry.id),
    );
    const binderValidationIds = new Set(
      project.binder_validations
        .filter(
          (entry) =>
            entry.target_id === targetId ||
            binderCandidateIds.has(entry.binder_candidate_id) ||
            validationRunIds.has(entry.validation_run_id),
        )
        .map((entry) => entry.id),
    );
    const removedArtifactIds = new Set<string>([
      target.id,
      target.viewer_asset_id,
      ...binderValidationIds,
      ...project.binder_validations
        .filter((entry) => binderValidationIds.has(entry.id))
        .map((entry) => entry.viewer_asset_id),
    ]);

    project.targets = project.targets.filter((entry) => entry.id !== targetId);
    project.binder_runs = project.binder_runs.filter((entry) => !binderRunIds.has(entry.id));
    project.binder_candidates = project.binder_candidates.filter((entry) => !binderCandidateIds.has(entry.id));
    project.validation_runs = project.validation_runs.filter((entry) => !validationRunIds.has(entry.id));
    project.binder_validations = project.binder_validations.filter((entry) => !binderValidationIds.has(entry.id));
    project.viewer_states = project.viewer_states.filter((entry) => !removedArtifactIds.has(entry.artifact_id));

    for (const artifactId of removedArtifactIds) {
      this.uploadedViewerArtifacts.delete(artifactId);
    }

    return structuredClone(project);
  }

  async updateTargetInterface(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<WorkspaceProject> {
    const project = this.requireProject(projectId);
    const target = project.targets.find((entry) => entry.id === targetId);
    if (!target) throw new Error(`Unknown target ${targetId}`);
    // TODO rename the function
    console.debug('[LocalFixtureProjectApi] update target interface requested')
    target.selection = canonicalizeSelectionDraft(targetInterfaceResidues);
    return structuredClone(project);
  }

  async cropTargetToSelection(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef> {
    const project = this.requireProject(projectId);
    const sourceTarget = project.targets.find((entry) => entry.id === targetId);
    if (!sourceTarget) throw new Error(`Unknown target ${targetId}`);
    console.info('[LocalFixtureProjectApi] crop to selection requested', {
      projectId,
      targetId,
      targetInterfaceResidues,
    });
    return this.createJob(projectId, 'crop_target', 'Printing crop-to-selection request in local fixture mode', (job) => {
      const { target, viewerArtifactSource } = this.createDerivedTargetFromSource(
        project,
        sourceTarget,
        'cropped',
      );
      project.targets.push(target);
      this.uploadedViewerArtifacts.set(target.id, viewerArtifactSource);
      job.target_ids = [target.id];
    });
  }

  async cutSelectionOffTarget(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef> {
    const project = this.requireProject(projectId);
    const sourceTarget = project.targets.find((entry) => entry.id === targetId);
    if (!sourceTarget) throw new Error(`Unknown target ${targetId}`);
    console.info('[LocalFixtureProjectApi] cut off selection requested', {
      projectId,
      targetId,
      targetInterfaceResidues,
    });
    return this.createJob(projectId, 'cut_target', 'Printing cut-off-selection request in local fixture mode', (job) => {
      const { target, viewerArtifactSource } = this.createDerivedTargetFromSource(
        project,
        sourceTarget,
        'cut',
      );
      project.targets.push(target);
      this.uploadedViewerArtifacts.set(target.id, viewerArtifactSource);
      job.target_ids = [target.id];
    });
  }

  async generateBinders(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef> {
    const project = this.requireProject(projectId);
    const target = project.targets.find((entry) => entry.id === targetId);
    if (!target) throw new Error(`Unknown target ${targetId}`);
    target.selection = canonicalizeSelectionDraft(targetInterfaceResidues);
    const generated = getGeneratedOutputs();
    return this.createJob(projectId, 'generate_binders', 'Generating binder candidates from fixture outputs', () => {
      const binderRunId = `binder-run-${project.binder_runs.length + 1}`;
      project.binder_runs.push({
        id: binderRunId,
        name: generated.binder_run.name,
        target_id: target.id,
        binder_candidate_ids: generated.binder_candidates.map((entry) => entry.id),
      });
      project.binder_candidates = generated.binder_candidates.map((entry) => ({
        id: entry.id,
        name: entry.name,
        binder_run_id: binderRunId,
        target_id: target.id,
      }));
    });
  }

  async validateRefolding(projectId: string, binderCandidateIds: string[]): Promise<JobRef> {
    const project = this.requireProject(projectId);
    const candidates = project.binder_candidates.filter((entry) => binderCandidateIds.includes(entry.id));
    if (candidates.length === 0) {
      throw new Error('No binder candidates selected');
    }
    const generated = getGeneratedOutputs();
    return this.createJob(projectId, 'validate_refolding', 'Validating binder refolding with fixture outputs', () => {
      const validationRunId = `validation-run-${project.validation_runs.length + 1}`;
      project.validation_runs.push({
        id: validationRunId,
        name: generated.validation_run.name,
        target_id: candidates[0].target_id,
        binder_candidate_ids: candidates.map((entry) => entry.id),
        binder_validation_ids: generated.binder_validations.map((entry) => entry.id),
      });
      project.binder_validations = generated.binder_validations.map((entry) => ({
        id: entry.id,
        name: entry.name,
        validation_run_id: validationRunId,
        binder_candidate_id: entry.binder_candidate_id,
        target_id: candidates[0].target_id,
        viewer_asset_id: entry.viewer_asset_id,
      }));
    });
  }

  async getJob(jobId: string): Promise<JobRef> {
    const record = this.jobs.get(jobId);
    if (!record) throw new Error(`Unknown job ${jobId}`);
    const elapsed = Date.now() - record.job.created_at;
    if (record.job.status === 'queued' && elapsed >= 150) {
      record.job.status = 'running';
    }
    if (record.job.status === 'running' && elapsed >= 650) {
      record.job.status = 'succeeded';
      record.job.finished_at = Date.now();
      record.apply();
      this.jobs.delete(jobId);
    }
    this.syncProjectJobs();
    return structuredClone(record.job);
  }

  async saveViewerState(
    projectId: string,
    artifactId: string,
    label: string,
    payload: Record<string, unknown> = {},
    viewerConfiguration: ViewerConfiguration = 'target',
  ): Promise<ViewerStateSnapshot> {
    const project = this.requireProject(projectId);
    if (!label.trim()) throw new Error('Viewer state label cannot be empty');
    const trimmedLabel = label.trim();
    const existing = project.viewer_states.find(
      (state) =>
        state.artifact_id === artifactId &&
        state.viewer_configuration === viewerConfiguration &&
        state.label === trimmedLabel,
    );
    const snapshot: ViewerStateSnapshot = existing
      ? {
          ...existing,
          payload: structuredClone(payload),
          updated_at: Date.now(),
        }
      : {
          id: `viewer-state-${this.viewerStateCounter++}`,
          artifact_id: artifactId,
          viewer_configuration: viewerConfiguration,
          label: trimmedLabel,
          payload: structuredClone(payload),
          updated_at: Date.now(),
        };
    if (existing) {
      const index = project.viewer_states.findIndex((state) => state.id === existing.id);
      project.viewer_states.splice(index, 1, snapshot);
    } else {
      project.viewer_states.push(snapshot);
    }
    return structuredClone(snapshot);
  }

  async uploadTarget(projectId: string, files: WorkerInputFile[]): Promise<{ project: WorkspaceProject; target: TargetArtifact }> {
    const project = this.requireProject(projectId);
    const targetId = `target-${this.targetCounter++}`;
    const { target, viewerArtifactSource } = createUploadedTarget(files, targetId);
    project.targets.push(target);
    this.uploadedViewerArtifacts.set(target.id, viewerArtifactSource);
    return {
      project: structuredClone(project),
      target: structuredClone(target),
    };
  }

  private createJob(projectId: string, jobType: JobRef['job_type'], progressMessage: string, apply: (job: JobRef) => void): JobRef {
    const job: JobRef = {
      job_id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      job_type: jobType,
      status: 'queued',
      project_id: projectId,
      created_at: Date.now(),
      progress_message: progressMessage,
      target_ids: [],
      binder_candidate_ids: [],
      binder_validation_ids: [],
    };
    this.jobs.set(job.job_id, {
      job,
      apply: () => {
        apply(job);
        this.syncProjectJobs();
      },
    });
    this.syncProjectJobs();
    return structuredClone(job);
  }

  private requireProject(projectId: string): WorkspaceProject {
    if (!this.project || this.project.id !== projectId) {
      throw new Error(`Unknown project ${projectId}`);
    }
    return this.project;
  }

  private syncProjectJobs() {
    if (!this.project) return;
    this.project.jobs = [...this.jobs.values()].map((entry) => structuredClone(entry.job));
  }

  private createDerivedTargetFromSource(
    project: WorkspaceProject,
    sourceTarget: TargetArtifact,
    operation: 'cropped' | 'cut',
  ) {
    const sourceArtifact =
      this.uploadedViewerArtifacts.get(sourceTarget.id) ?? resolveViewerArtifactSource(sourceTarget.id);
    const targetId = `target-${this.targetCounter++}`;
    const name = this.createDerivedTargetName(project, sourceTarget.name, operation);
    const target: TargetArtifact = {
      ...sourceTarget,
      id: targetId,
      name,
      provenance: 'cropped',
      selection: '',
      chain_ids: this.deriveChainIdsForDerivedTarget(sourceTarget, sourceArtifact),
      parent_target_id: sourceTarget.id,
      viewer_asset_id: targetId,
      source_job_id: null,
    };
    const viewerArtifactSource: ViewerArtifactSource = {
      artifact_id: targetId,
      label: name,
      files: sourceArtifact.files.map((file) => ({
        name: file.name,
        text: file.text,
        url: file.url,
      })),
    };
    return { target, viewerArtifactSource };
  }

  private createDerivedTargetName(
    project: WorkspaceProject,
    sourceName: string,
    operation: 'cropped' | 'cut',
  ) {
    const baseName = sourceName.replace(/_(?:cropped|cut)_\d+$/i, '');
    const pattern = new RegExp(`^${escapeRegExp(baseName)}_${operation}_(\\d+)$`, 'i');
    const nextIndex =
      project.targets.reduce((max, target) => {
        const match = target.name.match(pattern);
        return match ? Math.max(max, Number.parseInt(match[1] ?? '0', 10)) : max;
      }, 0) + 1;
    return `${baseName}_${operation}_${nextIndex}`;
  }

  private deriveChainIdsForDerivedTarget(sourceTarget: TargetArtifact, sourceArtifact: ViewerArtifactSource) {
    const filesWithText = sourceArtifact.files.every((file) => typeof file.text === 'string');
    if (!filesWithText) {
      return sourceTarget.chain_ids;
    }

    try {
      const workerFiles = sourceArtifact.files.map((file) => ({
        name: file.name,
        text: file.text ?? '',
      }));
      const groups = discoverGroups(workerFiles);
      const preferredGroup = groups.find((group) => !group.unresolved) ?? groups[0];
      if (!preferredGroup || preferredGroup.unresolved) {
        return sourceTarget.chain_ids;
      }
      const bundle = loadBundle(workerFiles, preferredGroup);
      return bundle.chains.map((chain) => chain.chainId);
    } catch {
      return sourceTarget.chain_ids;
    }
  }
}

class HttpProjectApi implements ProjectApi {
  constructor(private readonly baseUrl = '/api') {}

  async createProject(): Promise<WorkspaceProject> {
    return this.request<WorkspaceProject>('/projects', { method: 'POST' });
  }

  async getProject(projectId: string): Promise<WorkspaceProject> {
    return this.request<WorkspaceProject>(`/projects/${projectId}`);
  }

  async getViewerArtifact(projectId: string, artifactId: string): Promise<ViewerArtifactSource> {
    return this.request<ViewerArtifactSource>(`/projects/${projectId}/artifacts/${artifactId}/viewer`);
  }

  async removeTarget(projectId: string, targetId: string): Promise<WorkspaceProject> {
    await this.request(`/projects/${projectId}/targets/${targetId}`, {
      method: 'DELETE',
    });
    return this.getProject(projectId);
  }

  async updateTargetInterface(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<WorkspaceProject> {
    await this.request(`/projects/${projectId}/targets/${targetId}/interface`, {
      method: 'POST',
      body: JSON.stringify({
        selection: targetInterfaceResidues,
      }),
    });
    return this.getProject(projectId);
  }

  async cropTargetToSelection(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef> {
    return this.request<JobRef>(`/projects/${projectId}/targets/${targetId}/crop-to-selection`, {
      method: 'POST',
      body: JSON.stringify({
        selection: targetInterfaceResidues,
      }),
    });
  }

  async cutSelectionOffTarget(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef> {
    return this.request<JobRef>(`/projects/${projectId}/targets/${targetId}/cut-off-selection`, {
      method: 'POST',
      body: JSON.stringify({
        selection: targetInterfaceResidues,
      }),
    });
  }

  async generateBinders(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef> {
    return this.request<JobRef>(`/projects/${projectId}/generate-binders`, {
      method: 'POST',
      body: JSON.stringify({
        target_id: targetId,
        selection: targetInterfaceResidues,
      }),
    });
  }

  async validateRefolding(projectId: string, binderCandidateIds: string[]): Promise<JobRef> {
    return this.request<JobRef>(`/projects/${projectId}/validate-refolding`, {
      method: 'POST',
      body: JSON.stringify({ binder_candidate_ids: binderCandidateIds }),
    });
  }

  async getJob(jobId: string): Promise<JobRef> {
    return this.request<JobRef>(`/jobs/${jobId}`);
  }

  async saveViewerState(
    projectId: string,
    artifactId: string,
    label: string,
    payload: Record<string, unknown> = {},
    viewerConfiguration: ViewerConfiguration = 'target',
  ): Promise<ViewerStateSnapshot> {
    return this.request<ViewerStateSnapshot>(`/projects/${projectId}/viewer-states`, {
      method: 'POST',
      body: JSON.stringify({
        artifact_id: artifactId,
        label,
        payload,
        viewer_configuration: viewerConfiguration,
      }),
    });
  }

  async uploadTarget(projectId: string, files: WorkerInputFile[]): Promise<{ project: WorkspaceProject; target: TargetArtifact }> {
    const uploadMetadata = deriveUploadedTargetMetadata(files);
    return this.request<{ project: WorkspaceProject; target: TargetArtifact }>(`/projects/${projectId}/targets/upload`, {
      method: 'POST',
      body: JSON.stringify({
        name: uploadMetadata.name,
        chain_ids: uploadMetadata.chainIds,
        files: files.map((file) => ({
          name: file.name,
          text: file.text,
        })),
      }),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json() as Promise<T>;
  }
}

export function createProjectApi(): ProjectApi {
  return import.meta.env.VITE_PROJECT_API_MODE === 'http'
    ? new HttpProjectApi(import.meta.env.VITE_PROJECT_API_BASE_URL ?? '/api')
    : new LocalFixtureProjectApi();
}

function createUploadedTarget(files: WorkerInputFile[], targetId: string): { target: TargetArtifact; viewerArtifactSource: ViewerArtifactSource } {
  const { bundle } = deriveUploadedTargetMetadata(files);
  const target: TargetArtifact = {
    id: targetId,
    name: bundle.name,
    provenance: 'uploaded',
    selection: '',
    chain_ids: bundle.chains.map((chain) => chain.chainId),
    viewer_asset_id: targetId,
    parent_target_id: null,
    source_structure_id: null,
    source_job_id: null,
  };
  const viewerArtifactSource: ViewerArtifactSource = {
    artifact_id: targetId,
    label: bundle.name,
    files: files.map((file) => ({
      name: file.name,
      text: file.text,
    })),
  };
  return { target, viewerArtifactSource };
}

function deriveUploadedTargetMetadata(files: WorkerInputFile[]) {
  if (files.length === 0) {
    throw new Error('Choose at least one file to upload a target.');
  }

  const groups = discoverGroups(files);
  const preferredGroup = groups.find((group) => !group.unresolved) ?? groups[0];
  if (!preferredGroup) {
    throw new Error('No supported target files were provided.');
  }
  if (preferredGroup.unresolved) {
    throw new Error(preferredGroup.reasons.join('. '));
  }

  const bundle = loadBundle(files, preferredGroup);
  return {
    bundle,
    name: bundle.name,
    chainIds: bundle.chains.map((chain) => chain.chainId),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
