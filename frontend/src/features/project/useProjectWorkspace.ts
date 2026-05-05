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

function debugLiveSelectionDraft(...args: unknown[]) {
  console.debug('[LiveSelectionDraft]', ...args);
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
  onSelectTarget: (targetId: string) => void;
  onToggleValidationCompare: (validationId: string) => void;
  onDraftFocus: () => void;
  onDraftChange: (value: string) => void;
  onDraftBlur: (value: string) => void;
  onSaveInterface: (value: string) => void;
  onCropToSelection: () => void;
  onCutOffSelection: () => void;
  onDownloadStructure: () => void;
  onDownloadViewerState: () => void;
  onNativeViewerStateDownloadReady: (download: (() => void) | null) => void;
  onGenerateBinders: (selectionDraft: string) => void;
  onValidateRefolding: () => void;
  onSaveViewerState: () => void;
  onSelectionIndicesChange: (indices: number[]) => void;
  onSelectionModeChange: (enabled: boolean) => void;
  onFocusIndicesChange: (indices: number[]) => void;
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

  const selectionDraft = selectedTarget ? (draftByArtifact[selectedTarget.id] ?? selectedTarget.selection ?? '') : '';
  const match = selectedTarget ? matchByArtifact[selectedTarget.id] : null;
  const selectionIndices = match ? match.residueIndices : null;
  const selectionEnabled = selectedTarget ? (selectionEnabledByArtifact[selectedTarget.id] ?? false) : false;
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
        setDraftByArtifact(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, target.selection])),
        );
        setMatchByArtifact(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, null])),
        );
        setSelectionEnabledByArtifact(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, false])),
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
        project.targets.map((target) => [target.id, current[target.id] ?? target.selection]),
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
  }, [project]);

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
      saveDraftByArtifact(result.target.id, result.target.selection);
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
      saveDraftByArtifact(result.target.id, result.target.selection);
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
    if (selectedTarget) saveSelectionEnabledByArtifact(selectedTarget.id, true);
  };

  const onDraftChange = (value: string) => {
    liveSelectionDraftRef.current = value;
    if (selectedTarget) {
      debugLiveSelectionDraft('draft input changed', {
        targetId: selectedTarget.id,
        liveSelectionDraft: value,
      });
    }
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
    if (!selectedTarget) return;
    saveSelectionEnabledByArtifact(selectedTarget.id, enabled);
  };

  const onFocusIndicesChange = (indices: number[]) => {
    if (!selectedArtifact) return;
    setFocusByArtifact((current) => ({
      ...current,
      [selectedArtifact.artifactId]: indices,
    }));
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
    onSelectTarget,
    onToggleValidationCompare,
    onDraftFocus,
    onDraftBlur,
    onSaveInterface,
    onCropToSelection,
    onCutOffSelection,
    onDownloadStructure,
    onDownloadViewerState,
    onNativeViewerStateDownloadReady,
    onGenerateBinders,
    onValidateRefolding,
    onSaveViewerState,
    onSelectionIndicesChange,
    onSelectionModeChange,
    onFocusIndicesChange,
    onViewerStateChange,
    onUploadTargetFiles: uploadTargetFiles,
    onLoadExample: loadExample,
    onRemoveTarget: removeTarget,
  };
}
