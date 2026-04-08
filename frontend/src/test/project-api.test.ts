import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectApi } from '../lib/project/project-api';

describe('project api fixtures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates derived targets through crop jobs without replacing existing targets', async () => {
    const api = createProjectApi();
    const project = await api.createProject();

    const job = await api.cropTarget(project.id, project.targets[0].id, 'Cropped fixture target');
    vi.advanceTimersByTime(700);
    const resolved = await api.getJob(job.job_id);
    const refreshed = await api.getProject(project.id);

    expect(resolved.status).toBe('succeeded');
    expect(refreshed.targets).toHaveLength(project.targets.length + 1);
    expect(refreshed.targets.at(-1)?.provenance).toBe('cropped');
  });

  it('generates binders and validates refolding through async jobs', async () => {
    const api = createProjectApi();
    const project = await api.createProject();

    const generateJob = await api.generateBinders(project.id, project.targets[0].id, 'B20-22,A1-10');
    vi.advanceTimersByTime(700);
    await api.getJob(generateJob.job_id);
    const afterGenerate = await api.getProject(project.id);
    expect(afterGenerate.binder_candidates).toHaveLength(2);

    const validateJob = await api.validateRefolding(
      project.id,
      afterGenerate.binder_candidates.map((candidate) => candidate.id),
    );
    vi.advanceTimersByTime(700);
    await api.getJob(validateJob.job_id);
    const afterValidate = await api.getProject(project.id);

    expect(afterValidate.binder_validations).toHaveLength(2);
    expect(afterValidate.targets[0].target_interface_residues).toBe('A1-10,B20-22');
  });
});
