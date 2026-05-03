import { useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLES } from './examples';
import type { LoadedViewerArtifact, ViewerConfiguration, ViewerStateSnapshot, WorkspaceProject } from '../domain/project-types';
import { canonicalizeChainRanges, indicesAndResiduesToMatch, matchChainRangesAndResidues, selectionDraftAndArtifactToMatch, selectionDraftToChainRanges } from '../domain/target-interface';
import { RangeResidueMatch } from '../lib/types';
import { ArtifactWorkspace } from '../components/project/ArtifactWorkspace';
import { ProjectSidebar } from '../components/project/ProjectSidebar';
import { loadViewerArtifact } from '../lib/project/load-viewer-artifact';
import type { ProjectApi } from '../lib/project/project-api';
import { createProjectApi } from '../lib/project/project-api';
import type { WorkerInputFile } from '../lib/types';

interface AppProps {
  api?: ProjectApi;
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

function getLatestViewerState(
  project: WorkspaceProject | null,
  artifactId: string | null,
  viewerConfiguration: ViewerConfiguration,
) {
  if (!project || !artifactId) return null;
  return (
    project.viewer_states
      .filter(
        (state) => state.artifact_id === artifactId && state.viewer_configuration === viewerConfiguration,
      )
      .sort((left, right) => right.updated_at - left.updated_at)[0] ?? null
  );
}

function upsertViewerState(project: WorkspaceProject, snapshot: ViewerStateSnapshot) {
  const existingIndex = project.viewer_states.findIndex((state) => state.id === snapshot.id);
  if (existingIndex >= 0) {
    const viewerStates = [...project.viewer_states];
    viewerStates.splice(existingIndex, 1, snapshot);
    return { ...project, viewer_states: viewerStates };
  }
  return {
    ...project,
    viewer_states: [...project.viewer_states, snapshot],
  };
}

function omitKey<T>(record: Record<string, T>, keyToOmit: string) {
  const { [keyToOmit]: _omitted, ...rest } = record;
  return rest;
}

export function App(props: AppProps) {
  const api = useMemo(() => props.api ?? createProjectApi(), [props.api]);
  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [compareValidationIds, setCompareValidationIds] = useState<string[]>([]);
  const [viewerArtifacts, setViewerArtifacts] = useState<Record<string, LoadedViewerArtifact>>({});
  const [draftByArtifact, setDraftByArtifact] = useState<Record<string, string>>({});
  // const [selectionByArtifact, setSelectionByArtifact] = useState<Record<string, number[] | null>>({});
  const [matchByArtifact, setMatchByArtifact] = useState<Record<string, RangeResidueMatch | null>>({});
  const [selectionEnabledByArtifact, setSelectionEnabledByArtifact] = useState<Record<string, boolean>>({});
  const [selectionSyncNonce, setSelectionSyncNonce] = useState(0);
  const [isDraftFocused, setDraftFocused] = useState(false);
  const [focusByArtifact, setFocusByArtifact] = useState<Record<string, number[]>>({});
  const [pendingDerivedTargetJobIds, setPendingDerivedTargetJobIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTarget = project?.targets.find((target) => target.id === selectedTargetId) ?? null;
  const selectedTargetIdRef = useRef<string | null>(selectedTargetId);
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

  const selectionDraft = selectedTarget ? draftByArtifact[selectedTarget.id] : ''; // is this one being kept udpated?
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
              (job) => pendingDerivedTargetJobIds.includes(job.job_id) && job.status === 'succeeded' && job.target_ids.length > 0,
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

  if (loading) {
    return (
      <main className="app-shell">
        <section className="panel empty-panel">
          <h2>Loading project workspace…</h2>
        </section>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="app-shell">
        <section className="panel empty-panel">
          <h2>Project unavailable</h2>
          <p>{error ?? 'Unable to start the project workspace.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell app-shell-project">
      {error && <div className="panel error-panel">{error}</div>}

      <div className="project-layout">
        <ProjectSidebar
          project={project}
          selectedTargetId={selectedTargetId}
          focusDisplayString={focusDisplayString}
          selectionDisplayString={selectionDisplayString}
          hasActiveSelection={hasActiveSelection}
          selectionDraft={selectionDraft}
          compareValidationIds={compareValidationIds}
          busy={busy}
          onUploadTargetFiles={uploadTargetFiles}
          onLoadExample={loadExample}
          onSelectTarget={setSelectedTargetId}
          onRemoveTarget={(targetId) => {
            void removeTarget(targetId);
          }}
          onCropToSelection={() =>
            void runMutation(async () => {
              // console.debug('crop to')
              if (!selectedTarget) return;
              const job = await api.cropTargetToSelection(project.id, selectedTarget.id, draftByArtifact[selectedTarget.id]);
              setPendingDerivedTargetJobIds((current) => [...current, job.job_id]);
              await refreshProject(project.id);
            })
          }
          onCutOffSelection={() =>
            void runMutation(async () => {
              // console.info('cut off');
              if (!selectedTarget) return;
              const job = await api.cutSelectionOffTarget(project.id, selectedTarget.id, draftByArtifact[selectedTarget.id]);
              setPendingDerivedTargetJobIds((current) => [...current, job.job_id]);
              await refreshProject(project.id);
            })
          }
          onDraftFocus={() => {
            // console.log('onDraftFocus');
            setDraftFocused(true);
            if (selectedTarget) saveSelectionEnabledByArtifact(selectedTarget.id, true);
          }}
          onDraftBlur={(value) => {
            // when the user leaves the input field behind, try to transform this into a selection
            // console.log('onDraftBlur');
            setDraftFocused(false);
            if (!selectedTarget || !selectedArtifact) return;
            try {
              saveDraftByArtifact(selectedTarget.id, value);
              // TODO instead of value, I'd like to use selectionDraft below? is it too early?
              const ranges = selectionDraftToChainRanges(value);
              const rangeDisplayString = canonicalizeChainRanges(ranges);
              const match = matchChainRangesAndResidues(ranges, selectedArtifact.bundle.residues);
              // when the match is empty, don't change the selection
              if (match.canonical === '') return;
              // save the text and numbers
              saveDraftByArtifact(selectedTarget.id, match.canonical);
              saveMatchByArtifact(selectedTarget.id, match);
              triggerSelectionSync();
              if (match.canonical === rangeDisplayString) {
                setError(null);
              } else {
                throw new Error(`Not all listed residues found in structure: ${rangeDisplayString} → ${match.canonical}`);
              }

            } catch (draftError) {
              console.warn('onInterfaceDraftBlur:', draftError);
              setError(draftError instanceof Error ? draftError.message : 'Unable to resolve the selection draft.');
              // if not resolvable, don't change the current selection and don't save the new draft
            }
          }}
          onSaveInterface={() =>
            void runMutation(async () => {
              if (!selectedTarget) return;
              if (!selectedTarget || !selectedArtifact) return;
              const match = selectionDraftAndArtifactToMatch(selectionDraft, selectedArtifact);
              if (!match) return;

              const updated = await api.updateTargetInterface(project.id, selectedTarget.id, match.canonical);
              setProject(updated);
              saveDraftByArtifact(selectedTarget.id, match.canonical);
              saveMatchByArtifact(selectedTarget.id, match);
              triggerSelectionSync();
            })
          }
          onGenerateBinders={() =>
            void runMutation(async () => {
              if (!selectedTarget) return;
              const payload = '';
              await api.generateBinders(project.id, selectedTarget.id, payload);
            })
          }
          onValidateRefolding={() =>
            void runMutation(async () => {
              await api.validateRefolding(project.id, project.binder_candidates.map((candidate) => candidate.id));
            })
          }
          onSaveViewerState={() =>
            void runMutation(async () => {
              if (!selectedTarget) return;
              await api.saveViewerState(
                project.id,
                selectedTarget.id,
                `${selectedTarget.name} view ${project.viewer_states.length + 1}`,
                selectedTargetViewerState?.payload ?? {},
                'target',
              );
            })
          }
          onToggleValidationCompare={(validationId) =>
            setCompareValidationIds((current) =>
              current.includes(validationId) ? current.filter((entry) => entry !== validationId) : [...current, validationId].slice(-2),
            )
          }
        />

        <section className="project-main">
          <section className="panel viewer-context-panel">
            <div className="project-section-header">
              <div>
                <p className="eyebrow">Selected target</p>
                <h2>{selectedTarget?.name ?? 'No target selected'}</h2>
              </div>
              {selectedTarget && (
                <div className="viewer-context-meta">
                  <span>{selectedTarget.provenance.replace('_', ' ')}</span>
                  <span>{selectedTarget.selection}</span>
                </div>
              )}
            </div>
          </section>

          {selectedArtifact ? (
            <ArtifactWorkspace
              key={selectedArtifact.artifactId}
              artifact={selectedArtifact}
              viewerConfiguration="target"
              viewerStatePayload={selectedTargetViewerState?.payload ?? null}
              selectionIndices={selectionIndices}
              focusIndices={focusIndices}
              draftFocused={isDraftFocused}
              selectionEnabled={selectionEnabled}
              selectionSyncNonce={selectionSyncNonce}
              onSelectionIndicesChange={(indices) => {
                // This block was super important! Might still be able to be simplified?
                if (!selectedTarget) return;
                const targetId = selectedTarget.id;
                const match = indicesAndResiduesToMatch(indices, selectedArtifact.bundle.residues);
                saveDraftByArtifact(targetId, match.canonical);
                saveMatchByArtifact(targetId, match);
              }}
              onSelectionModeChange={(enabled) => {
                if (!selectedTarget) return;
                saveSelectionEnabledByArtifact(selectedTarget.id, enabled);
              }}
              onFocusIndicesChange={(indices) =>
                setFocusByArtifact((current) => ({
                  ...current,
                  [selectedArtifact.artifactId]: indices,
                }))
              }
              onViewerStateChange={(payload) => {
                void persistViewerState(selectedArtifact.artifactId, 'target', 'Current target view', payload);
              }}
            />
          ) : (
            <section className="panel empty-panel">
              <h2>No viewer artifact loaded</h2>
              <p>Select a target to load its Mol* workspace.</p>
            </section>
          )}

          {compareValidations.length > 0 && (
            <section className="panel compare-shell-panel">
              <div className="project-section-header">
                <div>
                  <p className="eyebrow">Comparison</p>
                  <h2>Side-by-side binder validations</h2>
                </div>
              </div>
              <div className="compare-grid">
                {compareValidations.map((validation) => {
                  const artifact = viewerArtifacts[validation.id];
                  return (
                    <div key={validation.id} className="compare-column">
                      <div className="compare-column-header">
                        <strong>{validation.name}</strong>
                        <span>{validation.id}</span>
                      </div>
                      {artifact ? (
                        <ArtifactWorkspace
                          key={artifact.artifactId}
                          artifact={artifact}
                          viewerConfiguration="validate_refolding"
                          viewerStatePayload={getLatestViewerState(project, validation.id, 'validate_refolding')?.payload ?? null}
                          selectionIndices={null}
                          focusIndices={null}
                          draftFocused={isDraftFocused}
                          selectionEnabled={selectionEnabled}
                          onViewerStateChange={(payload) => {
                            void persistViewerState(validation.id, 'validate_refolding', 'Current validate refolding view', payload);
                          }}
                        />
                      ) : (
                        <div className="panel empty-panel compare-empty-panel">
                          <h2>Loading validation…</h2>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
