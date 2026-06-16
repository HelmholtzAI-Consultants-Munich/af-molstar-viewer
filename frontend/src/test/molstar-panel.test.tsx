import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MolstarPanel } from '../components/MolstarPanel';
import { PAE_SELECTION_COLORS } from '../lib/constants';
import { SYNC_PAE_INTERACTION_PERFORMANCE } from '../lib/performance';
import { createToyBundle } from './helpers';

const selectionModeNextSpy = vi.fn();
const createObjectURLSpy = vi.fn(() => 'blob:mock');
const revokeObjectURLSpy = vi.fn();
const viewerInstances: Array<{
  visual: {
    select: { mock: { calls: Array<[Record<string, unknown>]> } };
    sequenceColor: { mock: { calls: Array<[Record<string, unknown>]> } };
    interactivityFocus: { mock: { calls: Array<[Record<string, unknown>]> } };
  };
  plugin: {
    managers: {
      structure: {
        focus: {
          clear: { mock: { calls: unknown[][] } };
          setFromLoci: { mock: { calls: unknown[][] } };
        };
      };
    };
  };
}> = [];

const makeMockLoci = (queries: Array<Record<string, unknown>> = []) => ({
  __mockLoci: true,
  locations: queries.flatMap((query) => {
    const chainId = String(query.label_asym_id ?? '');
    const start = Number(query.beg_auth_seq_id ?? query.end_auth_seq_id ?? 0);
    const end = Number(query.end_auth_seq_id ?? query.beg_auth_seq_id ?? 0);
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => ({
      chainId,
      authSeqId: start + offset,
    }));
  }),
});

vi.mock('pdbe-molstar/lib/helpers.js', () => ({
  QueryHelper: {
    getInteractivityLoci: vi.fn((queries: Array<Record<string, unknown>>) => makeMockLoci(queries)),
  },
}));

vi.mock('molstar/lib/mol-model/structure.js', () => ({
  StructureElement: {
    Loci: {
      is: vi.fn((value: unknown) => Boolean((value as { __mockLoci?: boolean } | null | undefined)?.__mockLoci)),
      isEmpty: vi.fn((value: unknown) => {
        const loci = value as { locations?: unknown[] } | null | undefined;
        return !(loci?.locations?.length ?? 0);
      }),
      forEachLocation: vi.fn((value: unknown, callback: (location: unknown) => void) => {
        const loci = value as { locations?: unknown[] } | null | undefined;
        for (const location of loci?.locations ?? []) {
          callback(location);
        }
      }),
      areEqual: vi.fn((left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)),
    },
  },
  StructureProperties: {
    chain: {
      label_asym_id: vi.fn((location: { chainId?: string } | undefined) => location?.chainId ?? 'A'),
    },
    residue: {
      auth_seq_id: vi.fn((location: { authSeqId?: number } | undefined) => location?.authSeqId ?? 1),
    },
  },
}));

vi.mock('molstar/lib/mol-plugin/behavior/dynamic/selection/structure-focus-representation.js', () => ({
  StructureFocusRepresentation: {
    id: 'structure-focus-representation',
  },
}));

vi.mock('molstar/lib/mol-plugin/commands.js', () => ({
  PluginCommands: {
    State: {
      Snapshots: {
        DownloadToFile: vi.fn(async () => undefined),
      },
    },
  },
}));

vi.mock('pdbe-molstar/lib/viewer.js', () => {
  class MockPDBeMolstarPlugin {
    static UIComponents = {
      SequenceView: 'SequenceView',
      PDBeViewport: 'PDBeViewport',
    };

    selectionMode = false;

    visual = {
      sequenceColor: vi.fn(async () => undefined),
      select: vi.fn(async () => undefined),
      clearSelection: vi.fn(async () => undefined),
      highlight: vi.fn(async () => undefined),
      clearHighlight: vi.fn(async () => undefined),
      interactivityFocus: vi.fn(async () => undefined),
    };

    plugin = {
      behaviors: {
        interaction: {
          selectionMode: {
            next: selectionModeNextSpy,
            subscribe: vi.fn((callback: (enabled: boolean) => void) => {
              callback(true);
              callback(false);
              return { unsubscribe: vi.fn() };
            }),
          },
        },
      },
      managers: {
        structure: {
          hierarchy: {
            selection: {
              structures: [
                {
                  cell: {
                    obj: {
                      data: {},
                    },
                  },
                  components: [],
                },
              ],
            },
          },
          component: {
            setOptions: vi.fn(async () => undefined),
            state: {
              options: {},
            },
          },
          focus: {
            clear: vi.fn(() => undefined),
            setFromLoci: vi.fn((loci: unknown) => {
              this.plugin.managers.structure.focus.current.loci = loci;
              return undefined;
            }),
            current: {
              loci: null,
            },
            behaviors: {
              current: {
                subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
              },
            },
          },
          selection: {
            clear: vi.fn(() => undefined),
            fromLoci: vi.fn(() => undefined),
            getLoci: vi.fn(() => null),
            events: {
              changed: {
                subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
              },
            },
          },
        },
      },
      state: {
        behaviors: {
          cells: {
            get: vi.fn(() => ({
              params: {
                values: {
                  components: ['target'],
                },
              },
            })),
          },
        },
        data: {
          build: vi.fn(() => ({
            to: vi.fn(() => ({
              update: vi.fn(() => ({
                commit: vi.fn(async () => undefined),
              })),
            })),
          })),
        },
        getSnapshot: vi.fn(() => null),
        setSnapshot: vi.fn(async () => undefined),
      },
      canvas3d: {
        props: {
          renderer: {
            light: [],
          },
          postprocessing: {},
        },
        setProps: vi.fn(() => undefined),
        camera: {
          stateChanged: {
            subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
          },
        },
      },
      runTask: vi.fn(async (task: unknown) => task),
    };

    render = vi.fn(async () => undefined);

    constructor() {
      viewerInstances.push(this);
    }
  }

  return {
    PDBeMolstarPlugin: MockPDBeMolstarPlugin,
  };
});

describe('MolstarPanel', () => {
  beforeEach(() => {
    selectionModeNextSpy.mockClear();
    createObjectURLSpy.mockClear();
    revokeObjectURLSpy.mockClear();
    Object.defineProperty(window.URL, 'createObjectURL', {
      value: createObjectURLSpy,
      configurable: true,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      value: revokeObjectURLSpy,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    viewerInstances.length = 0;
  });

  it('forwards an early selection-mode change once the panel becomes ready', async () => {
    const bundle = createToyBundle();
    const onSelectionModeChange = vi.fn();
    const onSelectionIndicesChange = vi.fn();
    const onFocusIndicesChange = vi.fn();
    const onViewerStateChange = vi.fn();
    const onHoverResidue = vi.fn();
    const onClickResidue = vi.fn();

    render(
      <MolstarPanel
        viewerConfiguration="target"
        viewerStatePayload={null}
        selectionDraft=""
        bundle={bundle}
        structureText="ATOM"
        selectedResidues={null}
        draftFocused={false}
        selectionModeEnabled={false}
        selectionSyncNonce={0}
        focusedResidues={null}
        hoveredResidues={[]}
        pinnedResidues={[]}
        pinnedCell={null}
        brushSelection={null}
        onHoverResidue={onHoverResidue}
        onClickResidue={onClickResidue}
        onSelectionResiduesChange={onSelectionIndicesChange}
        onSelectionModeChange={onSelectionModeChange}
        onFocusResiduesChange={onFocusIndicesChange}
        onViewerStateChange={onViewerStateChange}
        onNativeViewerStateDownloadReady={vi.fn()}
        colorByPLDDTToggleStatus={true}
        colorByPLDDTEnabled={true}
      />,
    );

    await waitFor(() => {
      expect(onSelectionModeChange).toHaveBeenCalledTimes(1);
    });
    expect(onSelectionModeChange).toHaveBeenCalledWith(true);
  });

  it('reapplies brush coloring after the viewer finishes mounting', async () => {
    const bundle = createToyBundle();

    render(
      <MolstarPanel
        viewerConfiguration="target"
        viewerStatePayload={null}
        selectionDraft=""
        bundle={bundle}
        structureText="ATOM"
        selectedResidues={null}
        draftFocused={false}
        selectionModeEnabled={false}
        selectionSyncNonce={0}
        focusedResidues={null}
        hoveredResidues={[]}
        pinnedResidues={[]}
        pinnedCell={null}
        brushSelection={{ xStart: 0, xEnd: 1, yStart: 0, yEnd: 1 }}
        onHoverResidue={vi.fn()}
        onClickResidue={vi.fn()}
        onSelectionResiduesChange={vi.fn()}
        onSelectionModeChange={vi.fn()}
        onFocusResiduesChange={vi.fn()}
        onViewerStateChange={vi.fn()}
        onNativeViewerStateDownloadReady={vi.fn()}
        colorByPLDDTToggleStatus={true}
        colorByPLDDTEnabled={true}
      />,
    );

    await waitFor(() => {
      expect(
        viewerInstances.at(-1)?.visual.select.mock.calls.some(([call]) => {
          const payload = call as { data?: unknown[]; nonSelectedColor?: string };
          return Array.isArray(payload.data) && payload.nonSelectedColor === PAE_SELECTION_COLORS.dimmed;
        }),
      ).toBe(true);
    });

    expect(
      viewerInstances.at(-1)?.visual.sequenceColor.mock.calls.some(([call]) => {
        const payload = call as { data?: unknown[]; nonSelectedColor?: string };
        return Array.isArray(payload.data) && payload.nonSelectedColor === PAE_SELECTION_COLORS.dimmed;
      }),
    ).toBe(true);
  });

  it('reapplies restored focus after switching away from and back to a target', async () => {
    const bundle = createToyBundle();

    const { rerender } = render(
      <MolstarPanel
        viewerConfiguration="target"
        viewerStatePayload={null}
        selectionDraft=""
        bundle={bundle}
        structureText="ATOM"
        selectedResidues={null}
        draftFocused={false}
        selectionModeEnabled={false}
        selectionSyncNonce={0}
        focusedResidues={[1, 2]}
        hoveredResidues={[]}
        pinnedResidues={[]}
        pinnedCell={null}
        brushSelection={null}
        onHoverResidue={vi.fn()}
        onClickResidue={vi.fn()}
        onSelectionResiduesChange={vi.fn()}
        onSelectionModeChange={vi.fn()}
        onFocusResiduesChange={vi.fn()}
        onViewerStateChange={vi.fn()}
        onNativeViewerStateDownloadReady={vi.fn()}
        colorByPLDDTToggleStatus={true}
        colorByPLDDTEnabled={true}
      />,
    );

    await waitFor(() => {
      expect(viewerInstances).toHaveLength(1);
      expect(viewerInstances.at(-1)?.plugin.managers.structure.focus.setFromLoci).toHaveBeenCalled();
      expect(
        viewerInstances.at(-1)?.visual.interactivityFocus.mock.calls.some(([call]) => {
          const payload = call as { data?: Array<{ focus?: boolean }> };
          return Array.isArray(payload.data) && payload.data.every((query) => query.focus === true);
        }),
      ).toBe(true);
    });

    rerender(
      <MolstarPanel
        viewerConfiguration="target"
        viewerStatePayload={null}
        selectionDraft=""
        bundle={createToyBundle()}
        structureText="ATOM"
        selectedResidues={null}
        draftFocused={false}
        selectionModeEnabled={false}
        selectionSyncNonce={0}
        focusedResidues={null}
        hoveredResidues={[]}
        pinnedResidues={[]}
        pinnedCell={null}
        brushSelection={null}
        onHoverResidue={vi.fn()}
        onClickResidue={vi.fn()}
        onSelectionResiduesChange={vi.fn()}
        onSelectionModeChange={vi.fn()}
        onFocusResiduesChange={vi.fn()}
        onViewerStateChange={vi.fn()}
        onNativeViewerStateDownloadReady={vi.fn()}
        colorByPLDDTToggleStatus={true}
        colorByPLDDTEnabled={true}
      />,
    );

    await waitFor(() => {
      expect(viewerInstances).toHaveLength(2);
    });

    rerender(
      <MolstarPanel
        viewerConfiguration="target"
        viewerStatePayload={null}
        selectionDraft=""
        bundle={createToyBundle()}
        structureText="ATOM"
        selectedResidues={null}
        draftFocused={false}
        selectionModeEnabled={false}
        selectionSyncNonce={0}
        focusedResidues={[1, 2]}
        hoveredResidues={[]}
        pinnedResidues={[]}
        pinnedCell={null}
        brushSelection={null}
        onHoverResidue={vi.fn()}
        onClickResidue={vi.fn()}
        onSelectionResiduesChange={vi.fn()}
        onSelectionModeChange={vi.fn()}
        onFocusResiduesChange={vi.fn()}
        onViewerStateChange={vi.fn()}
        onNativeViewerStateDownloadReady={vi.fn()}
        colorByPLDDTToggleStatus={true}
        colorByPLDDTEnabled={true}
      />,
    );

    await waitFor(() => {
      expect(viewerInstances).toHaveLength(3);
      expect(viewerInstances.at(-1)?.plugin.managers.structure.focus.setFromLoci).toHaveBeenCalled();
      expect(
        viewerInstances.at(-1)?.visual.interactivityFocus.mock.calls.some(([call]) => {
          const payload = call as { data?: Array<{ focus?: boolean }> };
          return Array.isArray(payload.data) && payload.data.every((query) => query.focus === true);
        }),
      ).toBe(true);
    });
  });

  it('reapplies restored focus even when brush coloring is active', async () => {
    const bundle = createToyBundle();

    render(
      <MolstarPanel
        viewerConfiguration="target"
        viewerStatePayload={null}
        selectionDraft=""
        bundle={bundle}
        structureText="ATOM"
        selectedResidues={null}
        draftFocused={false}
        selectionModeEnabled={false}
        selectionSyncNonce={0}
        focusedResidues={[1, 2]}
        hoveredResidues={[]}
        pinnedResidues={[]}
        pinnedCell={null}
        brushSelection={{ xStart: 0, xEnd: 1, yStart: 0, yEnd: 1 }}
        onHoverResidue={vi.fn()}
        onClickResidue={vi.fn()}
        onSelectionResiduesChange={vi.fn()}
        onSelectionModeChange={vi.fn()}
        onFocusResiduesChange={vi.fn()}
        onViewerStateChange={vi.fn()}
        onNativeViewerStateDownloadReady={vi.fn()}
        colorByPLDDTToggleStatus={true}
        colorByPLDDTEnabled={true}
      />,
    );

    await waitFor(() => {
      expect(viewerInstances).toHaveLength(1);
      expect(
        viewerInstances.at(-1)?.visual.interactivityFocus.mock.calls.some(([call]) => {
          const payload = call as { data?: Array<{ focus?: boolean }> };
          return Array.isArray(payload.data) && payload.data.every((query) => query.focus === true);
        }),
      ).toBe(true);
    });
  });
});
