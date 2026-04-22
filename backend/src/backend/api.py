from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import PlainTextResponse
    from fastapi.middleware.cors import CORSMiddleware
except ModuleNotFoundError:  # pragma: no cover - kept so the repo remains importable without backend deps.
    FastAPI = None  # type: ignore[assignment]
    HTTPException = RuntimeError  # type: ignore[assignment]
    PlainTextResponse = None  # type: ignore[assignment]
    CORSMiddleware = None  # type: ignore[assignment]

from .service import ProjectService, serialize_job, serialize_project, serialize_viewer_asset


SERVICE = ProjectService()


def create_app() -> Any:
    if FastAPI is None:
        raise RuntimeError("FastAPI is not installed. Run `uv sync` in backend/ to install backend dependencies.")

    app = FastAPI(title="AF Mol* Viewer Backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/api/projects")
    def create_project() -> dict[str, object]:
        project = SERVICE.create_project()
        return serialize_project(project)

    @app.post("/api/projects/{project_id}/import")
    def import_project(project_id: str) -> dict[str, object]:
        try:
            job = SERVICE.import_fixture_target(project_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown project {error.args[0]}") from error
        return serialize_job(job)

    @app.post("/api/projects/{project_id}/targets/upload")
    def upload_target(project_id: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            project, target = SERVICE.upload_target(
                project_id=project_id,
                files=[
                    {
                        "name": str(entry.get("name", "")),
                        "text": str(entry.get("text", "")),
                    }
                    for entry in payload.get("files", [])
                    if isinstance(entry, dict)
                ],
                name=str(payload.get("name", "")),
                chain_ids=[str(entry) for entry in payload.get("chain_ids", [])],
            )
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown project {error.args[0]}") from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return {
            "project": serialize_project(project),
            "target": asdict(target),
        }

    @app.get("/api/projects/{project_id}")
    def get_project(project_id: str) -> dict[str, object]:
        try:
            project = SERVICE.get_project(project_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown project {error.args[0]}") from error
        jobs = [SERVICE.get_job(job_id) for job_id, job in SERVICE.jobs.items() if job.project_id == project_id]
        return serialize_project(project, jobs)

    @app.get("/api/projects/{project_id}/targets")
    def list_targets(project_id: str) -> list[dict[str, object]]:
        try:
            return [asdict(target) for target in SERVICE.list_targets(project_id)]
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown project {error.args[0]}") from error

    @app.post("/api/projects/{project_id}/targets/from-template")
    def create_target_from_template(project_id: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            job = SERVICE.create_template_extraction_job(
                project_id=project_id,
                source_structure_id=str(payload.get("source_structure_id", "")),
                retained_chain_ids=[str(entry) for entry in payload.get("retained_chain_ids", [])],
                target_interface_residues=str(payload.get("target_interface_residues")) if payload.get("target_interface_residues") else None,
            )
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown entity {error.args[0]}") from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return serialize_job(job)

    @app.post("/api/projects/{project_id}/targets/{target_id}/interface")
    def update_target_interface(project_id: str, target_id: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            target = SERVICE.update_target_interface(project_id, target_id, str(payload.get("target_interface_residues", "")))
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown entity {error.args[0]}") from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return asdict(target)

    @app.delete("/api/projects/{project_id}/targets/{target_id}")
    def remove_target(project_id: str, target_id: str) -> dict[str, object]:
        try:
            project = SERVICE.remove_target(project_id, target_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown target {error.args[0]}") from error
        return serialize_project(project)

    @app.post("/api/projects/{project_id}/targets/{target_id}/crop")
    def crop_target(project_id: str, target_id: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            job = SERVICE.create_crop_job(project_id, target_id, label=str(payload.get("label", "")))
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown target {error.args[0]}") from error
        return serialize_job(job)

    @app.post("/api/projects/{project_id}/targets/{target_id}/crop-to-selection")
    def crop_target_to_selection(project_id: str, target_id: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            job = SERVICE.create_crop_to_selection_job(
                project_id,
                target_id,
                str(payload.get("target_interface_residues", "")))
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown target {error.args[0]}") from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return serialize_job(job)

    @app.post("/api/projects/{project_id}/targets/{target_id}/cut-off-selection")
    def cut_selection_off_target(project_id: str, target_id: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            job = SERVICE.create_cut_selection_off_target_job(
                project_id,
                target_id,
                str(payload.get("target_interface_residues", "")))
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown target {error.args[0]}") from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return serialize_job(job)

    @app.post("/api/projects/{project_id}/generate-binders")
    def generate_binders(project_id: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            job = SERVICE.create_generate_binders_job(
                project_id=project_id,
                target_id=str(payload.get("target_id", "")),
                target_interface_residues=str(payload.get("target_interface_residues", "")),
            )
        except (KeyError, ValueError) as error:
            status_code = 404 if isinstance(error, KeyError) else 400
            raise HTTPException(status_code=status_code, detail=str(error)) from error
        return serialize_job(job)

    @app.post("/api/projects/{project_id}/validate-refolding")
    def validate_refolding(project_id: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            job = SERVICE.create_validate_refolding_job(
                project_id=project_id,
                binder_candidate_ids=[str(entry) for entry in payload.get("binder_candidate_ids", [])],
            )
        except (KeyError, ValueError) as error:
            status_code = 404 if isinstance(error, KeyError) else 400
            raise HTTPException(status_code=status_code, detail=str(error)) from error
        return serialize_job(job)

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, object]:
        try:
            return serialize_job(SERVICE.get_job(job_id))
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown job {error.args[0]}") from error

    @app.get("/api/projects/{project_id}/viewer-states")
    def list_viewer_states(project_id: str) -> list[dict[str, object]]:
        try:
            return [asdict(state) for state in SERVICE.list_viewer_states(project_id)]
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown project {error.args[0]}") from error

    @app.post("/api/projects/{project_id}/viewer-states")
    def create_viewer_state(project_id: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            state = SERVICE.save_viewer_state(
                project_id=project_id,
                artifact_id=str(payload.get("artifact_id", "")),
                viewer_configuration=str(payload.get("viewer_configuration", "target")),
                label=str(payload.get("label", "")),
                payload=payload.get("payload") if isinstance(payload.get("payload"), dict) else None,
            )
        except (KeyError, ValueError) as error:
            status_code = 404 if isinstance(error, KeyError) else 400
            raise HTTPException(status_code=status_code, detail=str(error)) from error
        return asdict(state)

    @app.get("/api/projects/{project_id}/artifacts/{artifact_id}/viewer")
    def get_artifact_viewer(project_id: str, artifact_id: str) -> dict[str, object]:
        try:
            asset = SERVICE.get_viewer_asset(project_id, artifact_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown artifact {error.args[0]}") from error
        payload = serialize_viewer_asset(asset)
        payload["files"] = [
            {
                "name": file["name"],
                "url": f"/api/projects/{project_id}/artifacts/{artifact_id}/files/{index}",
            }
            for index, file in enumerate(payload["files"])
        ]
        return payload

    @app.get("/api/projects/{project_id}/artifacts/{artifact_id}/files/{file_index}", response_class=PlainTextResponse)
    def get_artifact_file(project_id: str, artifact_id: str, file_index: int) -> str:
        try:
            asset = SERVICE.get_viewer_asset(project_id, artifact_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown artifact {error.args[0]}") from error
        if file_index < 0 or file_index >= len(asset.files):
            raise HTTPException(status_code=404, detail=f"Unknown file index {file_index} for artifact {artifact_id}")
        file_path = Path(asset.files[file_index].path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"Unknown fixture file {file_path.name}")
        return file_path.read_text()

    return app


def main() -> None:
    try:
        import uvicorn
    except ModuleNotFoundError as error:  # pragma: no cover
        raise RuntimeError("uvicorn is not installed. Run `uv sync` in backend/ first.") from error

    uvicorn.run("backend.api:create_app", factory=True, host="127.0.0.1", port=8000, reload=True)
