import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MolstarPanel } from '../components/MolstarPanel';
import { SYNC_PAE_INTERACTION_PERFORMANCE } from '../lib/performance';
import { createToyBundle } from './helpers';

const selectionModeNextSpy = vi.fn();
const createObjectURLSpy = vi.fn(() => 'blob:mock');
const revokeObjectURLSpy = vi.fn();

vi.mock('pdbe-molstar/lib/helpers.js', () => ({
  QueryHelper: {
    getInteractivityLoci: vi.fn(() => null),
  },
}));

vi.mock('molstar/lib/mol-model/structure.js', () => ({
  StructureElement: {
    Loci: {
      is: vi.fn(() => false),
      isEmpty: vi.fn(() => true),
      forEachLocation: vi.fn(),
    },
  },
  StructureProperties: {
    chain: {
      label_asym_id: vi.fn(() => 'A'),
    },
    residue: {
      auth_seq_id: vi.fn(() => 1),
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
});
