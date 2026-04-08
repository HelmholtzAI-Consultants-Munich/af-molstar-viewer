import { useEffect, useMemo, useState } from 'react';
import type { LoadedViewerArtifact, WorkspaceProject } from '../domain/project-types';
import { canonicalizeTargetInterfaceResidues } from '../domain/target-interface';
import { ArtifactWorkspace } from '../components/project/ArtifactWorkspace';
import { ProjectSidebar } from '../components/project/ProjectSidebar';
import { loadViewerArtifact } from '../lib/project/load-viewer-artifact';
import type { ProjectApi } from '../lib/project/project-api';
import { createProjectApi } from '../lib/project/project-api';

interface AppProps {
  api?: ProjectApi;
}

function isActiveJob(status: WorkspaceProject['jobs'][number]['status']) {
  return status === 'queued' || status === 'running';
}

export function App(props: AppProps) {
  const api = useMemo(() => props.api ?? createProjectApi(), [props.api]);
  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [compareValidationIds, setCompareValidationIds] = useState<string[]>([]);
  const [interfaceDraft, setInterfaceDraft] = useState('');
  const [viewerArtifacts, setViewerArtifacts] = useState<Record<string, LoadedViewerArtifact>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTarget = project?.targets.find((target) => target.id === selectedTargetId) ?? null;
  const compareValidations = compareValidationIds
    .map((validationId) => project?.binder_validations.find((validation) => validation.id === validationId) ?? null)
    .filter((validation): validation is NonNullable<typeof validation> => validation !== null);

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
        setInterfaceDraft(preferredTarget?.target_interface_residues ?? '');
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
    if (!selectedTarget) {
      setInterfaceDraft('');
      return;
    }
    setInterfaceDraft(selectedTarget.target_interface_residues);
  }, [selectedTarget?.id, selectedTarget?.target_interface_residues]);

  useEffect(() => {
    if (!project) return;
    const artifactIds = [selectedTargetId, ...compareValidationIds].filter((value): value is string => Boolean(value));
    if (artifactIds.length === 0) return;
    let cancelled = false;

    const loadArtifacts = async () => {
      try {
        const resolved = await Promise.all(
          artifactIds.map(async (artifactId) => {
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
  }, [api, project, selectedTargetId, compareValidationIds]);

  useEffect(() => {
    if (!project || !project.jobs.some((job) => isActiveJob(job.status))) return;
    let cancelled = false;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          await Promise.all(project.jobs.map((job) => api.getJob(job.job_id)));
          const refreshed = await api.getProject(project.id);
          if (cancelled) return;
          setProject(refreshed);
          if (!refreshed.targets.some((target) => target.id === selectedTargetId)) {
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
  }, [api, project, selectedTargetId]);

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

  const selectedArtifact = selectedTargetId ? viewerArtifacts[selectedTargetId] : null;

  return (
    <main className="app-shell app-shell-project">
      {error && <div className="panel error-panel">{error}</div>}

      <div className="project-layout">
        <ProjectSidebar
          project={project}
          selectedTargetId={selectedTargetId}
          interfaceDraft={interfaceDraft}
          compareValidationIds={compareValidationIds}
          busy={busy}
          onSelectTarget={setSelectedTargetId}
          onInterfaceDraftChange={setInterfaceDraft}
          onSaveInterface={() =>
            void runMutation(async () => {
              if (!selectedTarget) return;
              const canonical = canonicalizeTargetInterfaceResidues(interfaceDraft);
              const updated = await api.updateTargetInterface(project.id, selectedTarget.id, canonical);
              setProject(updated);
              setInterfaceDraft(canonical);
            })
          }
          onExtractTarget={(sourceStructureId) =>
            void runMutation(async () => {
              await api.extractTargetFromTemplate(project.id, sourceStructureId, ['A', 'B'], interfaceDraft || 'A1-2,B1-2');
            })
          }
          onCropTarget={() =>
            void runMutation(async () => {
              if (!selectedTarget) return;
              await api.cropTarget(project.id, selectedTarget.id, `${selectedTarget.name} cropped`);
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
              await api.saveViewerState(project.id, selectedTarget.id, `${selectedTarget.name} view ${project.viewer_states.length + 1}`);
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
            <ArtifactWorkspace key={selectedArtifact.artifactId} artifact={selectedArtifact} />
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
                        <ArtifactWorkspace key={artifact.artifactId} artifact={artifact} />
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
