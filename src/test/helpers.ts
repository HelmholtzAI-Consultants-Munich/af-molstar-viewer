import type { PredictionBundle } from '../lib/types';

export function createToyBundle(): PredictionBundle {
  return {
    id: 'toy',
    name: 'toy',
    source: 'colabfold',
    structure: { fileName: 'toy_ranked_0.pdb', format: 'pdb' },
    residues: [
      {
        index: 0,
        chainId: 'A',
        labelSeqId: 1,
        authSeqId: 1,
        compId: 'ALA',
        code: 'A',
        confidence: 95,
        category: 'very-high',
        moleculeType: 'protein',
        atomStart: 0,
        atomEnd: 2,
      },
      {
        index: 1,
        chainId: 'A',
        labelSeqId: 2,
        authSeqId: 2,
        compId: 'GLY',
        code: 'G',
        confidence: 82,
        category: 'high',
        moleculeType: 'protein',
        atomStart: 3,
        atomEnd: 5,
      },
      {
        index: 2,
        chainId: 'A',
        labelSeqId: 3,
        authSeqId: 3,
        compId: 'SER',
        code: 'S',
        confidence: 44,
        category: 'very-low',
        moleculeType: 'protein',
        atomStart: 6,
        atomEnd: 8,
      },
    ],
    chains: [
      {
        chainId: 'A',
        moleculeType: 'protein',
        sequence: 'AGS',
        residueStart: 0,
        residueEnd: 2,
      },
    ],
    paeMatrix: [
      [0.5, 2.1, 9.8],
      [2.4, 0.6, 6.2],
      [10.2, 7.1, 1.0],
    ],
    paeMax: 12.5,
    summary: { meanConfidence: 73.67, pTM: 0.71, ipTM: 0.33 },
    metadata: {
      warnings: [],
      matchedFiles: ['toy_ranked_0.pdb', 'toy_scores.json'],
    },
  };
}
