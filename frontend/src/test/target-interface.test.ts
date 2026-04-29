import { describe, expect, it } from 'vitest';
import { canonicalizeSelectionDraft, selectionDraftToChainRanges } from '../domain/target-interface';

describe('target interface residues', () => {
  it('canonicalizes multichain residue syntax', () => {
    expect(canonicalizeSelectionDraft('B20-22,A1-10,A12')).toBe('A1-10,A12,B20-22');
  });

  it('accepts repeated chain ids on range ends', () => {
    expect(canonicalizeSelectionDraft('B2-B9,A4-A40')).toBe('A4-40,B2-9');
  });

  it('rejects invalid segments', () => {
    expect(() => selectionDraftToChainRanges('A10-,B2')).toThrow(/invalid/i);
  });

  it('rejects ranges that cross chains', () => {
    expect(() => selectionDraftToChainRanges('A4-B9')).toThrow(/crosses chains/i);
  });
});
