import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverGroups, loadBundle } from '../lib/discovery';
import type { WorkerInputFile } from '../lib/types';

function fixture(path: string): WorkerInputFile {
  return {
    name: path.split('/').at(-1)!,
    text: readFileSync(new URL(path, import.meta.url), 'utf8'),
  };
}

describe('discovery and adapter loading', () => {
  it('discovers the local AlphaFold DB example and loads it', () => {
    const files = [
      {
        name: 'AF-Q14145-F1-model_v6.cif',
        text: readFileSync(resolve(process.cwd(), '../fixtures/examples/AF-Q14145-F1-model_v6.cif'), 'utf8'),
      },
      {
        name: 'AF-Q14145-F1-predicted_aligned_error_v6.json',
        text: readFileSync(resolve(process.cwd(), '../fixtures/examples/AF-Q14145-F1-predicted_aligned_error_v6.json'), 'utf8'),
      },
    ];

    const groups = discoverGroups(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].suggestedSource).toBe('af2');
    expect(groups[0].unresolved).toBe(false);

    const bundle = loadBundle(files, groups[0]);
    expect(bundle.source).toBe('af2');
    expect(bundle.paeMatrix).toHaveLength(624);
    expect(bundle.residues).toHaveLength(624);
    expect(bundle.chains).toHaveLength(1);
  });

  it('loads ColabFold monomer and multimer score fixtures', () => {
    const monomerFiles = [
      fixture('../../../fixtures/test-inputs/colabfold/toy_ranked_0.pdb'),
      fixture('../../../fixtures/test-inputs/colabfold/toy_scores.json'),
    ];
    const monomerGroup = discoverGroups(monomerFiles)[0];
    const monomerBundle = loadBundle(monomerFiles, monomerGroup);
    expect(monomerBundle.source).toBe('colabfold');
    expect(monomerBundle.residues).toHaveLength(3);
    expect(monomerBundle.summary.pTM).toBeCloseTo(0.71);
    expect(monomerBundle.paeMatrix[0][2]).toBeCloseTo(9.8);

    const multimerFiles = [
      fixture('../../../fixtures/test-inputs/colabfold-multimer/toy_multimer_unrelaxed_rank_001.pdb'),
      fixture('../../../fixtures/test-inputs/colabfold-multimer/toy_multimer_scores.json'),
    ];
    const multimerGroup = discoverGroups(multimerFiles)[0];
    const multimerBundle = loadBundle(multimerFiles, multimerGroup);
    expect(multimerBundle.residues).toHaveLength(4);
    expect(multimerBundle.chains).toHaveLength(2);
    expect(multimerBundle.summary.ipTM).toBeCloseTo(0.81);
  });

  it('detects generic ColabFold json basenames by content', () => {
    const files = [
      {
        name: 'l73.pdb',
        text: readFileSync(resolve(process.cwd(), '../fixtures/examples/l73.pdb'), 'utf8'),
      },
      {
        name: 'l73.json',
        text: readFileSync(resolve(process.cwd(), '../fixtures/examples/l73.json'), 'utf8'),
      },
    ];

    const groups = discoverGroups(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].suggestedSource).toBe('colabfold');
    expect(groups[0].unresolved).toBe(false);
    expect(groups[0].scoreJsonOptions).toEqual(['l73.json']);

    const bundle = loadBundle(files, groups[0]);
    expect(bundle.source).toBe('colabfold');
    expect(bundle.structure.fileName).toBe('l73.pdb');
    expect(bundle.summary.pTM).toBeCloseTo(0.54);
    expect(bundle.paeMax).toBeCloseTo(30.609375);
  });

  it('matches ranked ColabFold score and structure files by shared prediction stem', () => {
    const files = [
      {
        name: 'l77_s858427_mpnn2_scores_rank_001_alphafold2_ptm_model_1_seed_002.json',
        text: readFileSync(
          resolve(process.cwd(), '../fixtures/examples/l77_s858427_mpnn2_scores_rank_001_alphafold2_ptm_model_1_seed_002.json'),
          'utf8',
        ),
      },
      {
        name: 'l77_s858427_mpnn2_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_002.pdb',
        text: readFileSync(
          resolve(process.cwd(), '../fixtures/examples/l77_s858427_mpnn2_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_002.pdb'),
          'utf8',
        ),
      },
    ];

    const groups = discoverGroups(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('l77_s858427_mpnn2');
    expect(groups[0].suggestedSource).toBe('colabfold');
    expect(groups[0].unresolved).toBe(false);

    const bundle = loadBundle(files, groups[0]);
    expect(bundle.source).toBe('colabfold');
    expect(bundle.residues).toHaveLength(77);
    expect(bundle.summary.pTM).toBeCloseTo(0.73);
  });

  it('matches corresponding ColabFold structure and score files by content even with unrelated names', () => {
    const files = [
      {
        name: 'totally-different-structure-name.pdb',
        text: readFileSync(
          resolve(process.cwd(), '../fixtures/examples/l77_s858427_mpnn2_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_002.pdb'),
          'utf8',
        ),
      },
      {
        name: 'nothing-like-the-structure-name.json',
        text: readFileSync(
          resolve(process.cwd(), '../fixtures/examples/l77_s858427_mpnn2_scores_rank_001_alphafold2_ptm_model_1_seed_002.json'),
          'utf8',
        ),
      },
    ];

    const groups = discoverGroups(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].suggestedSource).toBe('colabfold');
    expect(groups[0].unresolved).toBe(false);
    expect(groups[0].structureOptions).toEqual(['totally-different-structure-name.pdb']);
    expect(groups[0].scoreJsonOptions).toEqual(['nothing-like-the-structure-name.json']);

    const bundle = loadBundle(files, groups[0]);
    expect(bundle.source).toBe('colabfold');
    expect(bundle.structure.fileName).toBe('totally-different-structure-name.pdb');
    expect(bundle.summary.pTM).toBeCloseTo(0.73);
  });

  it('loads a lone confidence-carrying structure with a synthetic PAE matrix', () => {
    const files = [
      {
        name: 'l73.pdb',
        text: readFileSync(
          resolve(process.cwd(), '../fixtures/examples/l73.pdb'),
          'utf8',
        ),
      },
    ];

    const groups = discoverGroups(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].suggestedSource).toBe('structure');
    expect(groups[0].unresolved).toBe(false);

    const bundle = loadBundle(files, groups[0]);
    expect(bundle.source).toBe('structure');
    expect(bundle.metadata.syntheticPae).toBe(true);
    expect(bundle.paeMatrix).toHaveLength(bundle.residues.length);
    expect(bundle.paeMatrix[0][0]).toBe(0);
    expect(bundle.paeMatrix[0][1]).toBe(30);
  });

  it('accepts a valid ColabFold pair even when another nearby structure without scores is present', () => {
    const files = [
      {
        name: 'random-structure-name.pdb',
        text: readFileSync(
          resolve(process.cwd(), '../fixtures/examples/l77_s858427_mpnn2_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_002.pdb'),
          'utf8',
        ),
      },
      {
        name: 'completely-different-scores-name.json',
        text: readFileSync(
          resolve(process.cwd(), '../fixtures/examples/l77_s858427_mpnn2_scores_rank_001_alphafold2_ptm_model_1_seed_002.json'),
          'utf8',
        ),
      },
      {
        name: 'extra-neighboring-output.pdb',
        text: readFileSync(
          resolve(process.cwd(), '../fixtures/examples/l77_s858427_mpnn1_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_000.pdb'),
          'utf8',
        ),
      },
    ];

    const groups = discoverGroups(files);
    const resolvedGroup = groups.find((group) => group.structureOptions.includes('random-structure-name.pdb'));
    const loneStructure = groups.find((group) => group.structureOptions.includes('extra-neighboring-output.pdb'));

    expect(resolvedGroup).toBeDefined();
    expect(resolvedGroup?.suggestedSource).toBe('colabfold');
    expect(resolvedGroup?.unresolved).toBe(false);
    expect(resolvedGroup?.scoreJsonOptions).toEqual(['completely-different-scores-name.json']);

    expect(loneStructure).toBeDefined();
    expect(loneStructure?.suggestedSource).toBe('structure');
    expect(loneStructure?.unresolved).toBe(false);

    const bundle = loadBundle(files, resolvedGroup!);
    expect(bundle.source).toBe('colabfold');
    expect(bundle.summary.pTM).toBeCloseTo(0.73);
  });

  it('projects AF3 token-level confidence down to polymer residues only', () => {
    const files = [
      fixture('../../../fixtures/test-inputs/af3/toy_model.cif'),
      fixture('../../../fixtures/test-inputs/af3/toy_confidences.json'),
      fixture('../../../fixtures/test-inputs/af3/toy_summary_confidences.json'),
    ];
    const group = discoverGroups(files)[0];
    const bundle = loadBundle(files, group);

    expect(bundle.source).toBe('af3');
    expect(bundle.residues).toHaveLength(2);
    expect(bundle.paeMatrix).toEqual([
      [0.3, 2.1],
      [2.0, 0.4],
    ]);
    expect(bundle.summary.ptm).toBeCloseTo(0.62);
    expect(bundle.residues[0].confidence).toBeCloseTo(91);
  });

  it('keeps unrelated structures separate instead of creating filename-only ambiguity', () => {
    const files = [
      fixture('../../../fixtures/test-inputs/colabfold/toy_ranked_0.pdb'),
      fixture('../../../fixtures/test-inputs/colabfold/toy_scores.json'),
      {
        name: 'toy_model.cif',
        text: readFileSync(resolve(process.cwd(), '../fixtures/test-inputs/af3/toy_model.cif'), 'utf8'),
      },
    ];
    const groups = discoverGroups(files);
    expect(groups).toHaveLength(2);
    const resolvedColabFold = groups.find((group) => group.suggestedSource === 'colabfold');
    const loneStructure = groups.find((group) => group.structureOptions.includes('toy_model.cif'));
    expect(resolvedColabFold?.unresolved).toBe(false);
    expect(resolvedColabFold?.structureOptions).toEqual(['toy_ranked_0.pdb']);
    expect(loneStructure?.unresolved).toBe(false);
    expect(loneStructure?.suggestedSource).toBe('structure');
  });
});
