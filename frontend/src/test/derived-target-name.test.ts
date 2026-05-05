import { describe, expect, it } from 'vitest';
import { nextDerivedTargetName } from '../lib/project/project-api';

describe('nextDerivedTargetName', () => {
  it('keeps crop names flat and nests cuts under the current source', () => {
    expect(nextDerivedTargetName('AF-3-model_v6.pdb', [], 'cropped')).toBe('AF-3-model_v6_cropped_1.pdb');
    expect(
      nextDerivedTargetName('AF-3-model_v6_cropped_1.pdb', ['AF-3-model_v6_cropped_1.pdb'], 'cropped'),
    ).toBe('AF-3-model_v6_cropped_2.pdb');
    expect(
      nextDerivedTargetName(
        'AF-3-model_v6_cropped_2.pdb',
        ['AF-3-model_v6_cropped_1.pdb', 'AF-3-model_v6_cropped_2.pdb'],
        'cut',
      ),
    ).toBe('AF-3-model_v6_cropped_2_cut_1.pdb');
    expect(
      nextDerivedTargetName(
        'AF-3-model_v6_cropped_2_cut_1.pdb',
        ['AF-3-model_v6_cropped_1.pdb', 'AF-3-model_v6_cropped_2.pdb', 'AF-3-model_v6_cropped_2_cut_1.pdb'],
        'cropped',
      ),
    ).toBe('AF-3-model_v6_cropped_2_cut_1_cropped_1.pdb');
  });
});
