import afQ14145Model from '../../../../fixtures/examples/AF-Q14145-F1-model_v6.cif?raw';
import afQ14145Pae from '../../../../fixtures/examples/AF-Q14145-F1-predicted_aligned_error_v6.json?raw';
import afO15552Model from '../../../../fixtures/examples/AF-O15552-F1-model_v6.pdb?raw';
import afO15552Pae from '../../../../fixtures/examples/AF-O15552-F1-predicted_aligned_error_v6.json?raw';
import af66503175Model from '../../../../fixtures/examples/AF-0000000066503175-model_v1.pdb?raw';
import af66503175Pae from '../../../../fixtures/examples/AF-0000000066503175-predicted_aligned_error_v1.json?raw';
import mdm2BinderModel from '../../../../fixtures/examples/5_MDM2-A-binder_l16_s253144_mpnn1_model1.pdb?raw';
import l73Model from '../../../../fixtures/examples/l73.pdb?raw';
import l73Scores from '../../../../fixtures/examples/l73.json?raw';
import l77Model from '../../../../fixtures/examples/l77_s858427_mpnn2_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_002.pdb?raw';
import l77Scores from '../../../../fixtures/examples/l77_s858427_mpnn2_scores_rank_001_alphafold2_ptm_model_1_seed_002.json?raw';
import af3Model from '../../../../fixtures/test-inputs/af3/toy_model.cif?raw';
import af3Confidences from '../../../../fixtures/test-inputs/af3/toy_confidences.json?raw';
import af3Summary from '../../../../fixtures/test-inputs/af3/toy_summary_confidences.json?raw';
import colabfoldModel from '../../../../fixtures/test-inputs/colabfold/toy_ranked_0.pdb?raw';
import colabfoldScores from '../../../../fixtures/test-inputs/colabfold/toy_scores.json?raw';
import colabfoldMultimerModel from '../../../../fixtures/test-inputs/colabfold-multimer/toy_multimer_unrelaxed_rank_001.pdb?raw';
import colabfoldMultimerScores from '../../../../fixtures/test-inputs/colabfold-multimer/toy_multimer_scores.json?raw';
import type { ViewerFileRef } from '../../domain/project-types';

const FIXTURE_TEXT_BY_PATH: Record<string, string> = {
  'fixtures/examples/AF-Q14145-F1-model_v6.cif': afQ14145Model,
  'fixtures/examples/AF-Q14145-F1-predicted_aligned_error_v6.json': afQ14145Pae,
  'fixtures/examples/AF-O15552-F1-model_v6.pdb': afO15552Model,
  'fixtures/examples/AF-O15552-F1-predicted_aligned_error_v6.json': afO15552Pae,
  'fixtures/examples/AF-0000000066503175-model_v1.pdb': af66503175Model,
  'fixtures/examples/AF-0000000066503175-predicted_aligned_error_v1.json': af66503175Pae,
  'fixtures/examples/5_MDM2-A-binder_l16_s253144_mpnn1_model1.pdb': mdm2BinderModel,
  'fixtures/examples/l73.pdb': l73Model,
  'fixtures/examples/l73.json': l73Scores,
  'fixtures/examples/l77_s858427_mpnn2_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_002.pdb': l77Model,
  'fixtures/examples/l77_s858427_mpnn2_scores_rank_001_alphafold2_ptm_model_1_seed_002.json': l77Scores,
  'fixtures/test-inputs/af3/toy_model.cif': af3Model,
  'fixtures/test-inputs/af3/toy_confidences.json': af3Confidences,
  'fixtures/test-inputs/af3/toy_summary_confidences.json': af3Summary,
  'fixtures/test-inputs/colabfold/toy_ranked_0.pdb': colabfoldModel,
  'fixtures/test-inputs/colabfold/toy_scores.json': colabfoldScores,
  'fixtures/test-inputs/colabfold-multimer/toy_multimer_unrelaxed_rank_001.pdb': colabfoldMultimerModel,
  'fixtures/test-inputs/colabfold-multimer/toy_multimer_scores.json': colabfoldMultimerScores,
};

export function resolveLocalFixtureText(path: string): string {
  const text = FIXTURE_TEXT_BY_PATH[path];
  if (typeof text !== 'string') {
    throw new Error(`No local fixture text configured for ${path}`);
  }
  return text;
}

export function createLocalFixtureFile(name: string, path: string): ViewerFileRef {
  return {
    name,
    text: resolveLocalFixtureText(path),
  };
}
