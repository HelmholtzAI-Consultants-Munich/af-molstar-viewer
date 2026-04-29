from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.selection import ResidueRange
from backend.structure_edit import crop_to_selection, cut_selection_off_target

try:
    import Bio  # noqa: F401
except ModuleNotFoundError:
    HAS_BIOPYTHON = False
else:
    HAS_BIOPYTHON = True


def _fixture_pdb_path() -> Path:
    return Path(__file__).resolve().parents[2] / "fixtures" / "test-inputs" / "colabfold" / "toy_ranked_0.pdb"


def _fixture_cif_path() -> Path:
    return Path(__file__).resolve().parents[2] / "fixtures" / "test-inputs" / "af3" / "toy_model.cif"


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


def _write_multichain_pdb(path: Path) -> None:
    lines = [
        "ATOM      1  N   ALA A   1      11.000  13.000   9.000  1.00 95.00           N",
        "ATOM      2  CA  ALA A   1      12.000  13.200   9.300  1.00 95.00           C",
        "ATOM      3  N   GLY B   1      21.000  23.000  19.000  1.00 95.00           N",
        "ATOM      4  CA  GLY B   1      22.000  23.200  19.300  1.00 95.00           C",
        "END",
    ]
    path.write_text("\n".join(lines) + "\n")


def _write_mmcif_with_unobserved_residues(path: Path) -> None:
    lines = [
        "data_test",
        "#",
        "loop_",
        "_atom_site.group_PDB",
        "_atom_site.id",
        "_atom_site.type_symbol",
        "_atom_site.label_atom_id",
        "_atom_site.label_alt_id",
        "_atom_site.label_comp_id",
        "_atom_site.label_asym_id",
        "_atom_site.label_entity_id",
        "_atom_site.label_seq_id",
        "_atom_site.pdbx_PDB_ins_code",
        "_atom_site.Cartn_x",
        "_atom_site.Cartn_y",
        "_atom_site.Cartn_z",
        "_atom_site.occupancy",
        "_atom_site.B_iso_or_equiv",
        "_atom_site.auth_seq_id",
        "_atom_site.auth_comp_id",
        "_atom_site.auth_asym_id",
        "_atom_site.auth_atom_id",
        "_atom_site.pdbx_PDB_model_num",
        "ATOM 1 N N . PRO A 1 6 ? 0.0 0.0 0.0 1.00 10.00 6 PRO A N 1",
        "ATOM 2 C CA . PRO A 1 6 ? 1.0 0.0 0.0 1.00 10.00 6 PRO A CA 1",
        "ATOM 3 N N . GLY A 1 7 ? 2.0 0.0 0.0 1.00 10.00 7 GLY A N 1",
        "ATOM 4 C CA . GLY A 1 7 ? 3.0 0.0 0.0 1.00 10.00 7 GLY A CA 1",
        "#",
        "loop_",
        "_pdbx_unobs_or_zero_occ_residues.id",
        "_pdbx_unobs_or_zero_occ_residues.PDB_model_num",
        "_pdbx_unobs_or_zero_occ_residues.polymer_flag",
        "_pdbx_unobs_or_zero_occ_residues.occupancy_flag",
        "_pdbx_unobs_or_zero_occ_residues.auth_asym_id",
        "_pdbx_unobs_or_zero_occ_residues.auth_comp_id",
        "_pdbx_unobs_or_zero_occ_residues.auth_seq_id",
        "_pdbx_unobs_or_zero_occ_residues.PDB_ins_code",
        "_pdbx_unobs_or_zero_occ_residues.label_asym_id",
        "_pdbx_unobs_or_zero_occ_residues.label_comp_id",
        "_pdbx_unobs_or_zero_occ_residues.label_seq_id",
        "1 1 Y 1 A SER 8 ? A SER 3",
        "2 1 Y 1 A THR 9 ? A THR 4",
        "3 1 Y 1 B LYS 1 ? B LYS 1",
        "#",
        "loop_",
        "_pdbx_poly_seq_scheme.asym_id",
        "_pdbx_poly_seq_scheme.entity_id",
        "_pdbx_poly_seq_scheme.seq_id",
        "_pdbx_poly_seq_scheme.mon_id",
        "_pdbx_poly_seq_scheme.ndb_seq_num",
        "_pdbx_poly_seq_scheme.pdb_seq_num",
        "_pdbx_poly_seq_scheme.auth_seq_num",
        "_pdbx_poly_seq_scheme.pdb_mon_id",
        "_pdbx_poly_seq_scheme.auth_mon_id",
        "_pdbx_poly_seq_scheme.pdb_strand_id",
        "_pdbx_poly_seq_scheme.pdb_ins_code",
        "_pdbx_poly_seq_scheme.hetero",
        "A 1 1 PRO 6 6 6 PRO PRO A . n",
        "A 1 2 GLY 7 7 7 GLY GLY A . n",
        "A 1 3 SER 8 8 8 SER SER A . n",
        "A 1 4 THR 9 9 9 THR THR A . n",
        "B 2 1 LYS 1 1 1 LYS LYS B . n",
        "#",
        "loop_",
        "_struct_asym.id",
        "_struct_asym.pdbx_blank_PDB_chainid_flag",
        "_struct_asym.pdbx_modified",
        "_struct_asym.entity_id",
        "_struct_asym.details",
        "A N N 1 ?",
        "B N N 2 ?",
        "#",
    ]
    path.write_text("\n".join(lines) + "\n")


def _read_mmcif_atom_site_seq_ids(path: Path) -> tuple[list[int], list[int]]:
    lines = path.read_text().splitlines()
    columns: list[str] = []
    rows: list[list[str]] = []
    in_atom_site = False

    for line in lines:
        stripped = line.strip()
        if stripped == "loop_":
            columns = []
            rows = []
            in_atom_site = False
            continue
        if stripped.startswith("_"):
            columns.append(stripped)
            in_atom_site = columns[0].startswith("_atom_site.")
            continue
        if in_atom_site and stripped and stripped != "#":
            rows.append(stripped.split())
            continue
        if in_atom_site and (not stripped or stripped == "#"):
            break

    label_seq_idx = columns.index("_atom_site.label_seq_id")
    auth_seq_idx = columns.index("_atom_site.auth_seq_id")
    atom_name_idx = columns.index("_atom_site.label_atom_id")

    label_seq_ids: list[int] = []
    auth_seq_ids: list[int] = []
    for row in rows:
        if row[atom_name_idx] != "N":
            continue
        label_seq_ids.append(int(row[label_seq_idx]))
        auth_seq_ids.append(int(row[auth_seq_idx]))
    return label_seq_ids, auth_seq_ids


def _read_mmcif_loop_rows(path: Path, prefix: str) -> list[list[str]]:
    lines = path.read_text().splitlines()
    index = 0
    while index < len(lines):
        if lines[index].strip() != "loop_":
            index += 1
            continue
        index += 1
        columns: list[str] = []
        while index < len(lines) and lines[index].strip().startswith("_"):
            columns.append(lines[index].strip())
            index += 1
        if not columns or columns[0].split(".")[0] != prefix:
            continue
        rows: list[list[str]] = []
        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped or stripped == "#" or stripped == "loop_" or stripped.startswith("_") or stripped.startswith("data_"):
                break
            rows.append(stripped.split())
            index += 1
        return rows
    return []


class StructureEditTests(unittest.TestCase):
    def test_crop_to_selection_writes_only_selected_residues(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            result = crop_to_selection(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(_fixture_pdb_path()),
                selection="A1-2",
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
                selection="A1-2",
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
                selection="A2-4",
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
                selection="A2-4",
                residue_ranges=[ResidueRange(chain_id="A", start=2, end=4)],
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            self.assertEqual(_read_residue_numbers(output_path), [1, 5])

    def test_crop_to_selection_reports_kept_chain_ids(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "multichain.pdb"
            _write_multichain_pdb(source_path)
            result = crop_to_selection(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(source_path),
                selection="B1",
                residue_ranges=[ResidueRange(chain_id="B", start=1, end=1)],
                output_dir=tmp_dir,
            )

            self.assertEqual(result["kept_chain_ids"], ["B"])

    def test_cut_selection_off_target_reports_kept_chain_ids(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "multichain.pdb"
            _write_multichain_pdb(source_path)
            result = cut_selection_off_target(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(source_path),
                selection="B1",
                residue_ranges=[ResidueRange(chain_id="B", start=1, end=1)],
                output_dir=tmp_dir,
            )

            self.assertEqual(result["kept_chain_ids"], ["A"])

    @unittest.skipUnless(HAS_BIOPYTHON, "Biopython is required for mmCIF edit tests.")
    def test_crop_to_selection_preserves_mmcif_atom_site_sequence_ids(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            result = crop_to_selection(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(_fixture_cif_path()),
                selection="A1-2",
                residue_ranges=[ResidueRange(chain_id="A", start=1, end=2)],
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            label_seq_ids, auth_seq_ids = _read_mmcif_atom_site_seq_ids(output_path)
            self.assertEqual(label_seq_ids, [1, 2])
            self.assertEqual(auth_seq_ids, [1, 2])

    def test_crop_to_selection_removes_unobserved_residues_from_touched_chain_and_purely_unobserved_chains(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "unobserved.cif"
            _write_mmcif_with_unobserved_residues(source_path)
            result = crop_to_selection(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(source_path),
                selection="A6-7",
                residue_ranges=[ResidueRange(chain_id="A", start=6, end=7)],
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            unobserved_rows = _read_mmcif_loop_rows(output_path, "_pdbx_unobs_or_zero_occ_residues")
            poly_seq_rows = _read_mmcif_loop_rows(output_path, "_pdbx_poly_seq_scheme")
            struct_asym_rows = _read_mmcif_loop_rows(output_path, "_struct_asym")
            entity_poly_rows = _read_mmcif_loop_rows(output_path, "_entity_poly")
            entity_poly_seq_rows = _read_mmcif_loop_rows(output_path, "_entity_poly_seq")
            self.assertEqual(unobserved_rows, [])
            self.assertEqual([row[0] for row in poly_seq_rows], ["A", "A"])
            self.assertEqual([row[6] for row in poly_seq_rows], ["6", "7"])
            self.assertEqual([row[0] for row in struct_asym_rows], ["A"])
            self.assertEqual(entity_poly_rows, [])
            self.assertEqual(entity_poly_seq_rows, [])

    def test_cut_selection_off_target_removes_unobserved_residues_from_touched_chain(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "unobserved.cif"
            _write_mmcif_with_unobserved_residues(source_path)
            result = cut_selection_off_target(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(source_path),
                selection="A6",
                residue_ranges=[ResidueRange(chain_id="A", start=6, end=6)],
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            unobserved_rows = _read_mmcif_loop_rows(output_path, "_pdbx_unobs_or_zero_occ_residues")
            poly_seq_rows = _read_mmcif_loop_rows(output_path, "_pdbx_poly_seq_scheme")
            struct_asym_rows = _read_mmcif_loop_rows(output_path, "_struct_asym")
            entity_poly_rows = _read_mmcif_loop_rows(output_path, "_entity_poly")
            entity_poly_seq_rows = _read_mmcif_loop_rows(output_path, "_entity_poly_seq")
            self.assertEqual(unobserved_rows, [])
            self.assertEqual([row[0] for row in poly_seq_rows], ["A"])
            self.assertEqual([row[6] for row in poly_seq_rows], ["7"])
            self.assertEqual([row[0] for row in struct_asym_rows], ["A"])
            self.assertEqual(entity_poly_rows, [])
            self.assertEqual(entity_poly_seq_rows, [])


if __name__ == "__main__":
    unittest.main()
