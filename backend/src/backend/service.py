from __future__ import annotations

from dataclasses import asdict, replace
import time
from typing import Any

from .fixtures import clone_project_template, load_fixture_catalog
from .models import (
    BinderCandidate,
    BinderRun,
    BinderValidation,
    FixtureCatalog,
    JobRef,
    Project,
    TargetArtifact,
    ValidationRun,
    ViewerAsset,
    ViewerState,
)
from .selection import canonicalize_target_interface_residues


class ProjectService:
    def __init__(self) -> None:
        self.catalog: FixtureCatalog = load_fixture_catalog()
        self.projects: dict[str, Project] = {}
        self.jobs: dict[str, JobRef] = {}
        self.job_outputs: dict[str, dict[str, Any]] = {}
        self._applied_jobs: set[str] = set()
        self._id_counters = {
            "project": 1,
            "job": 1,
            "target": 1,
            "binder_run": 1,
            "validation_run": 1,
            "viewer_state": 1,
        }

    def create_project(self) -> Project:
        project_id = f"project-{self._id_counters['project']}"
        self._id_counters["project"] += 1
        project = clone_project_template(self.catalog.project_template)
        project.id = project_id
        self.projects[project_id] = project
        return project

    def get_project(self, project_id: str) -> Project:
        project = self.projects.get(project_id)
        if project is None:
            raise KeyError(project_id)
        return project

    def list_targets(self, project_id: str) -> list[TargetArtifact]:
        return list(self.get_project(project_id).targets)

    def update_target_interface(self, project_id: str, target_id: str, selection: str) -> TargetArtifact:
        project = self.get_project(project_id)
        target = self._require_target(project, target_id)
        target.target_interface_residues = canonicalize_target_interface_residues(selection)
        return target

    def get_viewer_asset(self, project_id: str, artifact_id: str) -> ViewerAsset:
        self.get_project(project_id)
        asset = self.catalog.viewer_assets.get(artifact_id)
        if asset is None:
            raise KeyError(artifact_id)
        return asset

    def save_viewer_state(
        self,
        project_id: str,
        artifact_id: str,
        viewer_configuration: str,
        label: str,
        payload: dict[str, object] | None = None,
    ) -> ViewerState:
        project = self.get_project(project_id)
        if not label.strip():
            raise ValueError("Viewer state label cannot be empty")
        now = time.time()
        if viewer_configuration not in {"target", "validate_refolding"}:
            raise ValueError("Viewer state viewer_configuration must be 'target' or 'validate_refolding'")

        state = next(
            (
                entry
                for entry in project.viewer_states
                if entry.artifact_id == artifact_id
                and entry.viewer_configuration == viewer_configuration
                and entry.label == label.strip()
            ),
            None,
        )
        if state is None:
            state = ViewerState(
                id=f"viewer-state-{self._id_counters['viewer_state']}",
                artifact_id=artifact_id,
                viewer_configuration=viewer_configuration,
                label=label.strip(),
                updated_at=now,
                payload=dict(payload or {}),
            )
            self._id_counters["viewer_state"] += 1
            project.viewer_states.append(state)
        else:
            state.payload = dict(payload or {})
            state.updated_at = now
        return state

    def list_viewer_states(self, project_id: str) -> list[ViewerState]:
        return list(self.get_project(project_id).viewer_states)

    def create_template_extraction_job(
        self,
        project_id: str,
        source_structure_id: str,
        retained_chain_ids: list[str],
        target_interface_residues: str | None,
    ) -> JobRef:
        project = self.get_project(project_id)
        if not any(source.id == source_structure_id for source in project.source_structures):
            raise KeyError(source_structure_id)
        canonical_selection = canonicalize_target_interface_residues(target_interface_residues or "A1-2,B1-2")
        target = replace(
            next(entry for entry in self.catalog.project_template.targets if entry.id == "target-template"),
            id=f"target-{self._id_counters['target']}",
            chain_ids=list(retained_chain_ids) or ["A"],
            target_interface_residues=canonical_selection,
            source_structure_id=source_structure_id,
        )
        self._id_counters["target"] += 1
        return self._create_job(
            project_id=project_id,
            job_type="extract_target_from_template",
            progress_message="Extracting target from template fixture",
            produced={"targets": [target]},
        )

    def create_crop_job(self, project_id: str, target_id: str, label: str | None = None) -> JobRef:
        project = self.get_project(project_id)
        source_target = self._require_target(project, target_id)
        cropped_target = replace(
            next(entry for entry in self.catalog.project_template.targets if entry.id == "target-cropped"),
            id=f"target-{self._id_counters['target']}",
            name=label.strip() if label and label.strip() else f"{source_target.name} cropped",
            parent_target_id=source_target.id,
            source_structure_id=source_target.source_structure_id,
            target_interface_residues=source_target.target_interface_residues,
            source_job_id=None,
        )
        self._id_counters["target"] += 1
        return self._create_job(
            project_id=project_id,
            job_type="crop_target",
            progress_message="Cropping target with fixture output",
            produced={"targets": [cropped_target]},
        )

    def create_generate_binders_job(self, project_id: str, target_id: str, target_interface_residues: str) -> JobRef:
        project = self.get_project(project_id)
        target = self._require_target(project, target_id)
        target.target_interface_residues = canonicalize_target_interface_residues(target_interface_residues)
        binder_run_id = f"binder-run-{self._id_counters['binder_run']}"
        self._id_counters["binder_run"] += 1
        binder_run = BinderRun(
            id=binder_run_id,
            name=self.catalog.generated_outputs.binder_run_name,
            target_id=target.id,
            binder_candidate_ids=[],
        )
        binder_candidates = [
            BinderCandidate(
                id=entry["id"],
                name=entry["name"],
                binder_run_id=binder_run_id,
                target_id=target.id,
            )
            for entry in self.catalog.generated_outputs.binder_candidates
        ]
        binder_run.binder_candidate_ids = [entry.id for entry in binder_candidates]
        return self._create_job(
            project_id=project_id,
            job_type="generate_binders",
            progress_message="Generating binder candidates from fixture outputs",
            produced={
                "binder_run": binder_run,
                "binder_candidates": binder_candidates,
            },
        )

    def create_validate_refolding_job(self, project_id: str, binder_candidate_ids: list[str]) -> JobRef:
        project = self.get_project(project_id)
        binder_candidates = [candidate for candidate in project.binder_candidates if candidate.id in binder_candidate_ids]
        if not binder_candidates:
            raise ValueError("No binder candidates selected for validation")
        validation_run_id = f"validation-run-{self._id_counters['validation_run']}"
        self._id_counters["validation_run"] += 1
        target_id = binder_candidates[0].target_id
        validation_run = ValidationRun(
            id=validation_run_id,
            name=self.catalog.generated_outputs.validation_run_name,
            target_id=target_id,
            binder_candidate_ids=[candidate.id for candidate in binder_candidates],
            binder_validation_ids=[],
        )
        binder_validations = [
            BinderValidation(
                id=entry["id"],
                name=entry["name"],
                validation_run_id=validation_run_id,
                binder_candidate_id=entry["binder_candidate_id"],
                target_id=target_id,
                viewer_asset_id=entry["viewer_asset_id"],
            )
            for entry in self.catalog.generated_outputs.binder_validations
            if entry["binder_candidate_id"] in validation_run.binder_candidate_ids
        ]
        validation_run.binder_validation_ids = [entry.id for entry in binder_validations]
        return self._create_job(
            project_id=project_id,
            job_type="validate_refolding",
            progress_message="Validating binder refolding with fixture outputs",
            produced={
                "validation_run": validation_run,
                "binder_validations": binder_validations,
            },
        )

    def get_job(self, job_id: str) -> JobRef:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return self._resolve_job(job)

    def import_fixture_target(self, project_id: str) -> JobRef:
        imported_target = replace(
            next(entry for entry in self.catalog.project_template.targets if entry.id == "target-uploaded"),
            id=f"target-{self._id_counters['target']}",
        )
        self._id_counters["target"] += 1
        return self._create_job(
            project_id=project_id,
            job_type="import",
            progress_message="Importing fixture target files",
            produced={"targets": [imported_target]},
        )

    def _create_job(self, project_id: str, job_type: JobType, progress_message: str, produced: dict[str, Any]) -> JobRef:
        self.get_project(project_id)
        job_id = f"job-{self._id_counters['job']}"
        self._id_counters["job"] += 1
        job = JobRef(
            job_id=job_id,
            job_type=job_type,
            status="queued",
            project_id=project_id,
            created_at=time.time(),
            progress_message=progress_message,
        )
        self.jobs[job_id] = job
        self.job_outputs[job_id] = produced
        return job

    def _resolve_job(self, job: JobRef) -> JobRef:
        elapsed = time.time() - job.created_at
        if job.status == "queued" and elapsed >= 0.2:
            job.status = "running"
        if job.status == "running" and elapsed >= 0.8:
            job.status = "succeeded"
            job.finished_at = time.time()
            if job.job_id not in self._applied_jobs:
                self._apply_job_outputs(job)
                self._applied_jobs.add(job.job_id)
        return job

    def _apply_job_outputs(self, job: JobRef) -> None:
        produced = self.job_outputs.get(job.job_id, {})
        project = self.get_project(job.project_id)
        if "targets" in produced:
            targets: list[TargetArtifact] = produced["targets"]
            for target in targets:
                target.source_job_id = job.job_id
                project.targets.append(target)
            job.target_ids = [target.id for target in targets]
        if "binder_run" in produced:
            binder_run: BinderRun = produced["binder_run"]
            binder_run.source_job_id = job.job_id
            project.binder_runs.append(binder_run)
            job.binder_run_id = binder_run.id
        if "binder_candidates" in produced:
            binder_candidates: list[BinderCandidate] = produced["binder_candidates"]
            project.binder_candidates.extend(binder_candidates)
            job.binder_candidate_ids = [candidate.id for candidate in binder_candidates]
        if "validation_run" in produced:
            validation_run: ValidationRun = produced["validation_run"]
            validation_run.source_job_id = job.job_id
            project.validation_runs.append(validation_run)
            job.validation_run_id = validation_run.id
        if "binder_validations" in produced:
            binder_validations: list[BinderValidation] = produced["binder_validations"]
            project.binder_validations.extend(binder_validations)
            job.binder_validation_ids = [validation.id for validation in binder_validations]

    def _require_target(self, project: Project, target_id: str) -> TargetArtifact:
        target = next((entry for entry in project.targets if entry.id == target_id), None)
        if target is None:
            raise KeyError(target_id)
        return target


def serialize_project(project: Project, jobs: list[JobRef] | None = None) -> dict[str, Any]:
    return {
        "id": project.id,
        "name": project.name,
        "source_structures": [asdict(entry) for entry in project.source_structures],
        "targets": [asdict(entry) for entry in project.targets],
        "binder_runs": [asdict(entry) for entry in project.binder_runs],
        "binder_candidates": [asdict(entry) for entry in project.binder_candidates],
        "validation_runs": [asdict(entry) for entry in project.validation_runs],
        "binder_validations": [asdict(entry) for entry in project.binder_validations],
        "viewer_states": [asdict(entry) for entry in project.viewer_states],
        "jobs": [serialize_job(job) for job in (jobs or [])],
    }


def serialize_job(job: JobRef) -> dict[str, Any]:
    return {
        "job_id": job.job_id,
        "job_type": job.job_type,
        "status": job.status,
        "project_id": job.project_id,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
        "progress_message": job.progress_message,
        "target_ids": list(job.target_ids),
        "binder_run_id": job.binder_run_id,
        "binder_candidate_ids": list(job.binder_candidate_ids),
        "validation_run_id": job.validation_run_id,
        "binder_validation_ids": list(job.binder_validation_ids),
    }


def serialize_viewer_asset(asset: ViewerAsset) -> dict[str, Any]:
    return {
        "artifact_id": asset.artifact_id,
        "label": asset.label,
        "files": [
            {
                "name": file.name,
                "path": file.path,
            }
            for file in asset.files
        ],
    }
