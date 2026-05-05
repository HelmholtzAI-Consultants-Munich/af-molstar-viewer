from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path

from .models import (
    BinderValidation,
    FixtureCatalog,
    GeneratedOutputs,
    Project,
    SourceStructure,
    TargetArtifact,
    ViewerAsset,
    ViewerFile,
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def load_fixture_catalog() -> FixtureCatalog:
    root_dir = _repo_root()
    fixture_path = root_dir / "fixtures" / "project-seed.json"
    raw = json.loads(fixture_path.read_text())

    viewer_assets = {
        entry["artifact_id"]: ViewerAsset(
            id=entry["id"],
            artifact_id=entry["artifact_id"],
            label=entry["label"],
            files=[ViewerFile(name=file["name"], path=file["path"]) for file in entry["files"]],
        )
        for entry in raw["viewer_assets"]
    }

    targets = [
        TargetArtifact(
            id=entry["id"],
            name=entry["name"],
            provenance=entry["provenance"],
            parent_target_id=entry.get("parent_target_id"),
            source_structure_id=entry.get("source_structure_id"),
            source_job_id=entry.get("source_job_id"),
            selection=entry["selection"],
            chain_ids=list(entry["chain_ids"]),
            viewer_asset_id=entry["viewer_asset_id"],
        )
        for entry in raw["targets"]
    ]

    project = Project(
        id=raw["project"]["id"],
        name=raw["project"]["name"],
        source_structures=[
            SourceStructure(
                id=entry["id"],
                name=entry["name"],
                chain_ids=list(entry["chain_ids"]),
            )
            for entry in raw["source_structures"]
        ],
        targets=targets,
    )

    generated_outputs = GeneratedOutputs(
        binder_run_id=raw["generated_outputs"]["binder_run"]["id"],
        binder_run_name=raw["generated_outputs"]["binder_run"]["name"],
        binder_candidates=list(raw["generated_outputs"]["binder_candidates"]),
        validation_run_id=raw["generated_outputs"]["validation_run"]["id"],
        validation_run_name=raw["generated_outputs"]["validation_run"]["name"],
        binder_validations=list(raw["generated_outputs"]["binder_validations"]),
    )

    return FixtureCatalog(
        project_template=project,
        viewer_assets=viewer_assets,
        generated_outputs=generated_outputs,
        root_dir=root_dir,
    )


def clone_project_template(project: Project) -> Project:
    return Project(
        id=project.id,
        name=project.name,
        source_structures=[replace(entry) for entry in project.source_structures],
        targets=[replace(entry) for entry in project.targets],
        binder_runs=[],
        binder_candidates=[],
        validation_runs=[],
        binder_validations=[],
        viewer_states=[],
    )
