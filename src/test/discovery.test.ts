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
        text: readFileSync(resolve(process.cwd(), 'example/AF-Q14145-F1-model_v6.cif'), 'utf8'),
      },
      {
        name: 'AF-Q14145-F1-predicted_aligned_error_v6.json',
        text: readFileSync(resolve(process.cwd(), 'example/AF-Q14145-F1-predicted_aligned_error_v6.json'), 'utf8'),
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
      fixture('./fixtures/colabfold/toy_ranked_0.pdb'),
      fixture('./fixtures/colabfold/toy_scores.json'),
    ];
    const monomerGroup = discoverGroups(monomerFiles)[0];
    const monomerBundle = loadBundle(monomerFiles, monomerGroup);
    expect(monomerBundle.source).toBe('colabfold');
    expect(monomerBundle.residues).toHaveLength(3);
    expect(monomerBundle.summary.pTM).toBeCloseTo(0.71);
    expect(monomerBundle.paeMatrix[0][2]).toBeCloseTo(9.8);

    const multimerFiles = [
      fixture('./fixtures/colabfold-multimer/toy_multimer_unrelaxed_rank_001.pdb'),
      fixture('./fixtures/colabfold-multimer/toy_multimer_scores.json'),
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
        text: readFileSync(resolve(process.cwd(), 'example/l73.pdb'), 'utf8'),
      },
      {
        name: 'l73.json',
        text: readFileSync(resolve(process.cwd(), 'example/l73.json'), 'utf8'),
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

  it('projects AF3 token-level confidence down to polymer residues only', () => {
    const files = [
      fixture('./fixtures/af3/toy_model.cif'),
      fixture('./fixtures/af3/toy_confidences.json'),
      fixture('./fixtures/af3/toy_summary_confidences.json'),
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

  it('marks ambiguous file groups as unresolved', () => {
    const files = [
      fixture('./fixtures/colabfold/toy_ranked_0.pdb'),
      fixture('./fixtures/colabfold/toy_scores.json'),
      {
        name: 'toy_model.cif',
        text: readFileSync(resolve(process.cwd(), 'src/test/fixtures/af3/toy_model.cif'), 'utf8'),
      },
    ];
    const groups = discoverGroups(files);
    expect(groups[0].unresolved).toBe(true);
    expect(groups[0].reasons).toContain('Multiple structure files');
  });
});
