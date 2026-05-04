import { useEffect, useMemo, useRef } from 'react';
import { PAE_PAIR_SELECTION_COLOR, PAE_SELECTION_COLORS } from '../lib/constants';
import { findResidueIndexFromMolstarEvent, residueIndicesToQueries } from '../lib/molstar/queries';
import type { MatrixViewport, PredictionBundle } from '../lib/types';
import { uniqueSortedNumbers } from '../lib/utils';

const DEFAULT_FOCUS_COMPONENTS = ['target'] as const;
const TARGET_ONLY_FOCUS_COMPONENTS = ['target'] as const;
const VIEWER_STATE_DEBOUNCE_MS = 240;

const MOLSTAR_RENDER_OPTIONS = {
  visualStyle: 'cartoon' as const,
  bgColor: { r: 255, g: 255, b: 255 },
  leftPanel: false,
  rightPanel: false,
  logPanel: false,
  sequencePanel: false,
  hideControls: false,
  selectInteraction: true,
  hideCanvasControls: [],
};

const MOLSTAR_SNAPSHOT_PARAMS = {
  data: false,
  behavior: false,
  structureSelection: false,
  componentManager: true,
  animation: false,
  startAnimation: false,
  canvas3d: true,
  canvas3dContext: true,
  interactivity: true,
  camera: true,
  cameraTransition: { name: 'instant' as const, params: {} },
  image: false,
};

const MOLSTAR_ILLUSTRATIVE_STYLE = {
  componentOptions: {
    ignoreLight: true,
    materialStyle: {
      metalness: 0,
      roughness: 1,
      bumpiness: 0,
    },
  },
  renderer: {
    ambientColor: 0xffffff,
    ambientIntensity: 0.9,
    directionalLightIntensity: 0.12,
  },
  cartoon: {
    bumpFrequency: 0,
    bumpAmplitude: 0,
  },
  postprocessing: {
    outline: {
      scale: 1,
      color: 0x000000,
      threshold: 0.33,
      includeTransparent: true,
    },
    occlusion: {
      multiScale: { name: 'off', params: {} },
      radius: 5,
      bias: 0.8,
      blurKernelSize: 15,
      blurDepthBias: 0.5,
      samples: 32,
      resolutionScale: 1,
      color: 0x000000,
      transparentThreshold: 0.4,
    },
  },
};

let persistedSequenceHostHeight: string | null = null;

function residueSpan(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function difference(source: number[], excluded: Set<number>): number[] {
  return source.filter((value) => !excluded.has(value));
}

function queriesWithColor(
  residues: PredictionBundle['residues'],
  indices: number[],
  color: string,
) {
  // console.log('with color', color, 'for indices', indices);
  return residueIndicesToQueries(residues, indices).map((query) => ({ ...query, color }));
}

async function applyDefaultSequenceTheme(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  usePLDDTs: boolean,
) {
  if (usePLDDTs) {
    try {
      await viewer.visual.sequenceColor({
        data: [],
        theme: {
          name: 'plddt-confidence',
          params: {},
          themeStrength: 0.6,
        },
      });
      return;
    } catch {
      console.warn('PLDDT failed');
    }
  }

  await viewer.visual.sequenceColor({
    data: [],
    theme: {
      name: 'chain-id',
      params: {},
      themeStrength: 0.6,
    },
  });
}

async function applyDefaultStructureTheme(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  usePLDDTs: boolean,
) {
  const plugin = viewer.plugin;
  if (!plugin) return;

  const themeName = usePLDDTs ? 'plddt-confidence' : 'chain-id';
  const update = plugin.state.data.build();
  let hasRepresentations = false;

  for (const structure of plugin.managers.structure.hierarchy.selection.structures) {
    for (const component of structure.components) {
      for (const representation of component.representations) {
        hasRepresentations = true;
        update.to(representation.cell).update((old: any) => {
          if (!old.colorTheme || old.colorTheme.name !== themeName) {
            old.colorTheme = { name: themeName, params: {} };
          }
        });
      }
    }
  }

  if (hasRepresentations) {
    await update.commit();
  }
}

async function applyDefaultColors(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  props: MolstarPanelProps,
) {
  const usePLDDTs =
    props.bundle.metadata.looksLikePLDDTs && props.colorByPLDDTToggleStatus && props.colorByPLDDTEnabled;
  await applyDefaultSequenceTheme(viewer, usePLDDTs);
  await applyDefaultStructureTheme(viewer, usePLDDTs);
}

async function applyDefaultColorsDeferred(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  props: MolstarPanelProps,
) {
  const raf = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await raf();
  await raf();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await applyDefaultColors(viewer, props);
}

async function applyPinnedPairSelection(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  residues: PredictionBundle['residues'],
  indices: number[],
) {
  const coloredQueries = queriesWithColor(residues, indices, PAE_PAIR_SELECTION_COLOR);

  await viewer.visual.select({
    data: coloredQueries,
  });

  await viewer.visual.sequenceColor({
    data: coloredQueries,
    theme: {
      name: 'plddt-confidence',
      params: {},
      themeStrength: 1,
    },
  });
}

async function setStructureFocusComponents(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  components: readonly string[],
) {
  const plugin = viewer.plugin;
  if (!plugin?.state?.behaviors?.build || !plugin.runTask) return;
  const { StructureFocusRepresentation } = await import('molstar/lib/mol-plugin/behavior/dynamic/selection/structure-focus-representation.js');
  const current = plugin.state.behaviors.cells.get(StructureFocusRepresentation.id)?.params?.values;
  if (current && Array.isArray(current.components) && current.components.join('|') === components.join('|')) {
    return;
  }

  const update = plugin.state.behaviors.build().to(StructureFocusRepresentation.id).update(StructureFocusRepresentation, (old: any) => {
    old.components = [...components];
  });
  await plugin.runTask(plugin.state.behaviors.updateTree(update, { doNotUpdateCurrent: true, doNotLogTiming: true }));
}

async function clearStructureFocus(viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin) {
  viewer.plugin?.managers?.structure?.focus?.clear?.();
}

async function applyBrushColoring(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  residues: PredictionBundle['residues'],
  selection: MatrixViewport,
) {
  const xResidues = residueSpan(selection.xStart, selection.xEnd);
  const yResidues = residueSpan(selection.yStart, selection.yEnd);
  const xSet = new Set(xResidues);
  const ySet = new Set(yResidues);
  const overlap = xResidues.filter((index) => ySet.has(index));
  const overlapSet = new Set(overlap);
  const xOnly = difference(xResidues, overlapSet);
  const yOnly = difference(yResidues, overlapSet);

  const coloredQueries = [
    ...queriesWithColor(residues, xOnly, PAE_SELECTION_COLORS.yRange),
    ...queriesWithColor(residues, yOnly, PAE_SELECTION_COLORS.overlap),
    ...queriesWithColor(residues, overlap, PAE_SELECTION_COLORS.xRange),
  ];

  await viewer.visual.select({
    data: coloredQueries,
    nonSelectedColor: PAE_SELECTION_COLORS.dimmed,
  });

  await viewer.visual.sequenceColor({
    data: coloredQueries,
    nonSelectedColor: PAE_SELECTION_COLORS.dimmed,
  });
}

async function applyIllustrativeQuickStyle(viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin) {
  const plugin = viewer.plugin;
  if (!plugin) return;

  await plugin.managers.structure.component.setOptions({
    ...plugin.managers.structure.component.state.options,
    ...MOLSTAR_ILLUSTRATIVE_STYLE.componentOptions,
  });

  if (plugin.canvas3d) {
    const current = plugin.canvas3d.props.postprocessing;
    const currentRenderer = plugin.canvas3d.props.renderer;
    plugin.canvas3d.setProps({
      renderer: {
        ...currentRenderer,
        ambientColor: MOLSTAR_ILLUSTRATIVE_STYLE.renderer.ambientColor,
        ambientIntensity: MOLSTAR_ILLUSTRATIVE_STYLE.renderer.ambientIntensity,
        light: currentRenderer.light.map((light: { intensity: number }) => ({
          ...light,
          intensity: MOLSTAR_ILLUSTRATIVE_STYLE.renderer.directionalLightIntensity,
        })),
      },
      postprocessing: {
        outline: current.outline?.name === 'on'
          ? current.outline
          : {
              name: 'on',
              params: MOLSTAR_ILLUSTRATIVE_STYLE.postprocessing.outline,
            },
        occlusion: current.occlusion?.name === 'on'
          ? current.occlusion
          : {
              name: 'on',
              params: MOLSTAR_ILLUSTRATIVE_STYLE.postprocessing.occlusion,
            },
        shadow: { name: 'off', params: {} },
      },
    });
  }

  const update = plugin.state.data.build();
  let hasCartoonRepresentations = false;
  for (const structure of plugin.managers.structure.hierarchy.selection.structures) {
    for (const component of structure.components) {
      for (const representation of component.representations) {
        hasCartoonRepresentations = true;
        update.to(representation.cell).update((old: any) => {
          if (old.type.name !== 'cartoon') return;
          old.type.params.bumpFrequency = MOLSTAR_ILLUSTRATIVE_STYLE.cartoon.bumpFrequency;
          old.type.params.bumpAmplitude = MOLSTAR_ILLUSTRATIVE_STYLE.cartoon.bumpAmplitude;
        });
      }
    }
  }

  if (hasCartoonRepresentations) {
    await update.commit();
  }
}

function getCurrentStructure(viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin) {
  return viewer.plugin?.managers?.structure?.hierarchy?.selection?.structures?.[0]?.cell?.obj?.data ?? null;
}

async function selectionLociFromResidues(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  residues: PredictionBundle['residues'],
  indices: number[],
) {
  const structure = getCurrentStructure(viewer);
  if (!structure) return null;
  const { QueryHelper } = await import('pdbe-molstar/lib/helpers.js');
  const queries = residueIndicesToQueries(residues, indices)
  const loci = QueryHelper.getInteractivityLoci(queries, structure);
  // console.debug('selectionLociFromResidues indices', indices, 
  //   'became queries', canonicalizeQueries(queries), 
  //   'and returned loci', loci.elements);
  // looks good!
  return loci;
}

async function readSelectionResidues(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  residues: PredictionBundle['residues'],
) {
  // should this function be isolated somehow?
  const structure = getCurrentStructure(viewer);
  if (!structure) return [];
  
  const [{ StructureElement, StructureProperties }] = await Promise.all([import('molstar/lib/mol-model/structure.js')]);
  const loci = viewer.plugin?.managers?.structure?.selection?.getLoci(structure);
  if (!loci || !StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return [];

  const selection = new Set<number>();
  StructureElement.Loci.forEachLocation(loci, (location: unknown) => {
    const chainId = StructureProperties.chain.label_asym_id(location as never);
    const authSeqId = StructureProperties.residue.auth_seq_id(location as never);
    const match = residues.find((residue) => residue.chainId === chainId && residue.authSeqId !== undefined && residue.authSeqId === authSeqId);
    if (match) selection.add(match.index);
  });
  // console.debug('readSelectionResidues selection', selection);
  return uniqueSortedNumbers([...selection]);
}

async function readFocusResidues(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  residues: PredictionBundle['residues'],
) {
  const [{ StructureElement, StructureProperties }] = await Promise.all([import('molstar/lib/mol-model/structure.js')]);
  const loci = viewer.plugin?.managers?.structure?.focus?.current?.loci;
  if (!loci || !StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return [];

  const focus = new Set<number>();
  StructureElement.Loci.forEachLocation(loci, (location: unknown) => {
    const chainId = StructureProperties.chain.label_asym_id(location as never);
    const authSeqId = StructureProperties.residue.auth_seq_id(location as never);
    const match = residues.find((residue) => residue.chainId === chainId && residue.authSeqId !== undefined && residue.authSeqId === authSeqId);
    if (match) focus.add(match.index);
  });
  return uniqueSortedNumbers([...focus]);
}

async function syncNativeSelection(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  residues: PredictionBundle['residues'],
  indices: number[],
  options?: { force?: boolean },
) {
  const structure = getCurrentStructure(viewer);
  if (!structure || !viewer.plugin?.managers?.structure?.selection) return;

  const [{ StructureElement }, nextLoci] = await Promise.all([
    import('molstar/lib/mol-model/structure.js'),
    selectionLociFromResidues(viewer, residues, indices),
  ]);

  if (!nextLoci) return;
  const currentLoci = viewer.plugin.managers.structure.selection.getLoci(structure);
  if (!options?.force && StructureElement.Loci.is(currentLoci) && StructureElement.Loci.areEqual(currentLoci, nextLoci)) return;

  if (indices.length === 0) {
    viewer.plugin.managers.structure.selection.clear();
    return;
  }

  viewer.plugin.managers.structure.selection.fromLoci('set', nextLoci, true);
}

async function syncNativeFocus(
  viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
  residues: PredictionBundle['residues'],
  indices: number[],
) {
  if (!viewer.plugin?.managers?.structure?.focus) return;
  if (indices.length === 0) {
    viewer.plugin.managers.structure.focus.clear();
    return;
  }

  const loci = await selectionLociFromResidues(viewer, residues, indices);
  if (!loci) return;
  viewer.plugin.managers.structure.focus.setFromLoci(loci);
}

function readSnapshotFromPayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== 'object') return null;
  const snapshot = payload.snapshot;
  if (!snapshot || typeof snapshot !== 'object') return null;
  return snapshot;
}

async function captureViewerState(viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin) {
  const snapshot = viewer.plugin?.state?.getSnapshot?.(MOLSTAR_SNAPSHOT_PARAMS);
  if (!snapshot || typeof snapshot !== 'object') return null;
  const sanitizedSnapshot = structuredClone(snapshot as Record<string, unknown>);
  delete sanitizedSnapshot.data;
  delete sanitizedSnapshot.behaviour;
  delete sanitizedSnapshot.animation;
  delete sanitizedSnapshot.structureFocus;
  delete sanitizedSnapshot.structureSelection;
  return {
    snapshot: sanitizedSnapshot,
  };
}

interface MolstarPanelProps {
  viewerConfiguration: 'target' | 'validate_refolding';
  viewerStatePayload: Record<string, unknown> | null;
  selectionDraft: string;
  bundle: PredictionBundle;
  structureText: string;
  selectedResidues: number[] | null;
  draftFocused: boolean;
  selectionModeEnabled: boolean;
  selectionSyncNonce?: number;
  focusedResidues: number[] | null;
  hoveredResidues: number[];
  pinnedResidues: number[];
  pinnedCell: { x: number; y: number } | null;
  brushSelection: MatrixViewport | null;
  onHoverResidue: (index: number | null) => void;
  onClickResidue: (index: number | null) => void;
  onSelectionResiduesChange?: (indices: number[]) => void;
  onSelectionModeChange?: (enabled: boolean) => void;
  onFocusResiduesChange?: (indices: number[]) => void;
  onViewerStateChange?: (payload: Record<string, unknown>) => void;
  colorByPLDDTToggleStatus: boolean;
  colorByPLDDTEnabled: boolean;
}

export function MolstarPanel(props: MolstarPanelProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const sequenceHostRef = useRef<HTMLDivElement>(null);
  const viewportHostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const hoverCallbackRef = useRef(props.onHoverResidue);
  const clickCallbackRef = useRef(props.onClickResidue);
  const selectionCallbackRef = useRef(props.onSelectionResiduesChange);
  const selectionModeCallbackRef = useRef(props.onSelectionModeChange);
  const focusCallbackRef = useRef(props.onFocusResiduesChange);
  const viewerStateCallbackRef = useRef(props.onViewerStateChange);
  const selectedResiduesRef = useRef(props.selectedResidues);
  const focusedResiduesRef = useRef(props.focusedResidues);
  const selectionModeRef = useRef(false);
  const selectionModeCallbacksReadyRef = useRef(false);
  const suppressSelectionCallbacksDepthRef = useRef(0);
  const lastAppliedSelectionRef = useRef<number[] | null>(null);
  const restoringViewerStateRef = useRef(false);
  const persistTimeoutRef = useRef<number | null>(null);
  const hoveredResidues = useMemo(() => props.hoveredResidues, [props.hoveredResidues]);

  useEffect(() => {
    hoverCallbackRef.current = props.onHoverResidue;
    clickCallbackRef.current = props.onClickResidue;
    selectionCallbackRef.current = props.onSelectionResiduesChange;
    selectionModeCallbackRef.current = props.onSelectionModeChange;
    focusCallbackRef.current = props.onFocusResiduesChange;
    viewerStateCallbackRef.current = props.onViewerStateChange;
  }, [
    props.onClickResidue,
    props.onHoverResidue,
    props.onSelectionResiduesChange,
    props.onSelectionModeChange,
    props.onFocusResiduesChange,
    props.onViewerStateChange,
  ]);

  useEffect(() => {
    selectedResiduesRef.current = props.selectedResidues;
  }, [props.selectedResidues]);

  useEffect(() => {
    focusedResiduesRef.current = props.focusedResidues;
  }, [props.focusedResidues]);

  const applySelectionModeToViewer = (
    viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin,
    enabled: boolean,
  ) => {
    selectionModeRef.current = enabled;
    viewer.selectionMode = enabled;
    const selectionModeBehavior = viewer.plugin?.behaviors?.interaction?.selectionMode as {
      next?: (value: boolean) => void;
    } | null | undefined;
    selectionModeBehavior?.next?.(enabled);
  };

  const suppressSelectionCallbacks = async (action: () => Promise<void> | void) => {
    suppressSelectionCallbacksDepthRef.current += 1;
    try {
      await action();
    } finally {
      suppressSelectionCallbacksDepthRef.current = Math.max(0, suppressSelectionCallbacksDepthRef.current - 1);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let disposed = false;

    const flushViewerState = async (viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin | null) => {
      if (!viewer || restoringViewerStateRef.current) return;
      const payload = await captureViewerState(viewer);
      if (payload) {
        viewerStateCallbackRef.current?.(payload);
      }
    };

    const scheduleViewerStatePersist = (viewer: import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin | null) => {
      if (!viewer || restoringViewerStateRef.current || !viewerStateCallbackRef.current) return;
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
      persistTimeoutRef.current = window.setTimeout(() => {
        persistTimeoutRef.current = null;
        void flushViewerState(viewer);
      }, VIEWER_STATE_DEBOUNCE_MS);
    };

    const setup = async () => {
      if (!sequenceHostRef.current || !viewportHostRef.current || !shellRef.current) return;
      const { PDBeMolstarPlugin } = await import('pdbe-molstar/lib/viewer.js');
      if (cancelled || !sequenceHostRef.current || !viewportHostRef.current || !shellRef.current) return;
      selectionModeCallbacksReadyRef.current = false;

      sequenceHostRef.current.innerHTML = '';
      viewportHostRef.current.innerHTML = '';
      if (persistedSequenceHostHeight) {
        sequenceHostRef.current.style.height = persistedSequenceHostHeight;
      }
      viewerRef.current = new PDBeMolstarPlugin();
      objectUrlRef.current = URL.createObjectURL(new Blob([props.structureText], { type: 'text/plain' }));

      const handleHover = (event: Event) => {
        const detail = (event as Event & { eventData?: Record<string, unknown> }).eventData;
        hoverCallbackRef.current(findResidueIndexFromMolstarEvent(props.bundle.residues, detail));
      };

      const handleOut = () => hoverCallbackRef.current(null);
      const handleClick = (event: Event) => {
        const detail = (event as Event & { eventData?: Record<string, unknown> }).eventData;
        clickCallbackRef.current(findResidueIndexFromMolstarEvent(props.bundle.residues, detail));
      };

      shellRef.current.addEventListener('PDB.molstar.mouseover', handleHover);
      shellRef.current.addEventListener('PDB.molstar.mouseout', handleOut);
      shellRef.current.addEventListener('PDB.molstar.click', handleClick);

      await viewerRef.current.render(
        [
          {
            target: sequenceHostRef.current,
            component: PDBeMolstarPlugin.UIComponents.SequenceView,
            props: { defaultMode: 'single' },
          },
          {
            target: viewportHostRef.current,
            component: PDBeMolstarPlugin.UIComponents.PDBeViewport,
          },
        ],
        {
          customData: {
            url: objectUrlRef.current,
            format: props.bundle.structure.format,
            binary: false,
          },
          alphafoldView: props.bundle.metadata.looksLikePLDDTs,
          ...MOLSTAR_RENDER_OPTIONS,
        },
      );
      const sequenceHeightObserver =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              if (!sequenceHostRef.current) return;
              persistedSequenceHostHeight = `${sequenceHostRef.current.getBoundingClientRect().height}px`;
            });
      sequenceHeightObserver?.observe(sequenceHostRef.current);

      await setStructureFocusComponents(viewerRef.current, TARGET_ONLY_FOCUS_COMPONENTS);
      await applyIllustrativeQuickStyle(viewerRef.current);
      await clearStructureFocus(viewerRef.current);
      await applyDefaultColorsDeferred(viewerRef.current, props);

      const snapshot = readSnapshotFromPayload(props.viewerStatePayload);
      if (snapshot && viewerRef.current.plugin?.state?.setSnapshot) {
        restoringViewerStateRef.current = true;
        try {
          await viewerRef.current.plugin.state.setSnapshot(snapshot as never);
        } catch (snapshotError) {
          console.warn('Unable to restore Mol* viewer snapshot, continuing with a fresh view.', snapshotError);
        } finally {
          restoringViewerStateRef.current = false;
        }
        await setStructureFocusComponents(viewerRef.current, TARGET_ONLY_FOCUS_COMPONENTS);
      }
      await applyDefaultColors(viewerRef.current, props);
      applySelectionModeToViewer(viewerRef.current, props.selectionModeEnabled);
      if (!selectionModeRef.current) {
        await viewerRef.current.visual.clearSelection();
      }
      if (selectionModeRef.current && selectedResiduesRef.current !== null) {
        await syncNativeSelection(viewerRef.current, props.bundle.residues, selectedResiduesRef.current, { force: true });
      }
      if (focusedResiduesRef.current !== null) {
        await syncNativeFocus(viewerRef.current, props.bundle.residues, focusedResiduesRef.current);
      }
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      selectionModeCallbacksReadyRef.current = true;

      const selectionSubscription = viewerRef.current.plugin?.managers?.structure?.selection?.events?.changed?.subscribe(async () => {
        if (disposed) return;
        if (!viewerRef.current) return;
        const indices = await readSelectionResidues(viewerRef.current, props.bundle.residues);
        const previous = selectedResiduesRef.current ?? [];
        // console.log('molstar selection has', indices.length, 'while previous had', previous.length); // Here I can often see the selection shrinking; looping in step sizes such as 19 or 5 until the selection has disappeared in the blink of an eye.
        if (previous.length === indices.length && previous.every((value, index) => value === indices[index])) {
          // it's the same selection as before
          return;
        }
        if (suppressSelectionCallbacksDepthRef.current > 0) {
          return;
        }
        if (!selectionModeRef.current) {
          // Turning selection mode off triggers transient Mol* selection events while the viewer clears its native
          // highlight. Those are not user edits, so keep the last authoritative draft intact.
          return;
        }

        selectionCallbackRef.current?.(indices);  // bad! This causes selections to immediately collapse for derived PDBs. If I comment the line, cropping no longer works. 
        if (selectionModeRef.current) {
          scheduleViewerStatePersist(viewerRef.current);
        }
      });
      const focusSubscription = viewerRef.current.plugin?.managers?.structure?.focus?.behaviors?.current?.subscribe(async () => {
        if (disposed) return;
        if (!viewerRef.current) return;
        const indices = await readFocusResidues(viewerRef.current, props.bundle.residues);
        focusCallbackRef.current?.(indices);
        scheduleViewerStatePersist(viewerRef.current);
      });
      const selectionModeSubscription = viewerRef.current.plugin?.behaviors?.interaction?.selectionMode?.subscribe(async (enabled: boolean) => {
        if (disposed) return;
        if (!viewerRef.current) return;
        const now = performance.now();
        selectionModeRef.current = enabled;
        if (selectionModeCallbacksReadyRef.current) {
          selectionModeCallbackRef.current?.(enabled);
        }
        if (enabled && selectedResiduesRef.current !== null) {
          await suppressSelectionCallbacks(() =>
            syncNativeSelection(viewerRef.current!, props.bundle.residues, selectedResiduesRef.current, { force: true }),
          );
        } else if (!enabled) {
          await suppressSelectionCallbacks(() => viewerRef.current!.visual.clearSelection());
        }
        scheduleViewerStatePersist(viewerRef.current);
      });
      const cameraSubscription = viewerRef.current.plugin?.canvas3d?.camera?.stateChanged?.subscribe(() => {
        scheduleViewerStatePersist(viewerRef.current);
      });

      // can comment out these three lines without damage
      const initialSelection = await readSelectionResidues(viewerRef.current, props.bundle.residues);
      if (selectionModeRef.current && initialSelection.length > 0) {
        selectionCallbackRef.current?.(initialSelection);
      }
      const initialFocus = await readFocusResidues(viewerRef.current, props.bundle.residues);
      focusCallbackRef.current?.(initialFocus);

      return () => {
        disposed = true;
        selectionModeCallbacksReadyRef.current = false;
        if (persistTimeoutRef.current !== null) {
          window.clearTimeout(persistTimeoutRef.current);
          persistTimeoutRef.current = null;
        }
        sequenceHeightObserver?.disconnect();
        if (sequenceHostRef.current) {
          persistedSequenceHostHeight = `${sequenceHostRef.current.getBoundingClientRect().height}px`;
        }
        void flushViewerState(viewerRef.current);
        selectionSubscription?.unsubscribe?.();
        focusSubscription?.unsubscribe?.();
        selectionModeSubscription?.unsubscribe?.();
        cameraSubscription?.unsubscribe?.();
        shellRef.current?.removeEventListener('PDB.molstar.mouseover', handleHover);
        shellRef.current?.removeEventListener('PDB.molstar.mouseout', handleOut);
        shellRef.current?.removeEventListener('PDB.molstar.click', handleClick);
      };
    };

    let cleanupListeners: (() => void) | undefined;
    void setup().then((cleanup) => {
      cleanupListeners = cleanup;
    });

    return () => {
      cancelled = true;
      cleanupListeners?.();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [props.bundle, props.structureText, props.viewerConfiguration]);

  useEffect(() => {
    if (!viewerRef.current) return;
    // console.log('hoveredResidues / residues -- linked to pAE?', hoveredResidues, ' is position-in-seq');
    const queries = residueIndicesToQueries(props.bundle.residues, hoveredResidues);
    if (queries.length === 0) {
      void viewerRef.current.visual.clearHighlight();
      return;
    }
    void viewerRef.current.visual.highlight({ data: queries });
  }, [props.bundle.residues, hoveredResidues]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (viewer.selectionMode !== props.selectionModeEnabled) {
      applySelectionModeToViewer(viewer, props.selectionModeEnabled);
    }

    if (props.selectedResidues === null) return; // || !selectionModeRef.current would return too often
    if (!props.selectionModeEnabled) {
      void suppressSelectionCallbacks(() => viewer.visual.clearSelection());
      return;
    }

    void suppressSelectionCallbacks(() => syncNativeSelection(viewer, props.bundle.residues, props.selectedResidues));
  }, [props.bundle.residues, props.selectedResidues, props.selectionSyncNonce, props.draftFocused, props.selectionModeEnabled]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (props.brushSelection) {
      const brushSelection = props.brushSelection;
      void (async () => {
        await setStructureFocusComponents(viewer, DEFAULT_FOCUS_COMPONENTS);
        await clearStructureFocus(viewer);
        await applyBrushColoring(viewer, props.bundle.residues, brushSelection);
      })();
      return;
    }

    if (props.pinnedResidues.length === 0) {
      void (async () => {
        await setStructureFocusComponents(viewer, DEFAULT_FOCUS_COMPONENTS);
        await viewer.visual.clearSelection();
        await applyDefaultColors(viewer, props);
        if (selectedResiduesRef.current !== null) {
          await syncNativeSelection(viewer, props.bundle.residues, selectedResiduesRef.current, { force: true });
        }
        if (focusedResiduesRef.current !== null) {
          await syncNativeFocus(viewer, props.bundle.residues, focusedResiduesRef.current);
        }
      })();
      return;
    }

    if (props.pinnedCell) {
      void (async () => {
        await setStructureFocusComponents(viewer, TARGET_ONLY_FOCUS_COMPONENTS);
        await syncNativeFocus(viewer, props.bundle.residues, props.pinnedResidues);
        // console.log('pinnedCell')
        await viewer.visual.interactivityFocus({ data: residueIndicesToQueries(props.bundle.residues, props.pinnedResidues) });
        await applyPinnedPairSelection(viewer, props.bundle.residues, props.pinnedResidues);
      })();
      return;
    }

    void (async () => {
      await setStructureFocusComponents(viewer, DEFAULT_FOCUS_COMPONENTS);
      await syncNativeFocus(viewer, props.bundle.residues, props.pinnedResidues);
      await applyDefaultColors(viewer, props);
    })();
  }, [
    props.brushSelection,
    props.bundle.residues,
    props.pinnedCell,
    props.pinnedResidues,
    props.colorByPLDDTToggleStatus,
    props.colorByPLDDTEnabled,
  ]);

  return (
    <>
      <section className="panel sequence-panel">
        <div ref={shellRef} className="molstar-shell">
          <div ref={sequenceHostRef} className="molstar-sequence-host" />
        </div>
      </section>
      <section className="panel viewer-panel">
        <div className="molstar-shell">
          <div ref={viewportHostRef} className="molstar-host" />
        </div>
      </section>
    </>
  );
}
