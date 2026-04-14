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
    selectedResidues,
    focusedResidues,
    onSelectionResiduesChange,
    onFocusResiduesChange,
  }: {
    artifact: { artifactId: string };
    selectedResidues?: number[] | null;
    focusedResidues?: number[] | null;
    onSelectionResiduesChange?: (indices: number[]) => void;
    onFocusResiduesChange?: (indices: number[]) => void;
  }) => (
    <div>
      <div data-testid="artifact-workspace">{artifact.artifactId}</div>
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

  it('links Mol* selection to the interface input and Mol* focus to the selected target card', async () => {
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
    expect(scoped.getByText('Focus: No Mol* focus')).toBeInTheDocument();

    await user.click(scoped.getByRole('button', { name: 'Mock Molstar selection' }));

    await waitFor(() => {
      expect(scoped.getByDisplayValue('A1-3')).toBeInTheDocument();
    });

    await user.click(scoped.getByRole('button', { name: 'Mock Molstar focus' }));

    await waitFor(() => {
      expect(scoped.getByText('Focus: A2-3')).toBeInTheDocument();
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

    expect(scoped.getByText('Focus: No Mol* focus')).toBeInTheDocument();
    expect(scoped.getByTestId('focused-residues')).toHaveTextContent('');

    const targetCards = () => [...container.querySelectorAll<HTMLButtonElement>('.artifact-card')];
    await user.click(targetCards()[0]);
    await waitFor(() => {
      expect(scoped.getByText('Focus: A2-3')).toBeInTheDocument();
      expect(scoped.getByTestId('focused-residues')).toHaveTextContent('1,2');
    });
  });
});
