import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPage } from '../pages/ProjectPage';
import { createProjectApi } from '../lib/project/project-api';
import { createToyBundle } from './helpers';
import toyRanked0 from '../../../fixtures/test-inputs/colabfold/toy_ranked_0.pdb?raw';
import toyScores from '../../../fixtures/test-inputs/colabfold/toy_scores.json?raw';

const nativeViewerDownloadSpy = vi.fn();

vi.mock('../features/project/ArtifactWorkspace', () => ({
  ArtifactWorkspace: ({
    artifact,
    viewerConfiguration,
    viewerStatePayload,
    selectionIndices,
    focusIndices,
    draftFocused,
    selectionEnabled,
    selectionSyncNonce,
    onSelectionIndicesChange,
    onFocusIndicesChange,
    onSelectionModeChange,
    onViewerStateChange,
    onNativeViewerStateDownloadReady,
  }: {
    artifact: { artifactId: string };
    viewerConfiguration: 'target' | 'validate_refolding';
    viewerStatePayload?: Record<string, unknown> | null;
    selectionIndices?: number[] | null;
    focusIndices?: number[] | null;
    draftFocused?: boolean;
    selectionEnabled?: boolean;
    selectionSyncNonce?: number;
    onSelectionIndicesChange?: (indices: number[]) => void;
    onFocusIndicesChange?: (indices: number[]) => void;
    onSelectionModeChange?: (enabled: boolean) => void;
    onViewerStateChange?: (payload: Record<string, unknown>) => void;
    onNativeViewerStateDownloadReady?: (download: (() => void) | null) => void;
  }) => (
    <div>
      <div data-testid="artifact-workspace">{artifact.artifactId}</div>
      <div data-testid="viewer-configuration">{viewerConfiguration}</div>
      <div data-testid="viewer-state-payload">{JSON.stringify(viewerStatePayload ?? null)}</div>
      <div data-testid="selected-residues">
        {(selectionIndices ?? null) === null ? 'null' : selectionIndices!.join(',')}
      </div>
      <div data-testid="focused-residues">
        {(focusIndices ?? null) === null ? 'null' : focusIndices!.join(',')}
      </div>
      <button type="button" onClick={() => onSelectionIndicesChange?.([0, 1, 2])}>
        Mock Molstar selection
      </button>
      <button type="button" onClick={() => onSelectionModeChange?.(false)}>
        Mock selection mode off
      </button>
      <button type="button" onClick={() => onSelectionModeChange?.(true)}>
        Mock selection mode on
      </button>
      <button type="button" onClick={() => onFocusIndicesChange?.([1, 2])}>
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
      <button type="button" onClick={() => onNativeViewerStateDownloadReady?.(nativeViewerDownloadSpy)}>
        Mock native download ready
      </button>
    </div>
  ),
}));

vi.mock('../services/project/load-viewer-artifact', () => ({
  loadViewerArtifact: async (source: { artifact_id: string; label: string }) => ({
    artifactId: source.artifact_id,
    label: source.label,
    bundle: createToyBundle(),
    structureText: 'ATOM',
  }),
}));

describe('project app shell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    nativeViewerDownloadSpy.mockClear();
  });

  const getTargetInterfaceScope = (root: HTMLElement) =>
    within((within(root).getByRole('heading', { name: 'Target Interface' }).closest('section') as HTMLElement));

  it('starts empty and lets you upload a target before saving interface residues', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);

    await screen.findByText(/BindCraft Workspace Demo/i);
    expect(screen.getByText(/No targets yet/i)).toBeInTheDocument();

    const fileInput = container.querySelector('input[type="file"][accept=".pdb,.cif,.mmcif,.json"]') as HTMLInputElement;
    await user.upload(fileInput, [
      new File([toyRanked0], 'toy_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'toy_scores.json', { type: 'application/json' }),
    ]);

    const input = await screen.findByPlaceholderText('A1-10,B20-22');
    fireEvent.change(input, { target: { value: 'B20-22,A1-10' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByDisplayValue('A1-3')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Load target example')).toBeInTheDocument();
  });

  it('keeps examples available without loading one by default', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    expect(scoped.getByText(/No targets yet/i)).toBeInTheDocument();

    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    await waitFor(() => {
      expect(scoped.getAllByText(/^toy_ranked_0\.pdb$/i).length).toBeGreaterThan(0);
    });
  });

  it('links Mol* selection to the interface input and shows both selection and focus on the selected target card', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    await waitFor(() => {
      expect(scoped.getAllByText(/^toy_ranked_0\.pdb$/i).length).toBeGreaterThan(0);
    });

    expect(getTargetInterfaceScope(container).getByPlaceholderText('A1-10,B20-22')).toHaveValue('');
    expect(scoped.getByTestId('selected-residues')).toHaveTextContent('null');
    expect(scoped.getByTestId('focused-residues')).toHaveTextContent('');

    await user.click(scoped.getByRole('button', { name: 'Mock Molstar selection' }));

    await waitFor(() => {
      expect(getTargetInterfaceScope(container).getByDisplayValue('A1-3')).toBeInTheDocument();
      expect(scoped.getByTestId('selected-residues')).toHaveTextContent('0,1,2');
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
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    await waitFor(() => {
      expect(getTargetInterfaceScope(container).getByPlaceholderText('A1-10,B20-22')).toHaveValue('');
      expect(scoped.getByTestId('selected-residues')).toHaveTextContent('null');
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
      expect(scoped.getByRole('heading', { name: 'toy_ranked_0_cropped_1.pdb' })).toBeInTheDocument();
      expect(getTargetInterfaceScope(container).getByPlaceholderText('A1-10,B20-22')).toHaveValue('');
      expect(scoped.getByTestId('selected-residues')).toHaveTextContent('null');
    });

    await user.click(scoped.getByRole('button', { name: /^toy_ranked_0\.pdb$/i }));
    await waitFor(() => {
      expect(scoped.getByText('Selection: A1-3')).toBeInTheDocument();
    });

    await user.click(scoped.getByRole('button', { name: 'Cut off selection' }));
    await waitFor(() => {
      expect(scoped.getByRole('heading', { name: 'toy_ranked_0_cut_1.pdb' })).toBeInTheDocument();
      expect(getTargetInterfaceScope(container).getByPlaceholderText('A1-10,B20-22')).toHaveValue('');
      expect(scoped.getByTestId('selected-residues')).toHaveTextContent('null');
    });
  });

  it('keeps in-progress typing stable and maps repeated-chain range syntax into Mol* selection', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    const input = await getTargetInterfaceScope(container).findByPlaceholderText('A1-10,B20-22');
    await user.clear(input);
    await user.type(input, 'A10');
    expect(input).toHaveValue('A10');

    await user.clear(input);
    await user.type(input, 'A2-A3');
    expect(input).toHaveValue('A2-A3');
  });

  it('keeps the current selection draft when Mol* selection mode is toggled and still accepts a later selection update', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    const input = await getTargetInterfaceScope(container).findByPlaceholderText('A1-10,B20-22');
    await user.clear(input);
    await user.type(input, 'A2-A3');
    expect(input).toHaveValue('A2-A3');

    await user.click(scoped.getByRole('button', { name: 'Mock selection mode off' }));
    await user.click(scoped.getByRole('button', { name: 'Mock selection mode on' }));
    await user.click(scoped.getByRole('button', { name: 'Mock selection mode off' }));
    await user.click(scoped.getByRole('button', { name: 'Mock selection mode on' }));

    expect(input).toHaveValue('A2-3');

    await user.click(scoped.getByRole('button', { name: 'Mock Molstar selection' }));

    await waitFor(() => {
      expect(getTargetInterfaceScope(container).getByDisplayValue('A1-3')).toBeInTheDocument();
      expect(scoped.getByTestId('selected-residues')).toHaveTextContent('0,1,2');
    });
  });

  it('restores each target interface draft when switching between open targets', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);

    const fileInput = container.querySelector('input[type="file"][accept=".pdb,.cif,.mmcif,.json"]') as HTMLInputElement;
    await user.upload(fileInput, [
      new File([toyRanked0], 'target_alpha_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_alpha_scores.json', { type: 'application/json' }),
    ]);

    const input = await getTargetInterfaceScope(container).findByPlaceholderText('A1-10,B20-22');
    await user.clear(input);
    await user.type(input, 'A2-A3');
    expect(input).toHaveValue('A2-A3');

    await user.upload(fileInput, [
      new File([toyRanked0], 'target_beta_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_beta_scores.json', { type: 'application/json' }),
    ]);

    const betaInput = await getTargetInterfaceScope(container).findByPlaceholderText('A1-10,B20-22');
    expect(betaInput).toHaveValue('');
    await user.type(betaInput, 'A1');
    expect(betaInput).toHaveValue('A1');

    const targetCards = () => [...container.querySelectorAll<HTMLButtonElement>('.artifact-card')];
    await user.click(targetCards()[0]);
    await waitFor(() => {
      expect(getTargetInterfaceScope(container).getByDisplayValue('A2-3')).toBeInTheDocument();
    });

    await user.click(targetCards()[1]);
    await waitFor(() => {
      expect(getTargetInterfaceScope(container).getByDisplayValue('A1')).toBeInTheDocument();
    });
  });

  it('restores each target focus when switching between open targets', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
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
    const { container } = render(<ProjectPage api={api} />);
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

    const input = getTargetInterfaceScope(container).getByPlaceholderText('A1-10,B20-22');
    await user.clear(input);
    await user.type(input, 'A1');

    fireEvent.click(scoped.getByRole('button', { name: /Generate binders/i }));
    await waitFor(async () => {
      const refreshed = await api.getProject('project-1');
      expect(refreshed.binder_candidates).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Binder candidate l73' })]),
      );
    });
  });

  it('shows download structure and Mol* state actions under the cut-off button for the selected target', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);

    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(window.URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const fileInput = container.querySelector('input[type="file"][accept=".pdb,.cif,.mmcif,.json"]') as HTMLInputElement;
    await user.upload(fileInput, [
      new File([toyRanked0], 'target_alpha_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_alpha_scores.json', { type: 'application/json' }),
    ]);

    await user.click(scoped.getByRole('button', { name: 'Mock native download ready' }));

    await user.click(scoped.getByRole('button', { name: 'Mock viewer state' }));
    await waitFor(() => {
      expect(scoped.getByTestId('viewer-state-payload')).toHaveTextContent('"tag":"target-1-target"');
    });

    await user.click(scoped.getByRole('button', { name: /download structure/i }));
    await user.click(scoped.getByRole('button', { name: /download mol\* session/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(nativeViewerDownloadSpy).toHaveBeenCalledTimes(1);
  });

  it('removes a target from the sidebar and falls back to another open target', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
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
      expect(scoped.getByRole('button', { name: 'Remove target_beta_ranked_0.pdb' })).toBeInTheDocument();
      expect(scoped.getByTestId('artifact-workspace')).toHaveTextContent('target-2');
    });

    await user.click(scoped.getByRole('button', { name: 'Remove target_beta_ranked_0.pdb' }));

    await waitFor(() => {
      expect(scoped.queryByRole('button', { name: 'Remove target_beta_ranked_0.pdb' })).not.toBeInTheDocument();
      expect(scoped.getByRole('button', { name: 'Remove target_alpha_ranked_0.pdb' })).toBeInTheDocument();
      expect(scoped.getByTestId('artifact-workspace')).toHaveTextContent('target-1');
    });
  });
});
