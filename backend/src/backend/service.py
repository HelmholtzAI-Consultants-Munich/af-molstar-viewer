from __future__ import annotations

from dataclasses import asdict, replace
from pathlib import Path
import re
import shutil
import time
from typing import Any

from .fixtures import load_fixture_catalog
from .models import (
    BinderCandidate,
    BinderRun,
    BinderValidation,
    FixtureCatalog,
    JobRef,
    JobType,
    Project,
    SourceStructure,
    TargetArtifact,
    ValidationRun,
    ViewerAsset,
    ViewerFile,
    ViewerState,
)
from . import structure_edit
from .selection import canonicalize_selection, parse_selection


class ProjectService:
    def __init__(self) -> None:
        self.catalog: FixtureCatalog = load_fixture_catalog()
        self.projects: dict[str, Project] = {}
        self.jobs: dict[str, JobRef] = {}
        self.job_outputs: dict[str, dict[str, Any]] = {}
        self.project_viewer_assets: dict[str, dict[str, ViewerAsset]] = {}
        self._applied_jobs: set[str] = set()
        self.runtime_dir = self.catalog.root_dir / ".backend-data"
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self._id_counters = {
            "project": 1,
            "job": 1,
            "target": 1,
            "source_structure": 1,
            "binder_run": 1,
            "validation_run": 1,
            "viewer_state": 1,
        }

    def create_project(self) -> Project:
        project_id = f"project-{self._id_counters['project']}"
        self._id_counters["project"] += 1
        project = Project(
            id=project_id,
            name=self.catalog.project_template.name,
            source_structures=[],
            targets=[],
        )
        self.projects[project_id] = project
        self.project_viewer_assets[project_id] = {}
        return project

    def get_project(self, project_id: str) -> Project:
        project = self.projects.get(project_id)
        if project is None:
            raise KeyError(project_id)
        return project

    def list_targets(self, project_id: str) -> list[TargetArtifact]:
        return list(self.get_project(project_id).targets)

    def update_selection(self, project_id: str, target_id: str, selection: str) -> TargetArtifact:
        project = self.get_project(project_id)
        target = self._require_target(project, target_id)
        target.selection = canonicalize_selection(selection)
        return target

    def get_viewer_asset(self, project_id: str, artifact_id: str) -> ViewerAsset:
        self.get_project(project_id)
        uploaded_asset = self.project_viewer_assets.get(project_id, {}).get(artifact_id)
        if uploaded_asset is not None:
            return uploaded_asset
        asset = self.catalog.viewer_assets.get(artifact_id)
        if asset is None:
            raise KeyError(artifact_id)
        return asset

    def upload_target(
        self,
        project_id: str,
        files: list[dict[str, str]],
        *,
        name: str,
        chain_ids: list[str],
    ) -> tuple[Project, TargetArtifact]:
        project = self.get_project(project_id)
        if not files:
            raise ValueError("Choose at least one file to upload a target.")
        if not name.strip():
            raise ValueError("Uploaded targets need a name.")

        target_id = f"target-{self._id_counters['target']}"
        self._id_counters["target"] += 1
        source_structure_id = f"source-structure-{self._id_counters['source_structure']}"
        self._id_counters["source_structure"] += 1
        viewer_asset_id = f"viewer-{target_id}"

        upload_dir = self.runtime_dir / project_id / target_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        viewer_files: list[ViewerFile] = []
        for index, file in enumerate(files):
            file_name = Path(str(file.get("name", f"upload-{index + 1}"))).name or f"upload-{index + 1}"
            file_text = str(file.get("text", ""))
            stored_path = upload_dir / file_name
            stored_path.write_text(file_text)
            viewer_files.append(ViewerFile(name=file_name, path=str(stored_path)))

        source_structure = SourceStructure(
            id=source_structure_id,
            name=name.strip(),
            chain_ids=list(chain_ids),
        )
        target = TargetArtifact(
            id=target_id,
            name=name.strip(),
            provenance="uploaded",
            selection="",
            chain_ids=list(chain_ids),
            viewer_asset_id=viewer_asset_id,
            source_structure_id=source_structure_id,
        )
        viewer_asset = ViewerAsset(
            id=viewer_asset_id,
            artifact_id=target_id,
            label=name.strip(),
            files=viewer_files,
        )

        project.source_structures.append(source_structure)
        project.targets.append(target)
        self.project_viewer_assets.setdefault(project_id, {})[target_id] = viewer_asset
        return project, target

    def remove_target(self, project_id: str, target_id: str) -> Project:
        project = self.get_project(project_id)
        target = self._require_target(project, target_id)

        binder_run_ids = {entry.id for entry in project.binder_runs if entry.target_id == target_id}
        binder_candidate_ids = {
            entry.id
            for entry in project.binder_candidates
            if entry.target_id == target_id or entry.binder_run_id in binder_run_ids
        }
        validation_run_ids = {
            entry.id
            for entry in project.validation_runs
            if entry.target_id == target_id or any(candidate_id in binder_candidate_ids for candidate_id in entry.binder_candidate_ids)
        }
        binder_validation_ids = {
            entry.id
            for entry in project.binder_validations
            if entry.target_id == target_id
            or entry.binder_candidate_id in binder_candidate_ids
            or entry.validation_run_id in validation_run_ids
        }

        project.targets = [entry for entry in project.targets if entry.id != target_id]
        if target.source_structure_id and not any(
            entry.id != target_id and entry.source_structure_id == target.source_structure_id
            for entry in project.targets
        ):
            project.source_structures = [entry for entry in project.source_structures if entry.id != target.source_structure_id]
        project.binder_runs = [entry for entry in project.binder_runs if entry.id not in binder_run_ids]
        project.binder_candidates = [entry for entry in project.binder_candidates if entry.id not in binder_candidate_ids]
        project.validation_runs = [entry for entry in project.validation_runs if entry.id not in validation_run_ids]
        project.binder_validations = [entry for entry in project.binder_validations if entry.id not in binder_validation_ids]
        removed_artifact_ids = {target_id, *binder_validation_ids}
        project.viewer_states = [entry for entry in project.viewer_states if entry.artifact_id not in removed_artifact_ids]

        viewer_assets = self.project_viewer_assets.get(project_id, {})
        viewer_asset = viewer_assets.pop(target_id, None)
        if viewer_asset is not None:
            for file in viewer_asset.files:
                file_path = Path(file.path)
                if file_path.exists():
                    file_path.unlink()
            upload_dir = self.runtime_dir / project_id / target_id
            if upload_dir.exists():
                shutil.rmtree(upload_dir)
        return project

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

    def create_crop_to_selection_job(self, project_id: str, target_id: str, selection: str) -> JobRef:
        project = self.get_project(project_id)
        target = self._require_target(project, target_id)
        canonical_selection = canonicalize_selection(selection)
        residue_ranges = parse_selection(canonical_selection)
        derived_target_id = f"target-{self._id_counters['target']}"
        self._id_counters["target"] += 1
        edit_result = structure_edit.crop_to_selection(
            project_id=project_id,
            target_id=target.id,
            target_name=target.name,
            structure_path=self._get_target_structure_path(project_id, target.id),
            selection=canonical_selection,
            residue_ranges=residue_ranges,
            output_dir=str(self.runtime_dir / project_id / derived_target_id),
        )
        derived_target, derived_viewer_asset = self._create_derived_target_artifacts(
            project=project,
            source_target=target,
            derived_target_id=derived_target_id,
            operation="cropped",
            derived_structure_path=str(edit_result["output_path"]),
            derived_chain_ids=[str(chain_id) for chain_id in edit_result.get("kept_chain_ids", [])],
        )
        return self._create_job(
            project_id=project_id,
            job_type="crop_target",
            progress_message=f"Stub: would crop {target.name} to {canonical_selection}",
            produced={"targets": [derived_target], "viewer_assets": [derived_viewer_asset]},
        )

    def create_cut_selection_off_target_job(
        self,
        project_id: str,
        target_id: str,
        selection: str,
    ) -> JobRef:
        project = self.get_project(project_id)
        target = self._require_target(project, target_id)
        canonical_selection = canonicalize_selection(selection)
        residue_ranges = parse_selection(canonical_selection)
        derived_target_id = f"target-{self._id_counters['target']}"
        self._id_counters["target"] += 1
        edit_result = structure_edit.cut_selection_off_target(
            project_id=project_id,
            target_id=target.id,
            target_name=target.name,
            structure_path=self._get_target_structure_path(project_id, target.id),
            selection=canonical_selection,
            residue_ranges=residue_ranges,
            output_dir=str(self.runtime_dir / project_id / derived_target_id),
        )
        derived_target, derived_viewer_asset = self._create_derived_target_artifacts(
            project=project,
            source_target=target,
            derived_target_id=derived_target_id,
            operation="cut",
            derived_structure_path=str(edit_result["output_path"]),
            derived_chain_ids=[str(chain_id) for chain_id in edit_result.get("kept_chain_ids", [])],
        )
        return self._create_job(
            project_id=project_id,
            job_type="cut_target",
            progress_message=f"Stub: would cut off {canonical_selection} from {target.name}",
            produced={"targets": [derived_target], "viewer_assets": [derived_viewer_asset]},
        )

    def create_generate_binders_job(self, project_id: str, target_id: str, selection: str) -> JobRef:
        project = self.get_project(project_id)
        target = self._require_target(project, target_id)
        target.selection = canonicalize_selection(selection)
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
        if "viewer_assets" in produced:
            viewer_assets: list[ViewerAsset] = produced["viewer_assets"]
            project_assets = self.project_viewer_assets.setdefault(job.project_id, {})
            for viewer_asset in viewer_assets:
                project_assets[viewer_asset.artifact_id] = viewer_asset
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

    def _get_target_structure_path(self, project_id: str, target_id: str) -> str:
        asset = self.get_viewer_asset(project_id, target_id)
        structure_file = next(
            (
                file
                for file in asset.files
                if Path(file.name).suffix.lower() in {".pdb", ".cif", ".mmcif"}
            ),
            None,
        )
        if structure_file is None:
            raise ValueError(f"No structure file found for target {target_id}")
        return structure_file.path

    def _create_derived_target_artifacts(
        self,
        *,
        project: Project,
        source_target: TargetArtifact,
        derived_target_id: str,
        operation: str,
        derived_structure_path: str,
        derived_chain_ids: list[str],
    ) -> tuple[TargetArtifact, ViewerAsset]:
        derived_name = self._create_derived_target_name(project, source_target.name, operation)
        viewer_asset_id = f"viewer-{derived_target_id}"
        derived_target = TargetArtifact(
            id=derived_target_id,
            name=derived_name,
            provenance="cropped",
            selection="",
            chain_ids=list(derived_chain_ids) if derived_chain_ids else list(source_target.chain_ids),
            viewer_asset_id=viewer_asset_id,
            parent_target_id=source_target.id,
            source_structure_id=source_target.source_structure_id,
            source_job_id=None,
        )
        derived_viewer_asset = ViewerAsset(
            id=viewer_asset_id,
            artifact_id=derived_target_id,
            label=derived_name,
            files=[
                ViewerFile(
                    name=Path(derived_structure_path).name,
                    path=derived_structure_path,
                )
            ],
        )
        return derived_target, derived_viewer_asset

    def _create_derived_target_name(self, project: Project, source_name: str, operation: str) -> str:
        base_name = re.sub(r"_(?:cropped|cut)_\d+$", "", source_name)
        pattern = re.compile(rf"^{re.escape(base_name)}_{re.escape(operation)}_(\d+)$")
        next_index = (
            max(
                (
                    int(match.group(1))
                    for target in project.targets
                    for match in [pattern.match(target.name)]
                    if match is not None
                ),
                default=0,
            )
            + 1
        )
        return f"{base_name}_{operation}_{next_index}"


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
