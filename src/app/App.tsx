import { useEffect, useMemo, useRef, useState } from 'react';
import { FileImportPanel } from '../components/FileImportPanel';
import { ResolverPanel } from '../components/ResolverPanel';
import { Workspace } from '../components/Workspace';
import { resolvePaeInteractionPerformance } from '../lib/performance';
import type {
  BundleChoice,
  DiscoveryGroup,
  PredictionBundle,
  WorkerInputFile,
} from '../lib/types';

const worker = new Worker(new URL('../lib/worker/parse-worker.ts', import.meta.url), { type: 'module' });
const STORAGE_KEY = 'af-molstar-viewer:selected-group';
const PAE_HOVER_SYNC_RESIDUE_THRESHOLD = 800;

async function filesToWorkerInputs(files: File[]): Promise<WorkerInputFile[]> {
  return Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })));
}

export function App() {
  const [files, setFiles] = useState<WorkerInputFile[]>([]);
  const [groups, setGroups] = useState<DiscoveryGroup[]>([]);
  const [bundle, setBundle] = useState<PredictionBundle | null>(null);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(localStorage.getItem(STORAGE_KEY));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredResidues, setHoveredResidues] = useState<number[]>([]);
  const [pinnedResidues, setPinnedResidues] = useState<number[]>([]);
  const [pinnedCell, setPinnedCell] = useState<{ x: number; y: number } | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [brushSelection, setBrushSelection] = useState<{ xStart: number; xEnd: number; yStart: number; yEnd: number } | null>(null);
  const [paeHoverSyncEnabled, setPaeHoverSyncEnabled] = useState(false);
  const [paePairSelectionEnabled, setPaePairSelectionEnabled] = useState(true);
  const [colorByPLDDTToggleStatus, setColorByPLDDTToggleStatus] = useState(true);
  const [colorByPLDDTEnabled, setColorByPLDDTEnabled] = useState(true);
  const pendingResolver = useRef<((payload: unknown) => void) | null>(null);

  const fileMap = useMemo(() => new Map(files.map((file) => [file.name, file.text])), [files]);
  const unresolvedGroups = useMemo(() => groups.filter((group) => group.unresolved), [groups]);
  const interactionPerformance = useMemo(
    () => resolvePaeInteractionPerformance(bundle?.residues.length ?? 0),
    [bundle?.residues.length],
  );

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      pendingResolver.current?.(event.data);
    };
    worker.addEventListener('message', listener);
    return () => worker.removeEventListener('message', listener);
  }, []);

  const callWorker = async <T,>(message: object): Promise<T> =>
    new Promise((resolve, reject) => {
      pendingResolver.current = (payload) => {
        pendingResolver.current = null;
        const response = payload as { ok: boolean; error?: string };
        if (!response.ok) {
          reject(new Error(response.error ?? 'Worker error'));
          return;
        }
        resolve(payload as T);
      };
      worker.postMessage(message);
    });

  const resetSelection = (_nextBundle: PredictionBundle) => {
    setHoveredResidues([]);
    setPinnedResidues([]);
    setPinnedCell(null);
    setHoveredCell(null);
    setBrushSelection(null);
    setPaeHoverSyncEnabled(_nextBundle.residues.length <= PAE_HOVER_SYNC_RESIDUE_THRESHOLD);
    setPaePairSelectionEnabled(true);
    if (!_nextBundle.metadata.looksLikePLDDTs) {
      // if the _nextBundle doesn't have PLDDTs, turn coloring off and disable
      setColorByPLDDTToggleStatus(false);
      setColorByPLDDTEnabled(false);
    } else {
      // enable but do not switch PLDDTs back on automatically
      setColorByPLDDTEnabled(true);
    }
  };

  const loadGroup = async (groupId: string, choice?: BundleChoice, sourceFiles = files) => {
    setLoading(true);
    setError(null);
    try {
      const response = await callWorker<{ ok: true; bundle: PredictionBundle }>({
        type: 'load',
        files: sourceFiles,
        groupId,
        choice,
      });
      setBundle(response.bundle);
      setCurrentGroupId(groupId);
      localStorage.setItem(STORAGE_KEY, groupId);
      resetSelection(response.bundle);
    } catch (workerError) {
      setError(workerError instanceof Error ? workerError.message : 'Unable to load bundle');
    } finally {
      setLoading(false);
    }
  };

  const discover = async (nextFiles: WorkerInputFile[]) => {
    setLoading(true);
    setError(null);
    try {
      const response = await callWorker<{ ok: true; groups: DiscoveryGroup[] }>({
        type: 'discover',
        files: nextFiles,
      });
      setFiles(nextFiles);
      setGroups(response.groups);
      const resolvedGroups = response.groups.filter((group) => !group.unresolved);
      const preferred = resolvedGroups.find((group) => group.id === currentGroupId) ?? resolvedGroups[0];
      if (preferred) {
        setCurrentGroupId(preferred.id);
        localStorage.setItem(STORAGE_KEY, preferred.id);
        void loadGroup(preferred.id, undefined, nextFiles);
      } else {
        setBundle(null);
      }
    } catch (workerError) {
      setError(workerError instanceof Error ? workerError.message : 'Unable to discover files');
    } finally {
      setLoading(false);
    }
  };

  const currentStructureText = bundle ? fileMap.get(bundle.structure.fileName) ?? '' : '';

  return (
    <main className="app-shell">
      <div className={`top-controls-shell${unresolvedGroups.length > 0 ? ' with-resolver' : ''}`}>
        <FileImportPanel
          groups={groups}
          currentGroupId={currentGroupId}
          onLoadFiles={async (incoming) => discover(await filesToWorkerInputs(incoming))}
          onLoadExample={discover}
          onSelectGroup={(groupId) => void loadGroup(groupId)}
          loading={loading}
        />

        {unresolvedGroups.length > 0 && (
          <ResolverPanel groups={unresolvedGroups} loading={loading} onResolve={async (groupId, choice) => loadGroup(groupId, choice)} />
        )}
      </div>

      {error && <div className="panel error-panel">{error}</div>}

      {bundle && currentStructureText ? (
        <Workspace
          bundle={bundle}
          structureText={currentStructureText}
          hoveredResidues={hoveredResidues}
          pinnedResidues={pinnedResidues}
          pinnedCell={pinnedCell}
          hoveredCell={hoveredCell}
          brushSelection={brushSelection}
          interactionPerformance={interactionPerformance}
          paeHoverSyncEnabled={paeHoverSyncEnabled}
          paePairSelectionEnabled={paePairSelectionEnabled}
          colorByPLDDTToggleStatus={colorByPLDDTToggleStatus}
          colorByPLDDTEnabled={colorByPLDDTEnabled}
          onHoverResidues={(indices) => setHoveredResidues(indices)}
          onHoverCell={setHoveredCell}
          onPinResidues={(indices) => setPinnedResidues(indices)}
          onPinCell={setPinnedCell}
          onBrushSelectionChange={setBrushSelection}
          onTogglePaeHoverSync={() => {
            setPaeHoverSyncEnabled((enabled) => {
              const next = !enabled;
              if (!next) setHoveredResidues([]);
              return next;
            });
          }}
          onTogglePaePairSelection={() => {
            setPaePairSelectionEnabled((enabled) => {
              const next = !enabled;
              if (!next) {
                setPinnedCell((currentPinnedCell) => {
                  if (currentPinnedCell) setPinnedResidues([]);
                  return null;
                });
              }
              return next;
            });
          }}
          onClearPairSelection={() => {
            setPinnedCell(null);
            setPinnedResidues([]);
          }}
          onToggleColorByPLDDT={() => setColorByPLDDTToggleStatus((enabled) => !enabled)}
          onEnableColorByPLDDT={() => {
            setColorByPLDDTEnabled((enabled) => {
              const next = !enabled;  // make a new variable that is the other boolean
              if (!next) {
                // on disabling, also turn it off
                setColorByPLDDTToggleStatus(false);
              }
              return next;
            })
          }}
        />
      ) : (
        <section className="panel empty-panel">
          <h2>No prediction loaded yet</h2>
          <p>Load a bundle to see the linked sequence, PAE, and Mol* views.</p>
        </section>
      )}
    </main>
  );
}
