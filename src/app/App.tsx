import { useEffect, useMemo, useRef, useState } from 'react';
import { FileImportPanel } from '../components/FileImportPanel';
import { ResolverPanel } from '../components/ResolverPanel';
import { Workspace } from '../components/Workspace';
import type {
  BundleChoice,
  DiscoveryGroup,
  PredictionBundle,
  WorkerInputFile,
} from '../lib/types';

const worker = new Worker(new URL('../lib/worker/parse-worker.ts', import.meta.url), { type: 'module' });
const STORAGE_KEY = 'af-molstar-viewer:selected-group';

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
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [brushSelection, setBrushSelection] = useState<{ xStart: number; xEnd: number; yStart: number; yEnd: number } | null>(null);
  const pendingResolver = useRef<((payload: unknown) => void) | null>(null);

  const fileMap = useMemo(() => new Map(files.map((file) => [file.name, file.text])), [files]);
  const unresolvedGroups = useMemo(() => groups.filter((group) => group.unresolved), [groups]);

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
    setHoveredCell(null);
    setBrushSelection(null);
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

      {error && <div className="panel error-panel">{error}</div>}

      {bundle && currentStructureText ? (
        <Workspace
          bundle={bundle}
          structureText={currentStructureText}
          hoveredResidues={hoveredResidues}
          pinnedResidues={pinnedResidues}
          hoveredCell={hoveredCell}
          brushSelection={brushSelection}
          onHoverResidues={(indices) => setHoveredResidues(indices)}
          onHoverCell={setHoveredCell}
          onPinResidues={(indices) => setPinnedResidues(indices)}
          onBrushSelectionChange={setBrushSelection}
        />
      ) : (
        <section className="panel empty-panel">
          <p className="eyebrow">Workspace</p>
          <h2>No prediction loaded yet</h2>
          <p>Load a bundle to see the linked sequence, PAE, and Mol* views.</p>
        </section>
      )}
    </main>
  );
}
