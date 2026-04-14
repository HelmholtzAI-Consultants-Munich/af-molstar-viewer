import type {
  JobRef,
  TargetArtifact,
  ViewerArtifactSource,
  ViewerStateSnapshot,
  WorkspaceProject,
} from '../../domain/project-types';
import { canonicalizeTargetInterfaceResidues } from '../../domain/target-interface';
import { discoverGroups, loadBundle } from '../discovery';
import type { WorkerInputFile } from '../types';
import { createSeedProject, getGeneratedOutputs, resolveViewerArtifactSource } from './project-fixtures';

export interface ProjectApi {
  createProject(): Promise<WorkspaceProject>;
  getProject(projectId: string): Promise<WorkspaceProject>;
  getViewerArtifact(projectId: string, artifactId: string): Promise<ViewerArtifactSource>;
  updateTargetInterface(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<WorkspaceProject>;
  extractTargetFromTemplate(projectId: string, sourceStructureId: string, retainedChainIds: string[], targetInterfaceResidues?: string): Promise<JobRef>;
  cropTarget(projectId: string, targetId: string, label?: string): Promise<JobRef>;
  generateBinders(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef>;
  validateRefolding(projectId: string, binderCandidateIds: string[]): Promise<JobRef>;
  getJob(jobId: string): Promise<JobRef>;
  saveViewerState(projectId: string, artifactId: string, label: string): Promise<ViewerStateSnapshot>;
  uploadTarget(projectId: string, files: WorkerInputFile[]): Promise<{ project: WorkspaceProject; target: TargetArtifact }>;
}

interface LocalJobRecord {
  job: JobRef;
  apply: () => void;
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

  async updateTargetInterface(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<WorkspaceProject> {
    const project = this.requireProject(projectId);
    const target = project.targets.find((entry) => entry.id === targetId);
    if (!target) throw new Error(`Unknown target ${targetId}`);
    target.target_interface_residues = canonicalizeTargetInterfaceResidues(targetInterfaceResidues);
    return structuredClone(project);
  }

  async extractTargetFromTemplate(projectId: string, sourceStructureId: string, retainedChainIds: string[], targetInterfaceResidues?: string): Promise<JobRef> {
    const project = this.requireProject(projectId);
    const templateTarget = project.targets.find((entry) => entry.provenance === 'template_extracted') ?? project.targets[0];
    const canonicalSelection = canonicalizeTargetInterfaceResidues(targetInterfaceResidues ?? templateTarget.target_interface_residues);
    return this.createJob(projectId, 'extract_target_from_template', 'Extracting target from template fixture', () => {
      project.targets.push({
        ...templateTarget,
        id: `target-${this.targetCounter++}`,
        source_structure_id: sourceStructureId,
        source_job_id: undefined,
        chain_ids: retainedChainIds.length > 0 ? retainedChainIds : templateTarget.chain_ids,
        target_interface_residues: canonicalSelection,
      });
    });
  }

  async cropTarget(projectId: string, targetId: string, label?: string): Promise<JobRef> {
    const project = this.requireProject(projectId);
    const sourceTarget = project.targets.find((entry) => entry.id === targetId);
    if (!sourceTarget) throw new Error(`Unknown target ${targetId}`);
    return this.createJob(projectId, 'crop_target', 'Cropping target with fixture output', () => {
      project.targets.push({
        ...sourceTarget,
        id: `target-${this.targetCounter++}`,
        name: label?.trim() || `${sourceTarget.name} cropped`,
        provenance: 'cropped',
        parent_target_id: sourceTarget.id,
        source_structure_id: sourceTarget.source_structure_id,
        source_job_id: undefined,
        target_interface_residues: sourceTarget.target_interface_residues,
      });
    });
  }

  async generateBinders(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef> {
    const project = this.requireProject(projectId);
    const target = project.targets.find((entry) => entry.id === targetId);
    if (!target) throw new Error(`Unknown target ${targetId}`);
    target.target_interface_residues = canonicalizeTargetInterfaceResidues(targetInterfaceResidues);
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

  async saveViewerState(projectId: string, artifactId: string, label: string): Promise<ViewerStateSnapshot> {
    const project = this.requireProject(projectId);
    if (!label.trim()) throw new Error('Viewer state label cannot be empty');
    const snapshot: ViewerStateSnapshot = {
      id: `viewer-state-${this.viewerStateCounter++}`,
      artifact_id: artifactId,
      label: label.trim(),
      payload: { kind: 'placeholder' },
    };
    project.viewer_states.push(snapshot);
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

  private createJob(projectId: string, jobType: JobRef['job_type'], progressMessage: string, apply: () => void): JobRef {
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
        apply();
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

  async updateTargetInterface(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<WorkspaceProject> {
    await this.request(`/projects/${projectId}/targets/${targetId}/interface`, {
      method: 'POST',
      body: JSON.stringify({
        target_interface_residues: targetInterfaceResidues,
      }),
    });
    return this.getProject(projectId);
  }

  async extractTargetFromTemplate(projectId: string, sourceStructureId: string, retainedChainIds: string[], targetInterfaceResidues?: string): Promise<JobRef> {
    return this.request<JobRef>(`/projects/${projectId}/targets/from-template`, {
      method: 'POST',
      body: JSON.stringify({
        source_structure_id: sourceStructureId,
        retained_chain_ids: retainedChainIds,
        target_interface_residues: targetInterfaceResidues,
      }),
    });
  }

  async cropTarget(projectId: string, targetId: string, label?: string): Promise<JobRef> {
    return this.request<JobRef>(`/projects/${projectId}/targets/${targetId}/crop`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
  }

  async generateBinders(projectId: string, targetId: string, targetInterfaceResidues: string): Promise<JobRef> {
    return this.request<JobRef>(`/projects/${projectId}/generate-binders`, {
      method: 'POST',
      body: JSON.stringify({
        target_id: targetId,
        target_interface_residues: targetInterfaceResidues,
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

  async saveViewerState(projectId: string, artifactId: string, label: string): Promise<ViewerStateSnapshot> {
    return this.request<ViewerStateSnapshot>(`/projects/${projectId}/viewer-states`, {
      method: 'POST',
      body: JSON.stringify({
        artifact_id: artifactId,
        label,
      }),
    });
  }

  async uploadTarget(_projectId: string, _files: WorkerInputFile[]): Promise<{ project: WorkspaceProject; target: TargetArtifact }> {
    throw new Error('Target upload is only implemented in local project mode right now.');
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
  const target: TargetArtifact = {
    id: targetId,
    name: bundle.name,
    provenance: 'uploaded',
    target_interface_residues: '',
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
