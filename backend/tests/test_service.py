from __future__ import annotations

import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch

from backend.service import ProjectService, next_derived_target_name


def upload_toy_target(service: ProjectService, project_id: str):
    repo_root = Path(__file__).resolve().parents[2]
    files = [
        {
            "name": "toy_ranked_0.pdb",
            "text": (repo_root / "fixtures" / "test-inputs" / "colabfold" / "toy_ranked_0.pdb").read_text(),
        },
        {
            "name": "toy_scores.json",
            "text": (repo_root / "fixtures" / "test-inputs" / "colabfold" / "toy_scores.json").read_text(),
        },
    ]
    return service.upload_target(project_id, files, name="toy", chain_ids=["A"])


def upload_toy_ent_target(service: ProjectService, project_id: str):
    repo_root = Path(__file__).resolve().parents[2]
    files = [
        {
            "name": "pdb9cdz.ent",
            "text": (repo_root / "fixtures" / "test-inputs" / "colabfold" / "toy_ranked_0.pdb").read_text(),
        }
    ]
    return service.upload_target(project_id, files, name="toy-ent", chain_ids=["A"])


class ProjectServiceTests(unittest.TestCase):
    def test_projects_start_empty(self) -> None:
        service = ProjectService()
        project = service.create_project()

        self.assertEqual(project.targets, [])
        self.assertEqual(project.source_structures, [])

    def test_generate_and_validate_binders(self) -> None:
        service = ProjectService()
        project = service.create_project()
        project, target = upload_toy_target(service, project.id)

        generate_job = service.create_generate_binders_job(
            project.id,
            target_id=target.id,
            selection="B20-22,A1-10",
        )
        time.sleep(0.9)
        resolved_generate = service.get_job(generate_job.job_id)
        refreshed = service.get_project(project.id)
        self.assertEqual(resolved_generate.status, "succeeded")
        self.assertGreaterEqual(len(refreshed.binder_candidates), 2)

        validate_job = service.create_validate_refolding_job(
            project.id,
            binder_candidate_ids=[candidate.id for candidate in refreshed.binder_candidates],
        )
        time.sleep(0.9)
        resolved_validate = service.get_job(validate_job.job_id)
        refreshed = service.get_project(project.id)
        self.assertEqual(resolved_validate.status, "succeeded")
        self.assertGreaterEqual(len(refreshed.binder_validations), 2)

    def test_selection_edit_jobs_only_log_for_now(self) -> None:
        service = ProjectService()
        project = service.create_project()
        project, target = upload_toy_target(service, project.id)
        initial_count = len(project.targets)

        with patch("backend.service.structure_edit.crop_to_selection") as mocked_crop, patch(
            "backend.service.structure_edit.cut_selection_off_target"
        ) as mocked_cut:
            crop_job = service.create_crop_to_selection_job(project.id, target.id, "B20-22,A1-10")
            cut_job = service.create_cut_selection_off_target_job(project.id, target.id, "B20-22,A1-10")

        time.sleep(0.9)
        resolved_crop = service.get_job(crop_job.job_id)
        resolved_cut = service.get_job(cut_job.job_id)
        refreshed = service.get_project(project.id)

        self.assertEqual(resolved_crop.status, "succeeded")
        self.assertEqual(resolved_cut.status, "succeeded")
        self.assertEqual(len(resolved_crop.target_ids), 1)
        self.assertEqual(len(resolved_cut.target_ids), 1)
        self.assertEqual(len(refreshed.targets), initial_count + 2)
        self.assertEqual(refreshed.targets[-2].name, "toy_cropped_1")
        self.assertEqual(refreshed.targets[-1].name, "toy_cut_1")
        mocked_crop.assert_called_once()
        mocked_cut.assert_called_once()
        crop_call = mocked_crop.call_args.kwargs
        cut_call = mocked_cut.call_args.kwargs
        self.assertTrue(str(crop_call["structure_path"]).endswith("toy_ranked_0.pdb"))
        self.assertIn(".backend-data", str(crop_call["structure_path"]))
        self.assertEqual(crop_call["selection"], "A1-10,B20-22")
        self.assertEqual(cut_call["selection"], "A1-10,B20-22")
        self.assertEqual(crop_call["target_id"], target.id)
        self.assertEqual(cut_call["target_id"], target.id)

    def test_selection_edit_jobs_support_ent_structure_files(self) -> None:
        service = ProjectService()
        project = service.create_project()
        project, target = upload_toy_ent_target(service, project.id)

        with patch("backend.service.structure_edit.crop_to_selection") as mocked_crop:
            crop_job = service.create_crop_to_selection_job(project.id, target.id, "A1-10")

        time.sleep(0.9)
        resolved_crop = service.get_job(crop_job.job_id)
        refreshed = service.get_project(project.id)

        self.assertEqual(resolved_crop.status, "succeeded")
        self.assertEqual(len(refreshed.targets), 2)
        self.assertEqual(refreshed.targets[-1].name, "toy-ent_cropped_1")
        mocked_crop.assert_called_once()
        crop_call = mocked_crop.call_args.kwargs
        self.assertTrue(str(crop_call["structure_path"]).endswith("pdb9cdz.ent"))

    def test_selection_edit_jobs_crop_pae_data_for_derived_targets(self) -> None:
        service = ProjectService()
        project = service.create_project()
        project, target = upload_toy_target(service, project.id)

        crop_job = service.create_crop_to_selection_job(project.id, target.id, "A1-2")
        cut_job = service.create_cut_selection_off_target_job(project.id, target.id, "A1-2")

        time.sleep(0.9)
        resolved_crop = service.get_job(crop_job.job_id)
        resolved_cut = service.get_job(cut_job.job_id)
        refreshed = service.get_project(project.id)

        crop_target_id = resolved_crop.target_ids[0]
        cut_target_id = resolved_cut.target_ids[0]
        crop_asset = service.get_viewer_asset(project.id, crop_target_id)
        cut_asset = service.get_viewer_asset(project.id, cut_target_id)

        crop_json = next(Path(file.path).read_text() for file in crop_asset.files if file.name.endswith(".json"))
        cut_json = next(Path(file.path).read_text() for file in cut_asset.files if file.name.endswith(".json"))
        crop_payload = json.loads(crop_json)
        cut_payload = json.loads(cut_json)

        crop_matrix = crop_payload["pae"] if "pae" in crop_payload else crop_payload["predicted_aligned_error"]
        cut_matrix = cut_payload["pae"] if "pae" in cut_payload else cut_payload["predicted_aligned_error"]

        self.assertEqual(resolved_crop.status, "succeeded")
        self.assertEqual(resolved_cut.status, "succeeded")
        self.assertEqual(len(refreshed.targets), 3)
        self.assertEqual(len(crop_matrix), 2)
        self.assertEqual(len(crop_matrix[0]), 2)
        self.assertEqual(len(cut_matrix), 1)
        self.assertEqual(len(cut_matrix[0]), 1)

    def test_reset_auth_indexing_creates_derived_target(self) -> None:
        service = ProjectService()
        project = service.create_project()
        project, target = upload_toy_target(service, project.id)

        job = service.create_reset_auth_indexing_job(project.id, target.id)
        time.sleep(0.9)
        resolved = service.get_job(job.job_id)
        refreshed = service.get_project(project.id)

        self.assertEqual(resolved.status, "succeeded")
        self.assertEqual(resolved.job_type, "reset_auth_indexing")
        self.assertEqual(len(resolved.target_ids), 1)
        self.assertEqual(len(refreshed.targets), 2)
        self.assertEqual(refreshed.targets[-1].name, "toy_reset_1")
        self.assertEqual(refreshed.targets[-1].parent_target_id, target.id)

    def test_create_derived_target_name_uses_flat_crop_root_and_nested_cuts(self) -> None:
        self.assertEqual(next_derived_target_name("AF-3-model_v6.pdb", [], "cropped"), "AF-3-model_v6_cropped_1.pdb")
        self.assertEqual(
            next_derived_target_name(
                "AF-3-model_v6_cropped_1.pdb",
                ["AF-3-model_v6_cropped_1.pdb"],
                "cropped",
            ),
            "AF-3-model_v6_cropped_2.pdb",
        )
        self.assertEqual(
            next_derived_target_name(
                "AF-3-model_v6_cropped_2.pdb",
                [
                    "AF-3-model_v6_cropped_1.pdb",
                    "AF-3-model_v6_cropped_2.pdb",
                ],
                "cut",
            ),
            "AF-3-model_v6_cropped_2_cut_1.pdb",
        )
        self.assertEqual(
            next_derived_target_name(
                "AF-3-model_v6_cropped_2_cut_1.pdb",
                [
                    "AF-3-model_v6_cropped_1.pdb",
                    "AF-3-model_v6_cropped_2.pdb",
                    "AF-3-model_v6_cropped_2_cut_1.pdb",
                ],
                "cropped",
            ),
            "AF-3-model_v6_cropped_2_cut_1_cropped_1.pdb",
        )

    def test_remove_parent_target_after_crop_keeps_derived_target_and_cleans_runtime_dir(self) -> None:
        service = ProjectService()
        project = service.create_project()
        project, target = upload_toy_target(service, project.id)

        crop_job = service.create_crop_to_selection_job(project.id, target.id, "A1-2")
        time.sleep(0.9)
        resolved_crop = service.get_job(crop_job.job_id)
        derived_target_id = resolved_crop.target_ids[0]

        updated = service.remove_target(project.id, target.id)

        self.assertFalse(any(entry.id == target.id for entry in updated.targets))
        self.assertTrue(any(entry.id == derived_target_id for entry in updated.targets))
        self.assertTrue(any(entry.source_structure_id == target.source_structure_id for entry in updated.targets))
        self.assertTrue(any(entry.id == target.source_structure_id for entry in updated.source_structures))
        self.assertFalse((service.runtime_dir / project.id / target.id).exists())

    def test_viewer_states_are_keyed_by_artifact_and_configuration(self) -> None:
        service = ProjectService()
        project = service.create_project()
        project, target = upload_toy_target(service, project.id)

        first = service.save_viewer_state(
            project.id,
            artifact_id=target.id,
            viewer_configuration="target",
            label="Current target view",
            payload={"snapshot": {"camera": {"current": {"position": [1, 2, 3]}}}},
        )
        replacement = service.save_viewer_state(
            project.id,
            artifact_id=target.id,
            viewer_configuration="target",
            label="Current target view",
            payload={"snapshot": {"camera": {"current": {"position": [3, 2, 1]}}}},
        )
        validate = service.save_viewer_state(
            project.id,
            artifact_id=target.id,
            viewer_configuration="validate_refolding",
            label="Current validate refolding view",
            payload={"snapshot": {"camera": {"current": {"position": [4, 5, 6]}}}},
        )

        self.assertEqual(first.id, replacement.id)
        self.assertEqual(replacement.payload["snapshot"], {"camera": {"current": {"position": [3, 2, 1]}}})
        self.assertEqual(validate.viewer_configuration, "validate_refolding")
        self.assertEqual(len(service.list_viewer_states(project.id)), 2)


if __name__ == "__main__":
    unittest.main()
