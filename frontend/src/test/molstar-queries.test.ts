import { describe, expect, it } from 'vitest';
import { findResidueIndexFromMolstarEvent, residueIndicesToQueries } from '../lib/molstar/queries';
import { createToyBundle } from './helpers';

describe('molstar queries', () => {
  it('includes auth residue ranges when residues have author numbering', () => {
    const bundle = createToyBundle();

    const queries = residueIndicesToQueries(bundle.residues, [0, 1]);

    expect(queries).toEqual([
      {
        label_asym_id: 'A',
        beg_label_seq_id: 1,
        end_label_seq_id: 2,
        beg_auth_seq_id: 1,
        end_auth_seq_id: 2,
      },
    ]);
  });

  it('can omit label residue ranges for PDB replay', () => {
    const bundle = createToyBundle();

    const queries = residueIndicesToQueries(bundle.residues, [0, 1], { includeLabelSeqId: false });

    expect(queries).toEqual([
      {
        label_asym_id: 'A',
        beg_auth_seq_id: 1,
        end_auth_seq_id: 2,
      },
    ]);
  });

  it('prefers residueNumber over seq_id when mapping Mol* hover/click events', () => {
    const residues = [
      {
        ...createToyBundle().residues[0],
        index: 0,
        chainId: 'A',
        labelSeqId: 6,
        authSeqId: 6,
      },
      {
        ...createToyBundle().residues[1],
        index: 1,
        chainId: 'A',
        labelSeqId: 7,
        authSeqId: 7,
      },
      {
        ...createToyBundle().residues[2],
        index: 2,
        chainId: 'A',
        labelSeqId: 8,
        authSeqId: 8,
      },
    ];

    const index = findResidueIndexFromMolstarEvent(residues, {
      label_asym_id: 'A',
      residueNumber: 7,
      seq_id: 42,
      auth_seq_id: undefined,
    });

    expect(index).toBe(1);
  });
});
