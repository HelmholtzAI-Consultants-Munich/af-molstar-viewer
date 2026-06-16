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
  PAE_HOVER_SYNC_RESIDUE_THRESHOLD: 800,
  ArtifactWorkspace: ({
    artifact,
    viewerConfiguration,
    viewerStatePayload,
    selectionIndices,
    focusIndices,
    draftFocused,
    selectionEnabled,
    selectionSyncNonce,
    brushSelection,
    pinnedResidues,
    pinnedCell,
    paeHoverSyncEnabled,
    paePairSelectionEnabled,
    onSelectionIndicesChange,
    onFocusIndicesChange,
    onSelectionModeChange,
    onBrushSelectionChange,
    onPinResidues,
    onPinCell,
    onTogglePaeHoverSync,
    onTogglePaePairSelection,
    onClearPairSelection,
    onViewerStateChange,
    onNativeViewerStateDownloadReady,
    onImportPaeData,
  }: {
    artifact: { artifactId: string };
    viewerConfiguration: 'target' | 'validate_refolding';
    viewerStatePayload?: Record<string, unknown> | null;
    selectionIndices?: number[] | null;
    focusIndices?: number[] | null;
    draftFocused?: boolean;
    selectionEnabled?: boolean;
    selectionSyncNonce?: number;
    brushSelection?: { xStart: number; xEnd: number; yStart: number; yEnd: number } | null;
    pinnedResidues?: number[];
    pinnedCell?: { x: number; y: number } | null;
    paeHoverSyncEnabled?: boolean;
    paePairSelectionEnabled?: boolean;
    onSelectionIndicesChange?: (indices: number[]) => void;
    onFocusIndicesChange?: (indices: number[]) => void;
    onSelectionModeChange?: (enabled: boolean) => void;
    onBrushSelectionChange?: (selection: { xStart: number; xEnd: number; yStart: number; yEnd: number } | null) => void;
    onPinResidues?: (indices: number[]) => void;
    onPinCell?: (cell: { x: number; y: number } | null) => void;
    onTogglePaeHoverSync?: () => void;
    onTogglePaePairSelection?: () => void;
    onClearPairSelection?: () => void;
    onViewerStateChange?: (payload: Record<string, unknown>) => void;
    onNativeViewerStateDownloadReady?: (download: (() => void) | null) => void;
    onImportPaeData?: (paeMatrix: number[][], paeMax: number) => void;
  }) => (
    <div>
      <div data-testid="artifact-workspace">{artifact.artifactId}</div>
      <div data-testid="viewer-configuration">{viewerConfiguration}</div>
      <div data-testid="viewer-state-payload">{JSON.stringify(viewerStatePayload ?? null)}</div>
      <div data-testid="brush-selection">{brushSelection ? `${brushSelection.xStart},${brushSelection.xEnd},${brushSelection.yStart},${brushSelection.yEnd}` : 'null'}</div>
      <div data-testid="pinned-residues">{(pinnedResidues ?? []).join(',') || 'null'}</div>
      <div data-testid="pinned-cell">{pinnedCell ? `${pinnedCell.x},${pinnedCell.y}` : 'null'}</div>
      <div data-testid="pae-hover-sync">{String(Boolean(paeHoverSyncEnabled))}</div>
      <div data-testid="pae-pair-selection">{String(Boolean(paePairSelectionEnabled))}</div>
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
      <button type="button" onClick={() => onBrushSelectionChange?.({ xStart: 0, xEnd: 1, yStart: 0, yEnd: 1 })}>
        Mock brush selection
      </button>
      <button type="button" onClick={() => onPinCell?.({ x: 0, y: 1 })}>
        Mock pin cell
      </button>
      <button type="button" onClick={() => onPinResidues?.([0, 1])}>
        Mock pin residues
      </button>
      <button type="button" onClick={() => onTogglePaeHoverSync?.()}>
        Mock pair hover toggle
      </button>
      <button type="button" onClick={() => onTogglePaePairSelection?.()}>
        Mock pair click toggle
      </button>
      <button type="button" onClick={() => onClearPairSelection?.()}>
        Mock clear pair
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
      <button type="button" onClick={() => onImportPaeData?.([[1, 2], [2, 1]], 2)}>
        Mock pAE import
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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
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

  it('keeps pAE brush selection and coloring when switching between targets', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);
    await user.selectOptions(scoped.getByLabelText('Load target example'), 'colabfold');

    await waitFor(() => {
      expect(scoped.getByTestId('artifact-workspace')).toHaveTextContent('target-1');
    });

    await user.click(scoped.getByRole('button', { name: 'Mock brush selection' }));
    await user.click(scoped.getByRole('button', { name: 'Mock pin cell' }));
    await user.click(scoped.getByRole('button', { name: 'Mock pin residues' }));
    await user.click(scoped.getByRole('button', { name: 'Mock pair hover toggle' }));

    expect(scoped.getByTestId('brush-selection')).toHaveTextContent('0,1,0,1');
    expect(scoped.getByTestId('pinned-cell')).toHaveTextContent('0,1');
    expect(scoped.getByTestId('pinned-residues')).toHaveTextContent('0,1');
    expect(scoped.getByTestId('pae-hover-sync')).toHaveTextContent('false');

    const secondUploadInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(secondUploadInput, [
      new File([toyRanked0], 'alt_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'alt_scores.json', { type: 'application/json' }),
    ]);

    await waitFor(() => {
      expect(scoped.getByTestId('artifact-workspace')).toHaveTextContent('target-2');
    });

    expect(scoped.getByTestId('brush-selection')).toHaveTextContent('null');
    expect(scoped.getByTestId('pinned-cell')).toHaveTextContent('null');
    expect(scoped.getByTestId('pinned-residues')).toHaveTextContent('null');
    expect(scoped.getByTestId('pae-hover-sync')).toHaveTextContent('true');

    await user.click(scoped.getByRole('button', { name: /^toy_ranked_0\.pdb$/i }));

    await waitFor(() => {
      expect(scoped.getByTestId('artifact-workspace')).toHaveTextContent('target-1');
    });

    expect(scoped.getByTestId('brush-selection')).toHaveTextContent('0,1,0,1');
    expect(scoped.getByTestId('pinned-cell')).toHaveTextContent('0,1');
    expect(scoped.getByTestId('pinned-residues')).toHaveTextContent('0,1');
    expect(scoped.getByTestId('pae-hover-sync')).toHaveTextContent('false');
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

    expect(scoped.getByRole('button', { name: /crop to selection/i })).toBeDisabled();
    expect(scoped.getByRole('button', { name: /cut off selection/i })).toBeDisabled();

    await user.click(scoped.getByRole('button', { name: 'Mock Molstar selection' }));
    await waitFor(() => {
      expect(scoped.getByText('Selection: A1-3')).toBeInTheDocument();
    });

    expect(scoped.getByRole('button', { name: /crop to selection/i })).toBeEnabled();
    expect(scoped.getByRole('button', { name: /cut off selection/i })).toBeEnabled();

    await user.click(scoped.getByRole('button', { name: /crop to selection/i }));
    await waitFor(() => {
      expect(scoped.getByRole('heading', { name: 'toy_ranked_0_cropped_1.pdb' })).toBeInTheDocument();
      expect(getTargetInterfaceScope(container).getByPlaceholderText('A1-10,B20-22')).toHaveValue('');
      expect(scoped.getByTestId('selected-residues')).toHaveTextContent('null');
    });

    await user.click(scoped.getByRole('button', { name: /^toy_ranked_0\.pdb$/i }));
    await waitFor(() => {
      expect(scoped.getByText('Selection: A1-3')).toBeInTheDocument();
    });

    await user.click(scoped.getByRole('button', { name: /cut off selection/i }));
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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
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

  it('remembers the pLDDT theme choice per target when switching targets', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, [
      new File([toyRanked0], 'target_alpha_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_alpha_scores.json', { type: 'application/json' }),
    ]);

    const themeToggle = () => container.querySelector<HTMLButtonElement>('.artifact-theme-toggle');

    await waitFor(() => {
      expect(themeToggle()).toHaveAttribute('aria-pressed', 'true');
    });

    await user.click(themeToggle()!);
    await waitFor(() => {
      expect(themeToggle()).toHaveAttribute('aria-pressed', 'false');
    });

    await user.upload(fileInput, [
      new File([toyRanked0], 'target_beta_ranked_0.pdb', { type: 'chemical/x-pdb' }),
      new File([toyScores], 'target_beta_scores.json', { type: 'application/json' }),
    ]);

    await waitFor(() => {
      expect(themeToggle()).toHaveAttribute('aria-pressed', 'true');
    });

    const targetCards = () => [...container.querySelectorAll<HTMLButtonElement>('.artifact-card')];
    await user.click(targetCards()[0]);

    await waitFor(() => {
      expect(themeToggle()).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('restores per-target viewer snapshots and keeps target and validate-refolding states separate', async () => {
    const api = createProjectApi();
    const user = userEvent.setup();
    const { container } = render(<ProjectPage api={api} />);
    const scoped = within(container);

    await scoped.findByText(/BindCraft Workspace Demo/i);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
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
