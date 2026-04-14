from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


JobType = Literal[
    "import",
    "extract_target_from_template",
    "crop_target",
    "generate_binders",
    "validate_refolding",
]
JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
TargetProvenance = Literal["uploaded", "template_extracted", "cropped"]
ViewerConfiguration = Literal["target", "validate_refolding"]


@dataclass(slots=True)
class ViewerFile:
    name: str
    path: str


@dataclass(slots=True)
class ViewerAsset:
    id: str
    artifact_id: str
    label: str
    files: list[ViewerFile]


@dataclass(slots=True)
class SourceStructure:
    id: str
    name: str
    chain_ids: list[str]


@dataclass(slots=True)
class TargetArtifact:
    id: str
    name: str
    provenance: TargetProvenance
    target_interface_residues: str
    chain_ids: list[str]
    viewer_asset_id: str
    parent_target_id: str | None = None
    source_structure_id: str | None = None
    source_job_id: str | None = None


@dataclass(slots=True)
class BinderCandidate:
    id: str
    name: str
    binder_run_id: str
    target_id: str


@dataclass(slots=True)
class BinderValidation:
    id: str
    name: str
    validation_run_id: str
    binder_candidate_id: str
    target_id: str
    viewer_asset_id: str


@dataclass(slots=True)
class BinderRun:
    id: str
    name: str
    target_id: str
    binder_candidate_ids: list[str]
    source_job_id: str | None = None


@dataclass(slots=True)
class ValidationRun:
    id: str
    name: str
    target_id: str
    binder_candidate_ids: list[str]
    binder_validation_ids: list[str]
    source_job_id: str | None = None


@dataclass(slots=True)
class ViewerState:
    id: str
    artifact_id: str
    viewer_configuration: ViewerConfiguration
    label: str
    updated_at: float
    payload: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class JobRef:
    job_id: str
    job_type: JobType
    status: JobStatus
    project_id: str
    created_at: float
    finished_at: float | None = None
    progress_message: str | None = None
    target_ids: list[str] = field(default_factory=list)
    binder_run_id: str | None = None
    binder_candidate_ids: list[str] = field(default_factory=list)
    validation_run_id: str | None = None
    binder_validation_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class Project:
    id: str
    name: str
    source_structures: list[SourceStructure]
    targets: list[TargetArtifact]
    binder_runs: list[BinderRun] = field(default_factory=list)
    binder_candidates: list[BinderCandidate] = field(default_factory=list)
    validation_runs: list[ValidationRun] = field(default_factory=list)
    binder_validations: list[BinderValidation] = field(default_factory=list)
    viewer_states: list[ViewerState] = field(default_factory=list)


@dataclass(slots=True)
class GeneratedOutputs:
    binder_run_id: str
    binder_run_name: str
    binder_candidates: list[dict[str, str]]
    validation_run_id: str
    validation_run_name: str
    binder_validations: list[dict[str, str]]


@dataclass(slots=True)
class FixtureCatalog:
    project_template: Project
    viewer_assets: dict[str, ViewerAsset]
    generated_outputs: GeneratedOutputs
    root_dir: Path
