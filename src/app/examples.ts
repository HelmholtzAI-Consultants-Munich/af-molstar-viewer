export interface ExampleDefinition {
  id: string;
  label: string;
  files: Array<{ name: string; url: string }>;
}

export const EXAMPLES: ExampleDefinition[] = [
  {
    id: 'afdb-Q14145',
    label: 'AlphaFold DB Q14145',
    files: [
      {
        name: 'AF-Q14145-F1-model_v6.cif',
        url: new URL('../../fixtures/examples/AF-Q14145-F1-model_v6.cif', import.meta.url).href,
      },
      {
        name: 'AF-Q14145-F1-predicted_aligned_error_v6.json',
        url: new URL('../../fixtures/examples/AF-Q14145-F1-predicted_aligned_error_v6.json', import.meta.url).href,
      },
    ],
  },
  {
    id: 'afdb-O15552',
    label: 'AlphaFold DB O15552',
    files: [
      {
        name: 'AF-O15552-F1-model_v6.pdb',
        url: new URL('../../fixtures/examples/AF-O15552-F1-model_v6.pdb', import.meta.url).href,
      },
      {
        name: 'AF-O15552-F1-predicted_aligned_error_v6.json',
        url: new URL('../../fixtures/examples/AF-O15552-F1-predicted_aligned_error_v6.json', import.meta.url).href,
      },
    ],
  },
  {
    id: 'afdb-66503175',
    label: 'AlphaFold DB AF-0000000066503175',
    files: [
      {
        name: 'AF-0000000066503175-model_v1.pdb',
        url: new URL('../../fixtures/examples/AF-0000000066503175-model_v1.pdb', import.meta.url).href,
      },
      {
        name: 'AF-0000000066503175-predicted_aligned_error_v1.json',
        url: new URL('../../fixtures/examples/AF-0000000066503175-predicted_aligned_error_v1.json', import.meta.url).href,
      },
    ],
  },
  {
    id: 'cfdb-mdm2',
    label: 'ColabFold MDM2 binder pair, no pAE',
    files: [
      {
        name: '5_MDM2-A-binder_l16_s253144_mpnn1_model1.pdb',
        url: new URL('../../fixtures/examples/5_MDM2-A-binder_l16_s253144_mpnn1_model1.pdb', import.meta.url).href,
      },
    ],
  },
  {
    id: 'colabfold',
    label: 'ColabFold Monomer Fixture',
    files: [
      {
        name: 'toy_ranked_0.pdb',
        url: new URL('../test/fixtures/colabfold/toy_ranked_0.pdb', import.meta.url).href,
      },
      {
        name: 'toy_scores.json',
        url: new URL('../test/fixtures/colabfold/toy_scores.json', import.meta.url).href,
      },
    ],
  },
  {
    id: 'af3',
    label: 'AlphaFold 3 Polymer Fixture',
    files: [
      {
        name: 'toy_model.cif',
        url: new URL('../test/fixtures/af3/toy_model.cif', import.meta.url).href,
      },
      {
        name: 'toy_confidences.json',
        url: new URL('../test/fixtures/af3/toy_confidences.json', import.meta.url).href,
      },
      {
        name: 'toy_summary_confidences.json',
        url: new URL('../test/fixtures/af3/toy_summary_confidences.json', import.meta.url).href,
      },
    ],
  },
];
