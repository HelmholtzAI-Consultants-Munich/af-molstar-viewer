import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { createProjectApi } from '../lib/project/project-api';
import { createToyBundle } from './helpers';
import toyRanked0 from '../../../fixtures/test-inputs/colabfold/toy_ranked_0.pdb?raw';
import toyScores from '../../../fixtures/test-inputs/colabfold/toy_scores.json?raw';

vi.mock('../components/project/ArtifactWorkspace', () => ({
  ArtifactWorkspace: ({
    artifact,
    viewerConfiguration,
    viewerStatePayload,
    selectedResidues,
    focusedResidues,
    onSelectionResiduesChange,
    onFocusResiduesChange,
    onViewerStateChange,
  }: {
    artifact: { artifactId: string };
    viewerConfiguration: 'target' | 'validate_refolding';
    viewerStatePayload?: Record<string, unknown> | null;
    selectedResidues?: number[] | null;
    focusedResidues?: number[] | null;
    onSelectionResiduesChange?: (indices: number[]) => void;
    onFocusResiduesChange?: (indices: number[]) => void;
    onViewerStateChange?: (payload: Record<string, unknown>) => void;
  }) => (
    <div>
      <div data-testid="artifact-workspace">{artifact.artifactId}</div>
      <div data-testid="viewer-configuration">{viewerConfiguration}</div>
      <div data-testid="viewer-state-payload">{JSON.stringify(viewerStatePayload ?? null)}</div>
      <div data-testid="selected-residues">
        {(selectedResidues ?? null) === null ? 'null' : selectedResidues!.join(',')}
      </div>
      <div data-testid="focused-residues">
        {(focusedResidues ?? null) === null ? 'null' : focusedResidues!.join(',')}
      </div>
      <button type="button" onClick={() => onSelectionResiduesChange?.([0, 1, 2])}>
        Mock Molstar selection
      </button>
      <button type="button" onClick={() => onFocusResiduesChange?.([1, 2])}>
        Mock Molstar focus
      </button>
      <button
        type="button"
        onClick={() =>
          onViewerStateChange?.({
            snapshot: {
              camera: { current: { position: [1, 2, 3] } },
              tag: `${artifact.artifactId}-${viewerConfiguration}`,
            },
          })
        }
      >
        Mock viewer state
      </button>
    </div>
  ),
}));

vi.mock('../lib/project/load-viewer-artifact', () => ({
  loadViewerArtifact: async (source: { artifact_id: string; label: string }) => ({
    artifactId: source.artifact_id,
    label: source.label,
    bundle: createToyBundle(),
    structureText: 'ATOM',
  }),
}));

describe('project app shell', () => {
  it('starts empty and lets you upload a target before saving interface residues', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);

    await screen.findByText(/BindCraft Workspace Demo/i);
    expect(screen.getByText(/No targets yet/i)).toBeInTheDocument();

    const fileInput = container.querySelector('input[type="file"][accept=".pdb,.cif,.mmcif,.json"]') as HTMLInputElement;
    await user.upload(fileInput, [
      new File([toyRanked0], 'toy_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'toy_scores.json', { type: 'application/json' }),
    ]);

    const input = await screen.findByPlaceholderText('A1-10,B20-22');
    fireEvent.change(input, { target: { value: 'B20-22,A1-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('A1-10,B20-22')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Load target example')).toBeInTheDocument();
  });

  it('keeps examples available without loading one by default', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    expect(scoped.getByText(/No targets yet/i)).toBeInTheDocument();

    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    await waitFor(() => {
      expect(scoped.getAllByText(/^toy$/i).length).toBeGreaterThan(0);
    });
  });

  it('links Mol* selection to the interface input and shows both selection and focus on the selected target card', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    await waitFor(() => {
      expect(scoped.getAllByText(/^toy$/i).length).toBeGreaterThan(0);
    });

    expect(scoped.getByPlaceholderText('A1-10,B20-22')).toHaveValue('');
    expect(scoped.getByText('Selection: nothing selected')).toBeInTheDocument();
    expect(scoped.getByText('Focus: nothing focussed')).toBeInTheDocument();

    await user.click(scoped.getByRole('button', { name: 'Mock Molstar selection' }));

    await waitFor(() => {
      expect(scoped.getByDisplayValue('A1-3')).toBeInTheDocument();
      expect(scoped.getByText('Selection: A1-3')).toBeInTheDocument();
    });

    await user.click(scoped.getByRole('button', { name: 'Mock Molstar focus' }));

    await waitFor(() => {
      expect(scoped.getByText('Focus: A2-3')).toBeInTheDocument();
    });
  });

  it('shows crop and cut selection tools on the active target card and activates each derived target after the stubbed backend actions', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    await waitFor(() => {
      expect(scoped.getByText('Selection: nothing selected')).toBeInTheDocument();
    });

    expect(scoped.getByRole('button', { name: 'Crop to selection' })).toBeDisabled();
    expect(scoped.getByRole('button', { name: 'Cut off selection' })).toBeDisabled();

    await user.click(scoped.getByRole('button', { name: 'Mock Molstar selection' }));
    await waitFor(() => {
      expect(scoped.getByText('Selection: A1-3')).toBeInTheDocument();
    });

    expect(scoped.getByRole('button', { name: 'Crop to selection' })).toBeEnabled();
    expect(scoped.getByRole('button', { name: 'Cut off selection' })).toBeEnabled();

    await user.click(scoped.getByRole('button', { name: 'Crop to selection' }));
    await waitFor(() => {
      expect(scoped.getByRole('heading', { name: 'toy cropped' })).toBeInTheDocument();
      expect(scoped.getByText('Selection: nothing selected')).toBeInTheDocument();
    });

    await user.click(scoped.getByRole('button', { name: /^toy$/i }));
    await waitFor(() => {
      expect(scoped.getByText('Selection: A1-3')).toBeInTheDocument();
    });

    await user.click(scoped.getByRole('button', { name: 'Cut off selection' }));
    await waitFor(() => {
      expect(scoped.getByRole('heading', { name: 'toy cut' })).toBeInTheDocument();
      expect(scoped.getByText('Selection: nothing selected')).toBeInTheDocument();
    });
  });

  it('keeps in-progress typing stable and maps repeated-chain range syntax into Mol* selection', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    const input = await scoped.findByPlaceholderText('A1-10,B20-22');
    await user.clear(input);
    await user.type(input, 'A10');
    expect(input).toHaveValue('A10');
    expect(scoped.getByTestId('selected-residues')).toHaveTextContent('');

    await user.clear(input);
    await user.type(input, 'A2-A3');
    expect(input).toHaveValue('A2-A3');
    expect(scoped.getByTestId('selected-residues')).toHaveTextContent('1,2');
  });

  it('restores each target interface draft when switching between open targets', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);

    const fileInput = container.querySelector('input[type="file"][accept=".pdb,.cif,.mmcif,.json"]') as HTMLInputElement;
    await user.upload(fileInput, [
      new File([toyRanked0], 'target_alpha_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_alpha_scores.json', { type: 'application/json' }),
    ]);

    const input = await scoped.findByPlaceholderText('A1-10,B20-22');
    await user.clear(input);
    await user.type(input, 'A2-A3');
    expect(input).toHaveValue('A2-A3');
    expect(scoped.getByTestId('selected-residues')).toHaveTextContent('1,2');

    await user.upload(fileInput, [
      new File([toyRanked0], 'target_beta_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_beta_scores.json', { type: 'application/json' }),
    ]);

    const betaInput = await scoped.findByPlaceholderText('A1-10,B20-22');
    expect(betaInput).toHaveValue('');
    await user.type(betaInput, 'A1');
    expect(betaInput).toHaveValue('A1');
    expect(scoped.getByTestId('selected-residues')).toHaveTextContent('0');

    const targetCards = () => [...container.querySelectorAll<HTMLButtonElement>('.artifact-card')];
    await user.click(targetCards()[0]);
    await waitFor(() => {
      expect(scoped.getByDisplayValue('A2-A3')).toBeInTheDocument();
      expect(scoped.getByTestId('selected-residues')).toHaveTextContent('1,2');
    });

    await user.click(targetCards()[1]);
    await waitFor(() => {
      expect(scoped.getByDisplayValue('A1')).toBeInTheDocument();
      expect(scoped.getByTestId('selected-residues')).toHaveTextContent('0');
    });
  });

  it('restores each target focus when switching between open targets', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);

    const fileInput = container.querySelector('input[type="file"][accept=".pdb,.cif,.mmcif,.json"]') as HTMLInputElement;
    await user.upload(fileInput, [
      new File([toyRanked0], 'target_alpha_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_alpha_scores.json', { type: 'application/json' }),
    ]);

    await user.click(scoped.getByRole('button', { name: 'Mock Molstar focus' }));
    await waitFor(() => {
      expect(scoped.getByText('Focus: A2-3')).toBeInTheDocument();
      expect(scoped.getByTestId('focused-residues')).toHaveTextContent('1,2');
    });

    await user.upload(fileInput, [
      new File([toyRanked0], 'target_beta_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_beta_scores.json', { type: 'application/json' }),
    ]);

    expect(scoped.getByText('Focus: nothing focussed')).toBeInTheDocument();
    expect(scoped.getByTestId('focused-residues')).toHaveTextContent('');

    const targetCards = () => [...container.querySelectorAll<HTMLButtonElement>('.artifact-card')];
    await user.click(targetCards()[0]);
    await waitFor(() => {
      expect(scoped.getByText('Focus: A2-3')).toBeInTheDocument();
      expect(scoped.getByTestId('focused-residues')).toHaveTextContent('1,2');
    });
  });

  it('restores per-target viewer snapshots and keeps target and validate-refolding states separate', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);

    const fileInput = container.querySelector('input[type="file"][accept=".pdb,.cif,.mmcif,.json"]') as HTMLInputElement;
    await user.upload(fileInput, [
      new File([toyRanked0], 'target_alpha_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_alpha_scores.json', { type: 'application/json' }),
    ]);

    await user.click(scoped.getByRole('button', { name: 'Mock viewer state' }));
    await waitFor(() => {
      expect(scoped.getByTestId('viewer-state-payload')).toHaveTextContent('"tag":"target-1-target"');
      expect(scoped.getByTestId('viewer-configuration')).toHaveTextContent('target');
    });

    await user.upload(fileInput, [
      new File([toyRanked0], 'target_beta_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_beta_scores.json', { type: 'application/json' }),
    ]);

    expect(scoped.getByTestId('viewer-state-payload')).toHaveTextContent('null');

    const targetCards = () => [...container.querySelectorAll<HTMLButtonElement>('.artifact-card')];
    await user.click(targetCards()[0]);
    await waitFor(() => {
      expect(scoped.getByTestId('viewer-state-payload')).toHaveTextContent('"tag":"target-1-target"');
    });

    const input = scoped.getByPlaceholderText('A1-10,B20-22');
    await user.clear(input);
    await user.type(input, 'A1');

    fireEvent.click(scoped.getByRole('button', { name: /Generate binders/i }));
    await waitFor(() => {
      expect(scoped.getByText(/Binder candidate l73/i)).toBeInTheDocument();
    });

    fireEvent.click(scoped.getByRole('button', { name: /Validate refolding/i }));
    await waitFor(() => {
      expect(scoped.getByLabelText(/Refolded binder l73/i)).toBeInTheDocument();
    });

    fireEvent.click(scoped.getByLabelText(/Refolded binder l73/i));
    await waitFor(() => {
      expect(scoped.getAllByTestId('viewer-configuration').at(-1)).toHaveTextContent('validate_refolding');
      expect(scoped.getAllByTestId('viewer-state-payload').at(-1)).toHaveTextContent('null');
    });
  });

  it('removes a target from the sidebar and falls back to another open target', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);

    const fileInput = container.querySelector('input[type="file"][accept=".pdb,.cif,.mmcif,.json"]') as HTMLInputElement;
    await user.upload(fileInput, [
      new File([toyRanked0], 'target_alpha_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_alpha_scores.json', { type: 'application/json' }),
    ]);
    await user.upload(fileInput, [
      new File([toyRanked0], 'target_beta_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_beta_scores.json', { type: 'application/json' }),
    ]);

    await waitFor(() => {
      expect(scoped.getByRole('button', { name: 'Remove target_beta' })).toBeInTheDocument();
      expect(scoped.getByTestId('artifact-workspace')).toHaveTextContent('target-2');
    });

    await user.click(scoped.getByRole('button', { name: 'Remove target_beta' }));

    await waitFor(() => {
      expect(scoped.queryByRole('button', { name: 'Remove target_beta' })).not.toBeInTheDocument();
      expect(scoped.getByRole('button', { name: 'Remove target_alpha' })).toBeInTheDocument();
      expect(scoped.getByTestId('artifact-workspace')).toHaveTextContent('target-1');
    });
  });
});
