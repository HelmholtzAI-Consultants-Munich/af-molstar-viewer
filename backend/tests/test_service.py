from __future__ import annotations

import time
import unittest

from backend.service import ProjectService


class ProjectServiceTests(unittest.TestCase):
    def test_crop_job_creates_new_target(self) -> None:
        service = ProjectService()
        project = service.create_project()
        initial_count = len(project.targets)

        job = service.create_crop_job(project.id, project.targets[0].id, label="Cropped target")
        time.sleep(0.9)
        resolved = service.get_job(job.job_id)
        refreshed = service.get_project(project.id)

        self.assertEqual(resolved.status, "succeeded")
        self.assertEqual(len(refreshed.targets), initial_count + 1)
        self.assertEqual(refreshed.targets[-1].provenance, "cropped")

    def test_generate_and_validate_binders(self) -> None:
        service = ProjectService()
        project = service.create_project()

        generate_job = service.create_generate_binders_job(
            project.id,
            target_id=project.targets[0].id,
            target_interface_residues="B20-22,A1-10",
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


if __name__ == "__main__":
    unittest.main()
