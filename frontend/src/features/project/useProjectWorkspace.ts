import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LoadedViewerArtifact,
  ViewerConfiguration,
  ViewerStateSnapshot,
  WorkspaceProject,
} from '../../domain/project';
import {
  canonicalizeChainRanges,
  indicesAndResiduesToMatch,
  matchChainRangesAndResidues,
  selectionDraftAndArtifactToMatch,
  selectionDraftToChainRanges,
} from '../../domain/selection';
import type { RangeResidueMatch } from '../../lib/types';
import { EXAMPLES } from '../import/examples';
import { loadViewerArtifact } from '../../services/project/load-viewer-artifact';
import type { ProjectApi } from '../../services/project/project-api';
import { createProjectApi } from '../../services/project/project-api';
import { getLatestViewerState, upsertViewerState } from '../viewer/viewer-state';
import type { WorkerInputFile } from '../../lib/types';
import { PAE_HOVER_SYNC_RESIDUE_THRESHOLD } from './ArtifactWorkspace';

interface UseProjectWorkspaceOptions {
  api?: ProjectApi;
}

function downloadTextFile(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function isActiveJob(status: WorkspaceProject['jobs'][number]['status']) {
  return status === 'queued' || status === 'running';
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}`));
    reader.readAsText(file);
  });
}

function omitKey<T>(record: Record<string, T>, keyToOmit: string) {
  const { [keyToOmit]: _omitted, ...rest } = record;
  return rest;
}

export interface ProjectWorkspaceState {
  project: WorkspaceProject | null;
  selectedTargetId: string | null;
  compareValidationIds: string[];
  viewerArtifacts: Record<string, LoadedViewerArtifact>;
  draftByArtifact: Record<string, string>;
  matchByArtifact: Record<string, RangeResidueMatch | null>;
  selectionEnabledByArtifact: Record<string, boolean>;
  themeByArtifact: Record<string, boolean>;
  paeDrawerOpenByArtifact: Record<string, boolean>;
  brushSelectionByArtifact: Record<string, { xStart: number; xEnd: number; yStart: number; yEnd: number } | null>;
  pinnedResiduesByArtifact: Record<string, number[]>;
  pinnedCellByArtifact: Record<string, { x: number; y: number } | null>;
  paeHoverSyncEnabledByArtifact: Record<string, boolean>;
  paePairSelectionEnabledByArtifact: Record<string, boolean>;
  selectionSyncNonce: number;
  isDraftFocused: boolean;
  focusByArtifact: Record<string, number[]>;
  pendingDerivedTargetJobIds: string[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  selectedTarget: WorkspaceProject['targets'][number] | null;
  compareValidations: WorkspaceProject['binder_validations'];
  selectedArtifact: LoadedViewerArtifact | null;
  selectedTargetViewerState: ViewerStateSnapshot | null;
  focusIndices: number[];
  focusDisplayString: string;
  selectionDraft: string;
  match: RangeResidueMatch | null;
  selectionIndices: number[] | null;
  selectionEnabled: boolean;
  selectionDisplayString: string;
  hasActiveSelection: boolean;
  brushSelection: { xStart: number; xEnd: number; yStart: number; yEnd: number } | null;
  pinnedResidues: number[];
  pinnedCell: { x: number; y: number } | null;
  paeHoverSyncEnabled: boolean;
  paePairSelectionEnabled: boolean;
  onSelectTarget: (targetId: string) => void;
  onToggleValidationCompare: (validationId: string) => void;
  onDraftFocus: () => void;
  onDraftChange: (value: string) => void;
  onDraftBlur: (value: string) => void;
  onSaveInterface: (value: string) => void;
  onCropToSelection: () => void;
  onCutOffSelection: () => void;
  onResetAuthIndexing: () => void;
  onDownloadStructure: () => void;
  onDownloadViewerState: () => void;
  onNativeViewerStateDownloadReady: (download: (() => void) | null) => void;
  onGenerateBinders: (selectionDraft: string) => void;
  onValidateRefolding: () => void;
  onSaveViewerState: () => void;
  onSelectionIndicesChange: (indices: number[]) => void;
  onSelectionModeChange: (enabled: boolean) => void;
  onFocusIndicesChange: (indices: number[]) => void;
  onBrushSelectionChange: (artifactId: string, selection: { xStart: number; xEnd: number; yStart: number; yEnd: number } | null) => void;
  onPinResidues: (artifactId: string, indices: number[]) => void;
  onPinCell: (artifactId: string, cell: { x: number; y: number } | null) => void;
  onTogglePaeHoverSync: (artifactId: string) => void;
  onTogglePaePairSelection: (artifactId: string) => void;
  onClearPairSelection: (artifactId: string) => void;
  onThemeChange: (artifactId: string, enabled: boolean) => void;
  onToggleTheme: (artifactId: string) => void;
  onPaeDrawerOpenChange: (artifactId: string, open: boolean) => void;
  onTogglePaeDrawer: (artifactId: string) => void;
  onImportPaeData: (artifactId: string, paeMatrix: number[][], paeMax: number) => void;
  onViewerStateChange: (artifactId: string, viewerConfiguration: ViewerConfiguration, label: string, payload: Record<string, unknown>) => void;
  onUploadTargetFiles: (files: File[]) => Promise<void>;
  onLoadExample: (exampleId: string) => Promise<void>;
  onRemoveTarget: (targetId: string) => Promise<void>;
}

export function useProjectWorkspace(options: UseProjectWorkspaceOptions = {}): ProjectWorkspaceState {
  const api = useMemo(() => options.api ?? createProjectApi(), [options.api]);
  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [compareValidationIds, setCompareValidationIds] = useState<string[]>([]);
  const [viewerArtifacts, setViewerArtifacts] = useState<Record<string, LoadedViewerArtifact>>({});
  const [draftByArtifact, setDraftByArtifact] = useState<Record<string, string>>({});
  const [matchByArtifact, setMatchByArtifact] = useState<Record<string, RangeResidueMatch | null>>({});
  const [selectionEnabledByArtifact, setSelectionEnabledByArtifact] = useState<Record<string, boolean>>({});
  const [themeByArtifact, setThemeByArtifact] = useState<Record<string, boolean>>({});
  const [paeDrawerOpenByArtifact, setPaeDrawerOpenByArtifact] = useState<Record<string, boolean>>({});
  const [brushSelectionByArtifact, setBrushSelectionByArtifact] = useState<Record<string, { xStart: number; xEnd: number; yStart: number; yEnd: number } | null>>({});
  const [pinnedResiduesByArtifact, setPinnedResiduesByArtifact] = useState<Record<string, number[]>>({});
  const [pinnedCellByArtifact, setPinnedCellByArtifact] = useState<Record<string, { x: number; y: number } | null>>({});
  const [paeHoverSyncEnabledByArtifact, setPaeHoverSyncEnabledByArtifact] = useState<Record<string, boolean>>({});
  const [paePairSelectionEnabledByArtifact, setPaePairSelectionEnabledByArtifact] = useState<Record<string, boolean>>({});
  const [selectionSyncNonce, setSelectionSyncNonce] = useState(0);
  const [isDraftFocused, setDraftFocused] = useState(false);
  const [focusByArtifact, setFocusByArtifact] = useState<Record<string, number[]>>({});
  const liveSelectionDraftRef = useRef<string>('');
  const [pendingDerivedTargetJobIds, setPendingDerivedTargetJobIds] = useState<string[]>([]);
  const downloadViewerStateHandlerRef = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTargetIdRef = useRef<string | null>(selectedTargetId);

  const selectedTarget = project?.targets.find((target) => target.id === selectedTargetId) ?? null;
  const compareValidations = compareValidationIds
    .map((validationId) => project?.binder_validations.find((validation) => validation.id === validationId) ?? null)
    .filter((validation): validation is NonNullable<typeof validation> => validation !== null);
  const selectedArtifact = selectedTargetId ? viewerArtifacts[selectedTargetId] : null;
  const selectedTargetViewerState = getLatestViewerState(project, selectedTarget?.id ?? null, 'target');
  const focusIndices = selectedTarget ? (focusByArtifact[selectedTarget.id] ?? []) : [];
  const focusDisplayString = (() => {
    if (!selectedTarget || !selectedArtifact) return '';
    const canonical = indicesAndResiduesToMatch(focusIndices, selectedArtifact.bundle.residues).canonical;
    return canonical ? `Focus: ${canonical}` : '';
  })();

  const selectionDraft = selectedTarget ? (draftByArtifact[selectedTarget.id] ?? '') : '';
  const match = selectedTarget ? matchByArtifact[selectedTarget.id] : null;
  const selectionIndices = match ? match.residueIndices : null;
  const selectionEnabled = selectedTarget ? (selectionEnabledByArtifact[selectedTarget.id] ?? false) : false;
  const brushSelection = selectedTarget ? (brushSelectionByArtifact[selectedTarget.id] ?? null) : null;
  const pinnedResidues = selectedTarget ? (pinnedResiduesByArtifact[selectedTarget.id] ?? []) : [];
  const pinnedCell = selectedTarget ? (pinnedCellByArtifact[selectedTarget.id] ?? null) : null;
  const paeHoverSyncEnabled = selectedArtifact
    ? (paeHoverSyncEnabledByArtifact[selectedArtifact.artifactId] ?? (selectedArtifact.bundle.residues.length <= PAE_HOVER_SYNC_RESIDUE_THRESHOLD))
    : false;
  const paePairSelectionEnabled = selectedArtifact ? (paePairSelectionEnabledByArtifact[selectedArtifact.artifactId] ?? true) : false;
  const selectionDisplayString = (() => {
    if (!selectedTarget || !selectedArtifact || !match) return '';
    const canonical = indicesAndResiduesToMatch(match.residueIndices, selectedArtifact.bundle.residues).canonical;
    return canonical ? `Selection: ${canonical}` : '';
  })();
  const hasActiveSelection = match ? Boolean(match.residues.length > 0) : false;

  const saveDraftByArtifact = (targetId: string, value: string) => {
    setDraftByArtifact((current) => ({
      ...current,
      [targetId]: value,
    }));
  };

  const saveMatchByArtifact = (targetId: string, value: RangeResidueMatch | null) => {
    setMatchByArtifact((current) => ({
      ...current,
      [targetId]: value,
    }));
  };

  const saveSelectionEnabledByArtifact = (targetId: string, value: boolean) => {
    if (!value && selectedTargetIdRef.current !== targetId) {
      return;
    }
    setSelectionEnabledByArtifact((current) => ({
      ...current,
      [targetId]: value,
    }));
    triggerSelectionSync();
  };

  const saveThemeByArtifact = (artifactId: string, value: boolean) => {
    setThemeByArtifact((current) => ({
      ...current,
      [artifactId]: value,
    }));
  };

  const savePaeDrawerOpenByArtifact = (artifactId: string, value: boolean) => {
    setPaeDrawerOpenByArtifact((current) => ({
      ...current,
      [artifactId]: value,
    }));
  };

  const saveBrushSelectionByArtifact = (artifactId: string, value: { xStart: number; xEnd: number; yStart: number; yEnd: number } | null) => {
    setBrushSelectionByArtifact((current) => ({
      ...current,
      [artifactId]: value,
    }));
  };

  const savePinnedResiduesByArtifact = (artifactId: string, value: number[]) => {
    setPinnedResiduesByArtifact((current) => ({
      ...current,
      [artifactId]: value,
    }));
  };

  const savePinnedCellByArtifact = (artifactId: string, value: { x: number; y: number } | null) => {
    setPinnedCellByArtifact((current) => ({
      ...current,
      [artifactId]: value,
    }));
  };

  const savePaeHoverSyncEnabledByArtifact = (artifactId: string, value: boolean) => {
    setPaeHoverSyncEnabledByArtifact((current) => ({
      ...current,
      [artifactId]: value,
    }));
  };

  const savePaePairSelectionEnabledByArtifact = (artifactId: string, value: boolean) => {
    setPaePairSelectionEnabledByArtifact((current) => ({
      ...current,
      [artifactId]: value,
    }));
  };

  const triggerSelectionSync = () => {
    setSelectionSyncNonce((current) => current + 1);
  };

  const persistViewerState = async (
    artifactId: string,
    viewerConfiguration: ViewerConfiguration,
    label: string,
    payload: Record<string, unknown>,
  ) => {
    if (!project) return;
    try {
      const snapshot = await api.saveViewerState(project.id, artifactId, label, payload, viewerConfiguration);
      setProject((current) => (current && current.id === project.id ? upsertViewerState(current, snapshot) : current));
    } catch (viewerStateError) {
      setError(viewerStateError instanceof Error ? viewerStateError.message : 'Unable to persist viewer state');
    }
  };

  useEffect(() => {
    selectedTargetIdRef.current = selectedTargetId;
  }, [selectedTargetId]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      setLoading(true);
      setError(null);
      try {
        const nextProject = await api.createProject();
        if (cancelled) return;
        setProject(nextProject);
        const preferredTarget = nextProject.targets[0] ?? null;
        setSelectedTargetId(preferredTarget?.id ?? null);
        setDraftByArtifact(Object.fromEntries(nextProject.targets.map((target) => [target.id, ''])));
        setMatchByArtifact(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, null])),
        );
        setSelectionEnabledByArtifact(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, false])),
        );
        setBrushSelectionByArtifact(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, null])),
        );
        setPinnedResiduesByArtifact(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, []])),
        );
        setPinnedCellByArtifact(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, null])),
        );
        setPaePairSelectionEnabledByArtifact(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, true])),
        );
      } catch (appError) {
        if (!cancelled) {
          setError(appError instanceof Error ? appError.message : 'Unable to initialize project');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!project) return;
    setDraftByArtifact((current) => {
      const next = Object.fromEntries(
        project.targets.map((target) => [target.id, current[target.id] ?? '']),
      );
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([targetId, value]) => current[targetId] === value);
      return same ? current : next;
    });
    setMatchByArtifact((current) => {
      const next = Object.fromEntries(
        project.targets.map((target) => [target.id, current[target.id] ?? null]),
      );
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([targetId, value]) => current[targetId] === value);
      return same ? current : next;
    });
    setSelectionEnabledByArtifact((current) => {
      const next = Object.fromEntries(
        project.targets.map((target) => [target.id, current[target.id] ?? false]),
      );
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([targetId, value]) => current[targetId] === value);
      return same ? current : next;
    });
    const artifactIds = new Set([
      ...project.targets.map((target) => target.id),
      ...project.binder_validations.map((validation) => validation.id),
    ]);
    setThemeByArtifact((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([targetId]) => artifactIds.has(targetId)));
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([targetId, value]) => current[targetId] === value);
      return same ? current : next;
    });
    setPaeDrawerOpenByArtifact((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([targetId]) => artifactIds.has(targetId)));
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([targetId, value]) => current[targetId] === value);
      return same ? current : next;
    });
    setBrushSelectionByArtifact((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([targetId]) => artifactIds.has(targetId)));
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([targetId, value]) => current[targetId] === value);
      return same ? current : next;
    });
    setPinnedResiduesByArtifact((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([targetId]) => artifactIds.has(targetId)));
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([targetId, value]) => current[targetId] === value);
      return same ? current : next;
    });
    setPinnedCellByArtifact((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([targetId]) => artifactIds.has(targetId)));
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([targetId, value]) => current[targetId] === value);
      return same ? current : next;
    });
    setPaePairSelectionEnabledByArtifact((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([targetId]) => artifactIds.has(targetId)));
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([targetId, value]) => current[targetId] === value);
      return same ? current : next;
    });
  }, [project]);

  useEffect(() => {
    if (!project) return;
    setBrushSelectionByArtifact((current) => {
      let changed = false;
      const next = { ...current };
      for (const target of project.targets) {
        if (next[target.id] === undefined) {
          next[target.id] = null;
          changed = true;
        }
      }
      for (const validation of project.binder_validations) {
        if (next[validation.id] === undefined) {
          next[validation.id] = null;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setPinnedResiduesByArtifact((current) => {
      let changed = false;
      const next = { ...current };
      for (const target of project.targets) {
        if (next[target.id] === undefined) {
          next[target.id] = [];
          changed = true;
        }
      }
      for (const validation of project.binder_validations) {
        if (next[validation.id] === undefined) {
          next[validation.id] = [];
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setPinnedCellByArtifact((current) => {
      let changed = false;
      const next = { ...current };
      for (const target of project.targets) {
        if (next[target.id] === undefined) {
          next[target.id] = null;
          changed = true;
        }
      }
      for (const validation of project.binder_validations) {
        if (next[validation.id] === undefined) {
          next[validation.id] = null;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setPaeHoverSyncEnabledByArtifact((current) => {
      let changed = false;
      const next = { ...current };
      for (const target of project.targets) {
        if (next[target.id] === undefined && viewerArtifacts[target.id]) {
          next[target.id] = viewerArtifacts[target.id].bundle.residues.length <= PAE_HOVER_SYNC_RESIDUE_THRESHOLD;
          changed = true;
        }
      }
      for (const validation of project.binder_validations) {
        if (next[validation.id] === undefined && viewerArtifacts[validation.id]) {
          next[validation.id] = viewerArtifacts[validation.id].bundle.residues.length <= PAE_HOVER_SYNC_RESIDUE_THRESHOLD;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setPaePairSelectionEnabledByArtifact((current) => {
      let changed = false;
      const next = { ...current };
      for (const target of project.targets) {
        if (next[target.id] === undefined) {
          next[target.id] = true;
          changed = true;
        }
      }
      for (const validation of project.binder_validations) {
        if (next[validation.id] === undefined) {
          next[validation.id] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [project, viewerArtifacts]);

  useEffect(() => {
    if (!project) return;
    const artifactIds = [selectedTargetId, ...compareValidationIds].filter((value): value is string => Boolean(value));
    const missingArtifactIds = artifactIds.filter((artifactId) => !viewerArtifacts[artifactId]);
    if (missingArtifactIds.length === 0) return;
    let cancelled = false;

    const loadArtifacts = async () => {
      try {
        const resolved = await Promise.all(
          missingArtifactIds.map(async (artifactId) => {
            const source = await api.getViewerArtifact(project.id, artifactId);
            const artifact = await loadViewerArtifact(source);
            return [artifactId, artifact] as const;
          }),
        );
        if (cancelled) return;
        setViewerArtifacts((current) => ({
          ...current,
          ...Object.fromEntries(resolved),
        }));
      } catch (artifactError) {
        if (!cancelled) {
          setError(artifactError instanceof Error ? artifactError.message : 'Unable to load viewer artifact');
        }
      }
    };

    void loadArtifacts();
    return () => {
      cancelled = true;
    };
  }, [api, project, selectedTargetId, compareValidationIds, viewerArtifacts]);

  useEffect(() => {
    if (!project || !project.jobs.some((job) => isActiveJob(job.status))) return;
    let cancelled = false;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const resolvedJobs = await Promise.all(project.jobs.map((job) => api.getJob(job.job_id)));
          const refreshed = await api.getProject(project.id);
          if (cancelled) return;
          setProject(refreshed);
          const activatedJob =
            resolvedJobs.find(
              (job) =>
                pendingDerivedTargetJobIds.includes(job.job_id) &&
                job.status === 'succeeded' &&
                job.target_ids.length > 0,
            ) ?? null;
          const activatedTargetId = activatedJob?.target_ids.at(-1) ?? null;
          if (activatedTargetId) {
            setSelectedTargetId(activatedTargetId);
            setPendingDerivedTargetJobIds((current) => current.filter((jobId) => jobId !== activatedJob?.job_id));
          } else if (!refreshed.targets.some((target) => target.id === selectedTargetId)) {
            setSelectedTargetId(refreshed.targets.at(-1)?.id ?? refreshed.targets[0]?.id ?? null);
          }
        } catch (pollError) {
          if (!cancelled) {
            setError(pollError instanceof Error ? pollError.message : 'Unable to poll jobs');
          }
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [api, pendingDerivedTargetJobIds, project, selectedTargetId]);

  const refreshProject = async (projectId: string) => {
    const refreshed = await api.getProject(projectId);
    setProject(refreshed);
    return refreshed;
  };

  const runMutation = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (project) {
        await refreshProject(project.id);
      }
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Mutation failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadTargetFiles = async (files: File[]) => {
    if (!project || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const workerFiles: WorkerInputFile[] = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          text: await readFileAsText(file),
        })),
      );
      const result = await api.uploadTarget(project.id, workerFiles);
      setProject(result.project);
      setSelectedTargetId(result.target.id);
      setCompareValidationIds([]);
      saveDraftByArtifact(result.target.id, '');
      saveMatchByArtifact(result.target.id, null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload target');
    } finally {
      setBusy(false);
    }
  };

  const loadExample = async (exampleId: string) => {
    if (!project) return;
    const example = EXAMPLES.find((entry) => entry.id === exampleId);
    if (!example) return;
    setBusy(true);
    setError(null);
    try {
      const workerFiles: WorkerInputFile[] = example.files.map((file) => {
        if (typeof file.text !== 'string') {
          throw new Error(`Example ${example.label} is missing embedded fixture text for ${file.name}`);
        }
        return {
          name: file.name,
          text: file.text,
        };
      });
      const result = await api.uploadTarget(project.id, workerFiles);
      setProject(result.project);
      setSelectedTargetId(result.target.id);
      setCompareValidationIds([]);
      saveDraftByArtifact(result.target.id, '');
      saveMatchByArtifact(result.target.id, null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load example');
    } finally {
      setBusy(false);
    }
  };

  const removeTarget = async (targetId: string) => {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.removeTarget(project.id, targetId);
      const removedValidationIds = new Set(
        project.binder_validations.filter((validation) => validation.target_id === targetId).map((validation) => validation.id),
      );
      setProject(updated);
      setSelectedTargetId((current) => {
        if (current !== targetId) return current;
        return updated.targets.at(-1)?.id ?? updated.targets[0]?.id ?? null;
      });
      setCompareValidationIds((current) =>
        current.filter((validationId) => !removedValidationIds.has(validationId) && updated.binder_validations.some((entry) => entry.id === validationId)),
      );
      setDraftByArtifact((current) => omitKey(current, targetId));
      setMatchByArtifact((current) => omitKey(current, targetId));
      setSelectionEnabledByArtifact((current) => omitKey(current, targetId));
      setThemeByArtifact((current) => omitKey(current, targetId));
      setPaeDrawerOpenByArtifact((current) => omitKey(current, targetId));
      setBrushSelectionByArtifact((current) => omitKey(current, targetId));
      setPinnedResiduesByArtifact((current) => omitKey(current, targetId));
      setPinnedCellByArtifact((current) => omitKey(current, targetId));
      setPaeHoverSyncEnabledByArtifact((current) => omitKey(current, targetId));
      setPaePairSelectionEnabledByArtifact((current) => omitKey(current, targetId));
      setViewerArtifacts((current) => omitKey(current, targetId));
      setFocusByArtifact((current) => omitKey(current, targetId));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove target');
    } finally {
      setBusy(false);
    }
  };

  const onDraftFocus = () => {
    setDraftFocused(true);
    const targetId = selectedTargetIdRef.current;
    if (targetId) saveSelectionEnabledByArtifact(targetId, true);
  };

  const onDraftChange = (value: string) => {
    liveSelectionDraftRef.current = value;
  };

  const onDraftBlur = (value: string) => {
    setDraftFocused(false);
    if (!selectedTarget || !selectedArtifact) return;
    try {
      saveDraftByArtifact(selectedTarget.id, value);
      const ranges = selectionDraftToChainRanges(value);
      const rangeDisplayString = canonicalizeChainRanges(ranges);
      const resolvedMatch = matchChainRangesAndResidues(ranges, selectedArtifact.bundle.residues);
      if (resolvedMatch.canonical === '') return;
      saveDraftByArtifact(selectedTarget.id, resolvedMatch.canonical);
      saveMatchByArtifact(selectedTarget.id, resolvedMatch);
      triggerSelectionSync();
      if (resolvedMatch.canonical === rangeDisplayString) {
        setError(null);
      } else {
        throw new Error(`Not all listed residues found in structure: ${rangeDisplayString} → ${resolvedMatch.canonical}`);
      }
    } catch (draftError) {
      console.warn('onInterfaceDraftBlur:', draftError);
      setError(draftError instanceof Error ? draftError.message : 'Unable to resolve the selection draft.');
    }
  };

  const onSaveInterface = (value: string) =>
    void runMutation(async () => {
      if (!selectedTarget || !selectedArtifact) return;
      const match = selectionDraftAndArtifactToMatch(value, selectedArtifact);
      if (!match) return;

      const updated = await api.updateTargetInterface(project!.id, selectedTarget.id, match.canonical);
      setProject(updated);
      saveDraftByArtifact(selectedTarget.id, match.canonical);
      saveMatchByArtifact(selectedTarget.id, match);
      triggerSelectionSync();
    });

  const onCropToSelection = () =>
    void runMutation(async () => {
      if (!selectedTarget) return;
      const job = await api.cropTargetToSelection(project!.id, selectedTarget.id, draftByArtifact[selectedTarget.id]);
      setPendingDerivedTargetJobIds((current) => [...current, job.job_id]);
      await refreshProject(project!.id);
    });

  const onCutOffSelection = () =>
    void runMutation(async () => {
      if (!selectedTarget) return;
      const job = await api.cutSelectionOffTarget(project!.id, selectedTarget.id, draftByArtifact[selectedTarget.id]);
      setPendingDerivedTargetJobIds((current) => [...current, job.job_id]);
      await refreshProject(project!.id);
    });

  const onResetAuthIndexing = () =>
    // This does not need an actual selection like the other two operations!
    void runMutation(async () => {
      if (!selectedTarget || !selectedArtifact) return;
      const job = await api.resetAuthIndexing(project!.id, selectedTarget.id);
      setPendingDerivedTargetJobIds((current) => [...current, job.job_id]);
      await refreshProject(project!.id);
    });

  const onDownloadStructure = () => {
    if (!selectedTarget || !selectedArtifact) return;
    downloadTextFile(selectedTarget.name, selectedArtifact.structureText);
  };

  const onDownloadViewerState = () => {
    downloadViewerStateHandlerRef.current?.();
  };

  const onNativeViewerStateDownloadReady = (download: (() => void) | null) => {
    downloadViewerStateHandlerRef.current = download;
  };

  const onGenerateBinders = (selectionDraft: string) =>
    void runMutation(async () => {
      if (!selectedTarget) return;
      await api.generateBinders(project!.id, selectedTarget.id, selectionDraft || draftByArtifact[selectedTarget.id] || selectedTarget.selection);
    });

  const onValidateRefolding = () =>
    void runMutation(async () => {
      if (!project) return;
      await api.validateRefolding(project.id, project.binder_candidates.map((candidate) => candidate.id));
    });

  const onSaveViewerState = () =>
    void runMutation(async () => {
      if (!selectedTarget) return;
      await api.saveViewerState(
        project!.id,
        selectedTarget.id,
        `${selectedTarget.name} view ${project!.viewer_states.length + 1}`,
        selectedTargetViewerState?.payload ?? {},
        'target',
      );
    });

  const onSelectionIndicesChange = (indices: number[]) => {
    if (!selectedTarget || !selectedArtifact) return;
    const targetId = selectedTarget.id;
    const resolvedMatch = indicesAndResiduesToMatch(indices, selectedArtifact.bundle.residues);
    saveDraftByArtifact(targetId, resolvedMatch.canonical);
    saveMatchByArtifact(targetId, resolvedMatch);
  };

  const onSelectionModeChange = (enabled: boolean) => {
    const targetId = selectedTargetIdRef.current;
    if (!targetId) return;
    saveSelectionEnabledByArtifact(targetId, enabled);
  };

  const onBrushSelectionChange = (artifactId: string, selection: { xStart: number; xEnd: number; yStart: number; yEnd: number } | null) => {
    saveBrushSelectionByArtifact(artifactId, selection);
  };

  const onPinResidues = (artifactId: string, indices: number[]) => {
    savePinnedResiduesByArtifact(artifactId, indices);
  };

  const onPinCell = (artifactId: string, cell: { x: number; y: number } | null) => {
    savePinnedCellByArtifact(artifactId, cell);
  };

  const onTogglePaeHoverSync = (artifactId: string) => {
    const artifact = viewerArtifacts[artifactId];
    const currentEnabled =
      paeHoverSyncEnabledByArtifact[artifactId] ?? Boolean(artifact && artifact.bundle.residues.length <= PAE_HOVER_SYNC_RESIDUE_THRESHOLD);
    savePaeHoverSyncEnabledByArtifact(artifactId, !currentEnabled);
  };

  const onTogglePaePairSelection = (artifactId: string) => {
    const currentEnabled = paePairSelectionEnabledByArtifact[artifactId] ?? true;
    const next = !currentEnabled;
    savePaePairSelectionEnabledByArtifact(artifactId, next);
    if (!next) {
      savePinnedCellByArtifact(artifactId, null);
      savePinnedResiduesByArtifact(artifactId, []);
    }
  };

  const onClearPairSelection = (artifactId: string) => {
    savePinnedCellByArtifact(artifactId, null);
    savePinnedResiduesByArtifact(artifactId, []);
  };

  const onFocusIndicesChange = (indices: number[]) => {
    if (!selectedArtifact) return;
    setFocusByArtifact((current) => ({
      ...current,
      [selectedArtifact.artifactId]: indices,
    }));
  };

  const onThemeChange = (artifactId: string, enabled: boolean) => {
    saveThemeByArtifact(artifactId, enabled);
  };

  const onToggleTheme = (artifactId: string) => {
    const currentEnabled = themeByArtifact[artifactId] ?? viewerArtifacts[artifactId]?.bundle.metadata.looksLikePLDDTs ?? false;
    saveThemeByArtifact(artifactId, !currentEnabled);
  };

  const onPaeDrawerOpenChange = (artifactId: string, open: boolean) => {
    savePaeDrawerOpenByArtifact(artifactId, open);
  };

  const onTogglePaeDrawer = (artifactId: string) => {
    const currentOpen = paeDrawerOpenByArtifact[artifactId] ?? false;
    savePaeDrawerOpenByArtifact(artifactId, !currentOpen);
  };

  const onImportPaeData = (artifactId: string, paeMatrix: number[][], paeMax: number) => {
    setViewerArtifacts((current) => {
      const artifact = current[artifactId];
      if (!artifact) return current;
      return {
        ...current,
        [artifactId]: {
          ...artifact,
          bundle: {
            ...artifact.bundle,
            paeMatrix,
            paeMax,
            metadata: {
              ...artifact.bundle.metadata,
              syntheticPae: false,
            },
          },
        },
      };
    });
  };

  const onViewerStateChange = (
    artifactId: string,
    viewerConfiguration: ViewerConfiguration,
    label: string,
    payload: Record<string, unknown>,
  ) => {
    void persistViewerState(artifactId, viewerConfiguration, label, payload);
  };

  const onToggleValidationCompare = (validationId: string) => {
    setCompareValidationIds((current) =>
      current.includes(validationId) ? current.filter((entry) => entry !== validationId) : [...current, validationId].slice(-2),
    );
  };

  const onSelectTarget = (targetId: string) => {
    setSelectedTargetId(targetId);
  };

  return {
    project,
    selectedTargetId,
    compareValidationIds,
    viewerArtifacts,
    draftByArtifact,
    matchByArtifact,
    selectionEnabledByArtifact,
    themeByArtifact,
    paeDrawerOpenByArtifact,
    brushSelectionByArtifact,
    pinnedResiduesByArtifact,
    pinnedCellByArtifact,
    paeHoverSyncEnabledByArtifact,
    paePairSelectionEnabledByArtifact,
    selectionSyncNonce,
    isDraftFocused,
    focusByArtifact,
    pendingDerivedTargetJobIds,
    loading,
    busy,
    error,
    selectedTarget,
    compareValidations,
    selectedArtifact,
    selectedTargetViewerState,
    focusIndices,
    focusDisplayString,
    selectionDraft,
    match,
    selectionIndices,
    selectionEnabled,
    selectionDisplayString,
    hasActiveSelection,
    brushSelection,
    pinnedResidues,
    pinnedCell,
    paeHoverSyncEnabled,
    paePairSelectionEnabled,
    onSelectTarget,
    onToggleValidationCompare,
    onDraftFocus,
    onDraftChange,
    onDraftBlur,
    onSaveInterface,
    onCropToSelection,
    onCutOffSelection,
    onResetAuthIndexing,
    onDownloadStructure,
    onDownloadViewerState,
    onNativeViewerStateDownloadReady,
    onGenerateBinders,
    onValidateRefolding,
    onSaveViewerState,
    onSelectionIndicesChange,
    onSelectionModeChange,
    onFocusIndicesChange,
    onBrushSelectionChange,
    onPinResidues,
    onPinCell,
    onTogglePaeHoverSync,
    onTogglePaePairSelection,
    onClearPairSelection,
    onThemeChange,
    onToggleTheme,
    onPaeDrawerOpenChange,
    onTogglePaeDrawer,
    onImportPaeData,
    onViewerStateChange,
    onUploadTargetFiles: uploadTargetFiles,
    onLoadExample: loadExample,
    onRemoveTarget: removeTarget,
  };
}
