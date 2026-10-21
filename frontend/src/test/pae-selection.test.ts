import { describe, expect, it } from 'vitest';
import { contiguousRuns } from '../lib/utils';

describe('contiguousRuns', () => {
  it('returns nothing for an empty selection', () => {
    expect(contiguousRuns([])).toEqual([]);
  });

  it('turns a lone residue into a one-wide run', () => {
    expect(contiguousRuns([7])).toEqual([{ start: 7, end: 7 }]);
  });

  it('collapses consecutive residues into a single run', () => {
    expect(contiguousRuns([3, 4, 5, 6])).toEqual([{ start: 3, end: 6 }]);
  });

  it('keeps disjoint stretches apart', () => {
    expect(contiguousRuns([4, 5, 6, 39, 40, 41, 42])).toEqual([
      { start: 4, end: 6 },
      { start: 39, end: 42 },
    ]);
  });

  it('sorts and deduplicates before grouping', () => {
    expect(contiguousRuns([40, 5, 4, 40, 6, 39, 5])).toEqual([
      { start: 4, end: 6 },
      { start: 39, end: 40 },
    ]);
  });
});
