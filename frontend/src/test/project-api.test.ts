import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectApi } from '../lib/project/project-api';
import toyRanked0 from '../../../fixtures/test-inputs/colabfold/toy_ranked_0.pdb?raw';
import toyScores from '../../../fixtures/test-inputs/colabfold/toy_scores.json?raw';

async function uploadColabfoldTarget() {
  const api = createProjectApi();
  const project = await api.createProject();
  const result = await api.uploadTarget(project.id, [
    { name: 'toy_ranked_0.pdb', text: toyRanked0 },
    { name: 'toy_scores.json', text: toyScores },
  ]);
  return { api, project: result.project, target: result.target };
}

describe('project api fixtures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs crop-to-selection and cut-off-selection jobs and produces derived targets', async () => {
    const { api, project, target } = await uploadColabfoldTarget();

    const cropJob = await api.cropTargetToSelection(project.id, target.id, 'B20-22,A1-10');
    const cutJob = await api.cutSelectionOffTarget(project.id, target.id, 'B20-22,A1-10');
    vi.advanceTimersByTime(700);
    const resolvedCrop = await api.getJob(cropJob.job_id);
    const resolvedCut = await api.getJob(cutJob.job_id);
    const refreshed = await api.getProject(project.id);

    expect(resolvedCrop.status).toBe('succeeded');
    expect(resolvedCut.status).toBe('succeeded');
    expect(resolvedCrop.target_ids).toHaveLength(1);
    expect(resolvedCut.target_ids).toHaveLength(1);
    expect(refreshed.targets).toHaveLength(project.targets.length + 2);
    expect(refreshed.targets.at(-2)?.name).toBe('toy_cropped_1');
    expect(refreshed.targets.at(-1)?.name).toBe('toy_cut_1');
  });

  it('generates binders and validates refolding through async jobs', async () => {
    const { api, project, target } = await uploadColabfoldTarget();

    const generateJob = await api.generateBinders(project.id, target.id, 'B20-22,A1-10');
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
    expect(afterValidate.targets[0].selection).toBe('A1-10,B20-22');
  });

  it('stores viewer states per artifact and viewer configuration', async () => {
    const { api, project, target } = await uploadColabfoldTarget();

    const targetState = await api.saveViewerState(
      project.id,
      target.id,
      'Current target view',
      { snapshot: { camera: { current: { position: [1, 2, 3] } } } },
      'target',
    );
    const targetStateReplacement = await api.saveViewerState(
      project.id,
      target.id,
      'Current target view',
      { snapshot: { camera: { current: { position: [3, 2, 1] } } } },
      'target',
    );
    const validateState = await api.saveViewerState(
      project.id,
      target.id,
      'Current validate refolding view',
      { snapshot: { camera: { current: { position: [4, 5, 6] } } } },
      'validate_refolding',
    );
    const refreshed = await api.getProject(project.id);

    expect(targetStateReplacement.id).toBe(targetState.id);
    expect(targetStateReplacement.payload).toEqual({ snapshot: { camera: { current: { position: [3, 2, 1] } } } });
    expect(validateState.viewer_configuration).toBe('validate_refolding');
    expect(refreshed.viewer_states).toHaveLength(2);
  });
});
