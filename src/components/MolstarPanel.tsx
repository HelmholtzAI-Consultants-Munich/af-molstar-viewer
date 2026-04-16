import { useEffect, useMemo, useRef } from 'react';
import { PAE_SELECTION_COLORS } from '../lib/constants';
import { findResidueIndexFromMolstarEvent, residueIndicesToQueries } from '../lib/molstar/queries';
import type { MatrixViewport, PredictionBundle } from '../lib/types';

const DEFAULT_FOCUS_COMPONENTS = ['target'] as const;  // 'surroundings', 'interactions'
const TARGET_ONLY_FOCUS_COMPONENTS = ['target'] as const;

const MOLSTAR_RENDER_OPTIONS = {
  alphafoldView: true,
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

const PAE_PAIR_SELECTION_COLOR = '#ff6699';

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
  return residueIndicesToQueries(residues, indices).map((query) => ({ ...query, color }));
}

      themeStrength: 1,
      themeStrength: .6,
    },
  });
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
      themeStrength: .6,
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

interface MolstarPanelProps {
  bundle: PredictionBundle;
  structureText: string;
  hoveredResidues: number[];
  pinnedResidues: number[];
  pinnedCell: { x: number; y: number } | null;
  brushSelection: MatrixViewport | null;
  onHoverResidue: (index: number | null) => void;
  onClickResidue: (index: number | null) => void;
}

export function MolstarPanel(props: MolstarPanelProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const sequenceHostRef = useRef<HTMLDivElement>(null);
  const viewportHostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<import('pdbe-molstar/lib/viewer.js').PDBeMolstarPlugin | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const hoverCallbackRef = useRef(props.onHoverResidue);
  const clickCallbackRef = useRef(props.onClickResidue);
  const hoveredResidues = useMemo(() => props.hoveredResidues, [props.hoveredResidues]);

  useEffect(() => {
    hoverCallbackRef.current = props.onHoverResidue;
    clickCallbackRef.current = props.onClickResidue;
  }, [props.onClickResidue, props.onHoverResidue]);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      if (!sequenceHostRef.current || !viewportHostRef.current || !shellRef.current) return;
      const { PDBeMolstarPlugin } = await import('pdbe-molstar/lib/viewer.js');
      if (cancelled || !sequenceHostRef.current || !viewportHostRef.current || !shellRef.current) return;

      sequenceHostRef.current.innerHTML = '';
      viewportHostRef.current.innerHTML = '';
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
          ...MOLSTAR_RENDER_OPTIONS,
        },
      );

      await applyIllustrativeQuickStyle(viewerRef.current);
      await applyDefaultSequenceTheme(viewerRef.current);
      // Ensure focus components and default styles are active from the very beginning
      await setStructureFocusComponents(viewerRef.current, DEFAULT_FOCUS_COMPONENTS);
      await clearStructureFocus(viewerRef.current);
      await viewerRef.current.visual.clearSelection();

      return () => {
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
  }, [props.bundle, props.structureText]);

  useEffect(() => {
    if (!viewerRef.current) return;
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

    if (props.brushSelection) {
      void setStructureFocusComponents(viewer, DEFAULT_FOCUS_COMPONENTS);
      void clearStructureFocus(viewer);
      void applyBrushColoring(viewer, props.bundle.residues, props.brushSelection);
      return;
    }

    if (props.pinnedResidues.length === 0) {
      void setStructureFocusComponents(viewer, DEFAULT_FOCUS_COMPONENTS);
      void clearStructureFocus(viewer);
      void viewer.visual.clearSelection();
      void applyDefaultSequenceTheme(viewer);
      return;
    }

    if (props.pinnedCell) {
      const queries = residueIndicesToQueries(props.bundle.residues, props.pinnedResidues);
      void (async () => {
        await setStructureFocusComponents(viewer, TARGET_ONLY_FOCUS_COMPONENTS);
        await viewer.visual.interactivityFocus({ data: queries });
        await applyPinnedPairSelection(viewer, props.bundle.residues, props.pinnedResidues);
      })();
      return;
    }

    void setStructureFocusComponents(viewer, DEFAULT_FOCUS_COMPONENTS);
    const queries = residueIndicesToQueries(props.bundle.residues, props.pinnedResidues);
    void viewer.visual.select({ data: queries });
    void applyDefaultSequenceTheme(viewer);
  }, [props.brushSelection, props.bundle.residues, props.pinnedCell, props.pinnedResidues]);

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
