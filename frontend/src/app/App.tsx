import { useEffect, useMemo, useState } from 'react';
import { EXAMPLES } from './examples';
import type { LoadedViewerArtifact, ViewerConfiguration, ViewerStateSnapshot, WorkspaceProject } from '../domain/project-types';
import { canonicalizeTargetInterfaceResidues, parseTargetInterfaceResidues } from '../domain/target-interface';
import { ArtifactWorkspace } from '../components/project/ArtifactWorkspace';
import { ProjectSidebar } from '../components/project/ProjectSidebar';
import { loadViewerArtifact } from '../lib/project/load-viewer-artifact';
import type { ProjectApi } from '../lib/project/project-api';
import { createProjectApi } from '../lib/project/project-api';
import type { WorkerInputFile } from '../lib/types';
import { formatResidueSelection } from '../lib/utils';

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

function resolveInterfaceResidueIndices(
  artifact: LoadedViewerArtifact | null,
  input: string,
): number[] | null {
  if (!artifact) return null;
  if (!input.trim()) return [];

  try {
    const ranges = parseTargetInterfaceResidues(input);
    const indices = artifact.bundle.residues
      .filter((residue) =>
        ranges.some(
          (range) =>
            residue.chainId === range.chainId &&
            residue.authSeqId !== undefined &&
            residue.authSeqId >= range.start && 
            residue.authSeqId <= range.end,
        ),
      )
      .map((residue) => residue.index);
    
    const auth_res_indices = [...new Set(indices)].sort((left, right) => left - right);
    // console.debug('resolveInterfaceResidueIndices turned input', input, 'to ranges', ranges, 'and output', auth_res_indices);
    return auth_res_indices;
  } catch {
    console.debug('resolveInterfaceResidueIndices broke at input ', input);
    return null;
  }
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
  const [targetInterfaceDrafts, setTargetInterfaceDrafts] = useState<Record<string, string>>({});
  const [viewerArtifacts, setViewerArtifacts] = useState<Record<string, LoadedViewerArtifact>>({});
  const [viewerFocusSelections, setViewerFocusSelections] = useState<Record<string, number[]>>({});
  const [pendingDerivedTargetJobIds, setPendingDerivedTargetJobIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTarget = project?.targets.find((target) => target.id === selectedTargetId) ?? null;
  const compareValidations = compareValidationIds
    .map((validationId) => project?.binder_validations.find((validation) => validation.id === validationId) ?? null)
    .filter((validation): validation is NonNullable<typeof validation> => validation !== null);
  const selectedArtifact = selectedTargetId ? viewerArtifacts[selectedTargetId] : null;
  const interfaceDraft = selectedTarget ? (targetInterfaceDrafts[selectedTarget.id] ?? selectedTarget.target_interface_residues) : '';
  const selectedInterfaceResidues = resolveInterfaceResidueIndices(selectedArtifact, interfaceDraft);
  const selectedTargetFocusResidues = selectedTarget ? (viewerFocusSelections[selectedTarget.id] ?? []) : [];
  const selectedTargetViewerState = getLatestViewerState(project, selectedTarget?.id ?? null, 'target');
  const hasActiveSelection = Boolean(selectedInterfaceResidues && selectedInterfaceResidues.length > 0);
  const selectedTargetMolstarFocus =
    selectedTarget && selectedArtifact
      ? formatResidueSelection(selectedArtifact.bundle.residues, selectedTargetFocusResidues, {
          emptyLabel: 'nothing focussed',
        })
      : 'nothing focussed';
  const selectedTargetMolstarSelection =
    selectedTarget && selectedArtifact
      ? formatResidueSelection(selectedArtifact.bundle.residues, selectedInterfaceResidues ?? [], {
          emptyLabel: 'nothing selected',
        })
      : 'nothing selected';

  const setTargetInterfaceDraft = (targetId: string, value: string) => {
    setTargetInterfaceDrafts((current) => ({
      ...current,
      [targetId]: value,
    }));
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
        setTargetInterfaceDrafts(
          Object.fromEntries(nextProject.targets.map((target) => [target.id, target.target_interface_residues])),
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
    setTargetInterfaceDrafts((current) => {
      const next = Object.fromEntries(
        project.targets.map((target) => [target.id, current[target.id] ?? target.target_interface_residues]),
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
      setTargetInterfaceDraft(result.target.id, result.target.target_interface_residues);
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
      setTargetInterfaceDraft(result.target.id, result.target.target_interface_residues);
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
      setTargetInterfaceDrafts((current) => omitKey(current, targetId));
      setViewerArtifacts((current) => omitKey(current, targetId));
      setViewerFocusSelections((current) => omitKey(current, targetId));
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
          selectedTargetMolstarFocus={selectedTargetMolstarFocus}
          selectedTargetMolstarSelection={selectedTargetMolstarSelection}
          hasActiveSelection={hasActiveSelection}
          interfaceDraft={interfaceDraft}
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
              if (!selectedTarget) return;
              const canonicalSelection = canonicalizeTargetInterfaceResidues(interfaceDraft);
              const job = await api.cropTargetToSelection(project.id, selectedTarget.id, canonicalSelection);
              setPendingDerivedTargetJobIds((current) => [...current, job.job_id]);
              await refreshProject(project.id);
            })
          }
          onCutOffSelection={() =>
            void runMutation(async () => {
              if (!selectedTarget) return;
              const canonicalSelection = canonicalizeTargetInterfaceResidues(interfaceDraft);
              const job = await api.cutSelectionOffTarget(project.id, selectedTarget.id, canonicalSelection);
              setPendingDerivedTargetJobIds((current) => [...current, job.job_id]);
              await refreshProject(project.id);
            })
          }
          onInterfaceDraftChange={(value) => {
            console.debug('onInterfaceDraftChange value', value);
            if (!selectedTarget) return;
            setTargetInterfaceDraft(selectedTarget.id, value);
          }}
          onSaveInterface={() =>
            void runMutation(async () => {
              console.debug('onSaveInterface', interfaceDraft);
              if (!selectedTarget) return;
              const canonical = canonicalizeTargetInterfaceResidues(interfaceDraft);
              console.debug('onSaveInterface canonical residues', canonical);
              const updated = await api.updateTargetInterface(project.id, selectedTarget.id, canonical);
              setProject(updated);
              setTargetInterfaceDraft(selectedTarget.id, canonical);
            })
          }
          onGenerateBinders={() =>
            void runMutation(async () => {
              if (!selectedTarget) return;
              await api.generateBinders(project.id, selectedTarget.id, interfaceDraft);
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
                  <span>{selectedTarget.target_interface_residues}</span>
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
              selectedResidues={selectedInterfaceResidues}
              focusedResidues={selectedTargetFocusResidues}
              onSelectionResiduesChange={(indices) => {
                console.debug('artifactworkspace onSelectionResiduesChange', indices);
                const nextSelection = formatResidueSelection(selectedArtifact.bundle.residues, indices, {
                  emptyLabel: '',
                });
                setTargetInterfaceDraft(selectedArtifact.artifactId, nextSelection);
              }}
              onFocusResiduesChange={(indices) =>
                setViewerFocusSelections((current) => ({
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
                          selectedResidues={null}
                          focusedResidues={null}
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
