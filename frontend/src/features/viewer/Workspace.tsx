import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PaeHeatmap } from './PaeHeatmap';
import { MolstarViewer } from './MolstarViewer';
import { LegendPanel } from './LegendPanel';
import type { ViewerConfiguration } from '../../domain/project';
import type { PaeInteractionPerformanceSettings } from '../../lib/performance';
import type { MatrixViewport, PredictionBundle } from '../../lib/types';
import { clamp, uniqueSortedNumbers } from '../../lib/utils';

const DEFAULT_PAE_DRAWER_RATIO = 0.4;
const MIN_PAE_DRAWER_WIDTH = 300;
const MAX_PAE_DRAWER_WIDTH = 560;

interface WorkspaceProps {
  viewerConfiguration: ViewerConfiguration;
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
  hoveredCell: { x: number; y: number } | null;
  brushSelection: MatrixViewport | null;
  interactionPerformance: PaeInteractionPerformanceSettings;
  paeHoverSyncEnabled: boolean;
  paePairSelectionEnabled: boolean;
  paeDrawerOpen: boolean;
  colorByPLDDTToggleStatus: boolean;
  colorByPLDDTEnabled: boolean;
  onHoverResidues: (indices: number[]) => void;
  onHoverCell: (cell: { x: number; y: number } | null) => void;
  onPinResidues: (indices: number[]) => void;
  onPinCell: (cell: { x: number; y: number } | null) => void;
  onBrushSelectionChange: (selection: MatrixViewport | null) => void;
  onTogglePaeHoverSync: () => void;
  onTogglePaePairSelection: () => void;
  onTogglePaeDrawer: () => void;
  onClearPairSelection: () => void;
  onImportPaeData: (paeMatrix: number[][], paeMax: number) => void;
  onMolstarSelectionChange?: (indices: number[]) => void;
  onMolstarSelectionModeChange?: (enabled: boolean) => void;
  onMolstarFocusChange?: (indices: number[]) => void;
  onViewerStateChange?: (payload: Record<string, unknown>) => void;
  onNativeViewerStateDownloadReady?: (download: (() => void) | null) => void;
  onToggleColorByPLDDT: () => void;
  onEnableColorByPLDDT: () => void;
}

export function Workspace(props: WorkspaceProps) {
  const workspaceBodyRef = useRef<HTMLDivElement>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const pendingHoverResiduesRef = useRef<number[] | null>(null);
  const resizeStateRef = useRef<{ startClientX: number; startWidth: number } | null>(null);
  const hoverFrameBudgetRef = useRef(0);
  const lastHoverKeyRef = useRef('');
  const [paeDrawerWidth, setPaeDrawerWidth] = useState<number | null>(null);
  const [isResizingPaeDrawer, setIsResizingPaeDrawer] = useState(false);

  useEffect(() => {
    return () => {
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!props.paeHoverSyncEnabled || props.pinnedCell !== null) {
      clearPendingHoverResidues();
    }
  }, [props.paeHoverSyncEnabled, props.pinnedCell]);

  useEffect(() => {
    if (!props.paeDrawerOpen) return;
    const element = workspaceBodyRef.current;
    if (!element) return;

    const syncDrawerWidth = () => {
      const containerWidth = element.getBoundingClientRect().width;
      if (containerWidth <= 0) return;
      const maxWidth = Math.max(MIN_PAE_DRAWER_WIDTH, Math.min(MAX_PAE_DRAWER_WIDTH, Math.floor(containerWidth * .7)));
      const defaultWidth = clamp(Math.round(containerWidth * DEFAULT_PAE_DRAWER_RATIO), MIN_PAE_DRAWER_WIDTH, maxWidth);
      setPaeDrawerWidth((current) => clamp(current ?? defaultWidth, MIN_PAE_DRAWER_WIDTH, maxWidth));
    };

    syncDrawerWidth();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      syncDrawerWidth();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.paeDrawerOpen]);

  useEffect(() => {
    if (!isResizingPaeDrawer) return;

    const handleMove = (event: MouseEvent) => {
      const element = workspaceBodyRef.current;
      if (!element) return;
      const containerWidth = element.getBoundingClientRect().width;
      if (containerWidth <= 0) return;

      const maxWidth = Math.max(MIN_PAE_DRAWER_WIDTH, Math.min(MAX_PAE_DRAWER_WIDTH, Math.floor(containerWidth * 0.8)));
      const nextWidth = clamp(
        resizeStateRef.current!.startWidth + (resizeStateRef.current!.startClientX - event.clientX),
        MIN_PAE_DRAWER_WIDTH,
        maxWidth,
      );
      setPaeDrawerWidth(nextWidth);
    };

    const handleUp = () => {
      resizeStateRef.current = null;
      setIsResizingPaeDrawer(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingPaeDrawer]);

  const dispatchHoverResidues = (indices: number[]) => {
    const key = indices.join(',');
    if (key === lastHoverKeyRef.current) return;
    lastHoverKeyRef.current = key;
    props.onHoverResidues(indices);
  };

  const clearPendingHoverResidues = () => {
    pendingHoverResiduesRef.current = null;
    hoverFrameBudgetRef.current = 0;
    if (hoverFrameRef.current !== null) {
      cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
  };

  const scheduleHoverResidues = (indices: number[]) => {
    if (props.interactionPerformance.molstarHoverScheduling === 'sync') {
      clearPendingHoverResidues();
      dispatchHoverResidues(indices);
      return;
    }

    pendingHoverResiduesRef.current = indices;
    if (hoverFrameRef.current !== null) return;

    hoverFrameBudgetRef.current = 0;
    const tick = () => {
      hoverFrameBudgetRef.current += 1;
      if (hoverFrameBudgetRef.current < props.interactionPerformance.molstarHoverFrameStride) {
        hoverFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const next = pendingHoverResiduesRef.current ?? [];
      pendingHoverResiduesRef.current = null;
      hoverFrameRef.current = null;
      hoverFrameBudgetRef.current = 0;
      dispatchHoverResidues(next);
    };

    hoverFrameRef.current = requestAnimationFrame(tick);
  };

  const drawerWidth = paeDrawerWidth ?? MIN_PAE_DRAWER_WIDTH;
  const viewerBrushSelection = props.paeDrawerOpen ? props.brushSelection : null;
  const workspaceStyle = {
    '--pae-drawer-width': `${drawerWidth}px`,
  } as CSSProperties & Record<'--pae-drawer-width', string>;

  return (
    <div
      className={`workspace-grid workspace-shell${props.viewerConfiguration === 'target' ? ' target-workspace-grid' : ' validate-refolding-workspace-grid'}${props.paeDrawerOpen ? ' pae-drawer-open' : ' pae-drawer-closed'}`}
      style={workspaceStyle}
    >
      <div className="workspace-body" ref={workspaceBodyRef}>
        <div className="workspace-main">
          <MolstarViewer
            viewerConfiguration={props.viewerConfiguration}
            viewerStatePayload={props.viewerStatePayload}
            selectionDraft={props.selectionDraft}
            bundle={props.bundle}
            structureText={props.structureText}
            selectedResidues={props.selectedResidues}
            draftFocused={props.draftFocused}
            selectionModeEnabled={props.selectionModeEnabled}
            selectionSyncNonce={props.selectionSyncNonce ?? 0}
            focusedResidues={props.focusedResidues}
            hoveredResidues={props.hoveredResidues}
            pinnedResidues={props.pinnedResidues}
            pinnedCell={props.pinnedCell}
            brushSelection={viewerBrushSelection}
            colorByPLDDTToggleStatus={props.colorByPLDDTToggleStatus}
            colorByPLDDTEnabled={props.colorByPLDDTEnabled}
            onHoverResidue={(index) => props.onHoverResidues(index === null ? [] : [index])}
            onClickResidue={(index) => {
              clearPendingHoverResidues();
              props.onPinCell(null);
            }}
            onSelectionResiduesChange={(indices) => {
              clearPendingHoverResidues();
              props.onPinCell(null);
              props.onMolstarSelectionChange?.(indices);
            }}
            onSelectionModeChange={props.onMolstarSelectionModeChange}
            onFocusResiduesChange={props.onMolstarFocusChange}
            onViewerStateChange={props.onViewerStateChange}
            onNativeViewerStateDownloadReady={props.onNativeViewerStateDownloadReady}
          />
        </div>
        {(props.viewerConfiguration === 'validate_refolding' || props.viewerConfiguration === 'target') && (
          <div className={`pae-drawer-shell${props.paeDrawerOpen ? ' open' : ' closed'}`}>
          {props.paeDrawerOpen ? (
            <aside className="pae-drawer">
              <div className="pae-drawer-header">
              </div>
              <div
                className="pae-drawer-resizer"
                role="separator"
                aria-label="Resize pAE drawer"
                aria-orientation="vertical"
                onMouseDown={(event) => {
                  event.preventDefault();
                  resizeStateRef.current = {
                    startClientX: event.clientX,
                    startWidth: drawerWidth,
                  };
                  setIsResizingPaeDrawer(true);
                }}
              />
              <div className="pae-drawer-body">
                <PaeHeatmap
                  matrix={props.bundle.paeMatrix}
                  maxValue={props.bundle.paeMax}
                  syntheticPae={Boolean(props.bundle.metadata.syntheticPae)}
                  hoveredCell={props.hoveredCell}
                  pinnedResidues={props.pinnedResidues}
                  pinnedCell={props.pinnedCell}
                  brushSelection={props.brushSelection}
                  interactionPerformance={props.interactionPerformance}
                  hoverSyncEnabled={props.paeHoverSyncEnabled}
                  pairSelectionEnabled={props.paePairSelectionEnabled}
                  onHoverCell={(cell) => {
                    props.onHoverCell(cell);
                    if (props.paeHoverSyncEnabled && props.pinnedCell === null) {
                      scheduleHoverResidues(cell ? uniqueSortedNumbers([cell.x, cell.y]) : []);
                    }
                  }}
                  onClickCell={(cell) => {
                    clearPendingHoverResidues();
                    props.onPinCell(cell);
                    props.onPinResidues(uniqueSortedNumbers([cell.x, cell.y]));
                    props.onHoverResidues([]);
                  }}
                  onBrushSelectionChange={props.onBrushSelectionChange}
                  onToggleHoverSync={props.onTogglePaeHoverSync}
                  onTogglePairSelection={props.onTogglePaePairSelection}
                  onClearPairSelection={() => {
                    clearPendingHoverResidues();
                    props.onClearPairSelection();
                  }}
                  onImportPaeData={props.onImportPaeData}
                />
                <LegendPanel bundle={props.bundle} />
              </div>
            </aside>
          ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
