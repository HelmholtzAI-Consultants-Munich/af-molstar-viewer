import { createLocalFixtureFile } from '../lib/project/local-fixture-files';

export interface ExampleDefinition {
  id: string;
  label: string;
  files: Array<{ name: string; url?: string; text?: string }>;
}

export const EXAMPLES: ExampleDefinition[] = [
  {
    id: 'afdb-Q14145',
    label: 'AlphaFold DB Q14145',
    files: [
      createLocalFixtureFile('AF-Q14145-F1-model_v6.cif', 'fixtures/examples/AF-Q14145-F1-model_v6.cif'),
      createLocalFixtureFile(
        'AF-Q14145-F1-predicted_aligned_error_v6.json',
        'fixtures/examples/AF-Q14145-F1-predicted_aligned_error_v6.json',
      ),
    ],
  },
  {
    id: 'afdb-O15552',
    label: 'AlphaFold DB O15552',
    files: [
      createLocalFixtureFile('AF-O15552-F1-model_v6.pdb', 'fixtures/examples/AF-O15552-F1-model_v6.pdb'),
      createLocalFixtureFile(
        'AF-O15552-F1-predicted_aligned_error_v6.json',
        'fixtures/examples/AF-O15552-F1-predicted_aligned_error_v6.json',
      ),
    ],
  },
  {
    id: 'afdb-66503175',
    label: 'AlphaFold DB AF-0000000066503175',
    files: [
      createLocalFixtureFile('AF-0000000066503175-model_v1.pdb', 'fixtures/examples/AF-0000000066503175-model_v1.pdb'),
      createLocalFixtureFile(
        'AF-0000000066503175-predicted_aligned_error_v1.json',
        'fixtures/examples/AF-0000000066503175-predicted_aligned_error_v1.json',
      ),
    ],
  },
  {
    id: 'cfdb-mdm2',
    label: 'ColabFold MDM2 binder pair, no pAE',
    files: [
      createLocalFixtureFile(
        '5_MDM2-A-binder_l16_s253144_mpnn1_model1.pdb',
        'fixtures/examples/5_MDM2-A-binder_l16_s253144_mpnn1_model1.pdb',
      ),
    ],
  },
  {
    id: 'colabfold',
    label: 'ColabFold Monomer Fixture',
    files: [
      createLocalFixtureFile('toy_ranked_0.pdb', 'fixtures/test-inputs/colabfold/toy_ranked_0.pdb'),
      createLocalFixtureFile('toy_scores.json', 'fixtures/test-inputs/colabfold/toy_scores.json'),
    ],
  },
  {
    id: 'af3',
    label: 'AlphaFold 3 Polymer Fixture',
    files: [
      createLocalFixtureFile('toy_model.cif', 'fixtures/test-inputs/af3/toy_model.cif'),
      createLocalFixtureFile('toy_confidences.json', 'fixtures/test-inputs/af3/toy_confidences.json'),
      createLocalFixtureFile('toy_summary_confidences.json', 'fixtures/test-inputs/af3/toy_summary_confidences.json'),
    ],
  },
];
