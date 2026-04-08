import { describe, expect, it } from 'vitest';
import { canonicalizeTargetInterfaceResidues, parseTargetInterfaceResidues } from '../domain/target-interface';

describe('target interface residues', () => {
  it('canonicalizes multichain residue syntax', () => {
    expect(canonicalizeTargetInterfaceResidues('B20-22,A1-10,A12')).toBe('A1-10,A12,B20-22');
  });

  it('rejects invalid segments', () => {
    expect(() => parseTargetInterfaceResidues('A10-,B2')).toThrow(/invalid/i);
  });
});
