from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.selection import ResidueRange
from backend.structure_edit import crop_to_selection, cut_selection_off_target


def _fixture_pdb_path() -> Path:
    return Path(__file__).resolve().parents[2] / "fixtures" / "test-inputs" / "colabfold" / "toy_ranked_0.pdb"


def _read_residue_numbers(path: Path) -> list[int]:
    residues: list[int] = []
    seen: set[int] = set()
    for line in path.read_text().splitlines():
        if not line.startswith(("ATOM", "HETATM")):
            continue
        residue_number = int(line[22:26].strip())
        if residue_number not in seen:
            seen.add(residue_number)
            residues.append(residue_number)
    return residues


def _write_five_residue_pdb(path: Path) -> None:
    lines = [
        "ATOM      1  N   ALA A   1      11.000  13.000   9.000  1.00 95.00           N",
        "ATOM      2  CA  ALA A   1      12.000  13.200   9.300  1.00 95.00           C",
        "ATOM      3  N   GLY A   2      13.900  12.100  10.200  1.00 82.00           N",
        "ATOM      4  CA  GLY A   2      14.600  11.100  10.900  1.00 82.00           C",
        "ATOM      5  N   SER A   3      16.400  10.600  12.200  1.00 44.00           N",
        "ATOM      6  CA  SER A   3      17.500  10.900  13.000  1.00 44.00           C",
        "ATOM      7  N   THR A   4      18.600  10.100  12.300  1.00 66.00           N",
        "ATOM      8  CA  THR A   4      19.700   9.300  12.900  1.00 66.00           C",
        "ATOM      9  N   LEU A   5      20.800   8.900  12.200  1.00 71.00           N",
        "ATOM     10  CA  LEU A   5      21.900   8.200  12.800  1.00 71.00           C",
        "END",
    ]
    path.write_text("\n".join(lines) + "\n")


class StructureEditTests(unittest.TestCase):
    def test_crop_to_selection_writes_only_selected_residues(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            result = crop_to_selection(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(_fixture_pdb_path()),
                target_interface_residues="A1-2",
                residue_ranges=[ResidueRange(chain_id="A", start=1, end=2)],
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            self.assertTrue(output_path.exists())
            self.assertEqual(result["kept_residue_count"], 2)
            self.assertEqual(_read_residue_numbers(output_path), [1, 2])

    def test_cut_selection_off_target_writes_remaining_residues(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            result = cut_selection_off_target(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(_fixture_pdb_path()),
                target_interface_residues="A1-2",
                residue_ranges=[ResidueRange(chain_id="A", start=1, end=2)],
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            self.assertTrue(output_path.exists())
            self.assertEqual(result["kept_residue_count"], 1)
            self.assertEqual(_read_residue_numbers(output_path), [3])

    def test_crop_to_selection_preserves_original_residue_numbers(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "five_residues.pdb"
            _write_five_residue_pdb(source_path)
            result = crop_to_selection(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(source_path),
                target_interface_residues="A2-4",
                residue_ranges=[ResidueRange(chain_id="A", start=2, end=4)],
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            self.assertEqual(_read_residue_numbers(output_path), [2, 3, 4])

    def test_cut_selection_off_target_preserves_original_residue_numbers(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "five_residues.pdb"
            _write_five_residue_pdb(source_path)
            result = cut_selection_off_target(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(source_path),
                target_interface_residues="A2-4",
                residue_ranges=[ResidueRange(chain_id="A", start=2, end=4)],
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            self.assertEqual(_read_residue_numbers(output_path), [1, 5])


if __name__ == "__main__":
    unittest.main()
