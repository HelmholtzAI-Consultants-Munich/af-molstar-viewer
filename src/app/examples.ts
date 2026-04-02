export interface ExampleDefinition {
  id: string;
  label: string;
  files: Array<{ name: string; url: string }>;
}

export const EXAMPLES: ExampleDefinition[] = [
  {
    id: 'afdb',
    label: 'AlphaFold DB Example',
    files: [
      {
        name: 'AF-Q14145-F1-model_v6.cif',
        url: new URL('../../example/AF-Q14145-F1-model_v6.cif', import.meta.url).href,
      },
      {
        name: 'AF-Q14145-F1-predicted_aligned_error_v6.json',
        url: new URL('../../example/AF-Q14145-F1-predicted_aligned_error_v6.json', import.meta.url).href,
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
