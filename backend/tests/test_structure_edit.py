from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.selection import ResidueRange
from backend.structure_edit import (
    crop_to_selection,
    cut_selection_off_target,
    reset_auth_indexing,
    _normalize_mmcif_filtered_metadata,
)

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


def _write_two_residue_pdb(path: Path) -> None:
    lines = [
        "ATOM      1  N   ALA A  10      11.000  13.000   9.000  1.00 95.00           N",
        "ATOM      2  CA  ALA A  10      12.000  13.200   9.300  1.00 95.00           C",
        "ATOM      3  N   GLY A  20      13.900  12.100  10.200  1.00 82.00           N",
        "ATOM      4  CA  GLY A  20      14.600  11.100  10.900  1.00 82.00           C",
        "END",
    ]
    path.write_text("\n".join(lines) + "\n")


def _write_simple_mmcif(path: Path) -> None:
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
        "ATOM 1 N N . ALA A 1 1 ? 0.0 0.0 0.0 1.00 10.00 10 ALA X N 1",
        "ATOM 2 C CA . ALA A 1 1 ? 1.0 0.0 0.0 1.00 10.00 10 ALA X CA 1",
        "ATOM 3 N N . GLY A 1 2 ? 2.0 0.0 0.0 1.00 10.00 20 GLY X N 1",
        "ATOM 4 C CA . GLY A 1 2 ? 3.0 0.0 0.0 1.00 10.00 20 GLY X CA 1",
        "#",
        "loop_",
        "_struct_asym.id",
        "_struct_asym.pdbx_blank_PDB_chainid_flag",
        "_struct_asym.pdbx_modified",
        "_struct_asym.entity_id",
        "_struct_asym.details",
        "A N N 1 ?",
        "#",
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


def _write_mmcif_with_unobserved_prefix_and_helix(path: Path) -> None:
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
        "ATOM 1 N N . PSPLL A 1 6 ? 0.0 0.0 0.0 1.00 10.00 6 PSPLL A N 1",
        "ATOM 2 C CA . PSPLL A 1 6 ? 1.0 0.0 0.0 1.00 10.00 6 PSPLL A CA 1",
        "ATOM 3 N N . ALA A 1 7 ? 2.0 0.0 0.0 1.00 10.00 7 ALA A N 1",
        "ATOM 4 C CA . ALA A 1 7 ? 3.0 0.0 0.0 1.00 10.00 7 ALA A CA 1",
        "ATOM 5 N N . GLY A 1 8 ? 4.0 0.0 0.0 1.00 10.00 8 GLY A N 1",
        "ATOM 6 C CA . GLY A 1 8 ? 5.0 0.0 0.0 1.00 10.00 8 GLY A CA 1",
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
        "A 1 1 MVMEK 1 1 1 MVMEK MVMEK A . n",
        "A 1 2 PSPLL 2 2 2 PSPLL PSPLL A . n",
        "A 1 3 ALA 3 3 3 ALA ALA A . n",
        "A 1 4 GLY 4 4 4 GLY GLY A . n",
        "#",
        "loop_",
        "_struct_conf.conf_type_id",
        "_struct_conf.id",
        "_struct_conf.pdbx_PDB_helix_id",
        "_struct_conf.beg_label_comp_id",
        "_struct_conf.beg_label_asym_id",
        "_struct_conf.beg_label_seq_id",
        "_struct_conf.pdbx_beg_PDB_ins_code",
        "_struct_conf.end_label_comp_id",
        "_struct_conf.end_label_asym_id",
        "_struct_conf.end_label_seq_id",
        "_struct_conf.pdbx_end_PDB_ins_code",
        "_struct_conf.beg_auth_comp_id",
        "_struct_conf.beg_auth_asym_id",
        "_struct_conf.beg_auth_seq_id",
        "_struct_conf.end_auth_comp_id",
        "_struct_conf.end_auth_asym_id",
        "_struct_conf.end_auth_seq_id",
        "_struct_conf.pdbx_PDB_helix_class",
        "_struct_conf.details",
        "_struct_conf.pdbx_PDB_helix_length",
        "HELX_P HELX_P1 AA1 PSPLL A 2 ? GLY A 4 ? PSPLL A 2 GLY A 4 1 ? 3",
        "#",
    ]
    path.write_text("\n".join(lines) + "\n")


def _write_mmcif_with_stale_chain_metadata(path: Path) -> None:
    lines = [
        "data_test",
        "#",
        "loop_",
        "_struct_asym.id",
        "_struct_asym.pdbx_blank_PDB_chainid_flag",
        "_struct_asym.pdbx_modified",
        "_struct_asym.entity_id",
        "_struct_asym.details",
        "A N N 1 ?",
        "B N N 1 ?",
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
        "A 1 1 ALA 1 1 1 ALA ALA A . n",
        "B 1 1 GLY 1 1 1 GLY GLY B . n",
        "#",
        "loop_",
        "_pdbx_struct_assembly_gen.assembly_id",
        "_pdbx_struct_assembly_gen.oper_expression",
        "_pdbx_struct_assembly_gen.asym_id_list",
        "1 1 A,B",
        "#",
        "loop_",
        "_entity_poly.entity_id",
        "_entity_poly.type",
        "1 polymer",
        "#",
        "loop_",
        "_entity_poly_seq.entity_id",
        "_entity_poly_seq.num",
        "_entity_poly_seq.mon_id",
        "1 1 ALA",
        "#",
        "loop_",
        "_struct_ref.id",
        "_struct_ref.db_name",
        "1 UNP",
        "#",
        "loop_",
        "_struct_ref_seq.align_id",
        "_struct_ref_seq.seq_align_beg",
        "1 1",
        "#",
    ]
    path.write_text("\n".join(lines) + "\n")


def _write_mmcif_with_truncated_poly_seq_scheme(path: Path) -> None:
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
        "ATOM 1 N N . ALA A 1 1 ? 0.0 0.0 0.0 1.00 10.00 10 ALA A N 1",
        "ATOM 2 C CA . ALA A 1 1 ? 1.0 0.0 0.0 1.00 10.00 10 ALA A CA 1",
        "ATOM 3 N N . GLY A 1 2 ? 2.0 0.0 0.0 1.00 10.00 11 GLY A N 1",
        "ATOM 4 C CA . GLY A 1 2 ? 3.0 0.0 0.0 1.00 10.00 11 GLY A CA 1",
        "ATOM 5 N N . SER A 1 3 ? 4.0 0.0 0.0 1.00 10.00 12 SER A N 1",
        "ATOM 6 C CA . SER A 1 3 ? 5.0 0.0 0.0 1.00 10.00 12 SER A CA 1",
        "ATOM 7 N N . THR A 1 4 ? 6.0 0.0 0.0 1.00 10.00 13 THR A N 1",
        "ATOM 8 C CA . THR A 1 4 ? 7.0 0.0 0.0 1.00 10.00 13 THR A CA 1",
        "#",
        "loop_",
        "_struct_asym.id",
        "_struct_asym.pdbx_blank_PDB_chainid_flag",
        "_struct_asym.pdbx_modified",
        "_struct_asym.entity_id",
        "_struct_asym.details",
        "A N N 1 ?",
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
        "A 1 1 ALA 10 10 10 ALA ALA A . n",
        "A 1 2 GLY 11 11 11 GLY GLY A . n",
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


def _read_pdb_residue_numbers(path: Path) -> list[int]:
    residue_numbers: list[int] = []
    seen: set[int] = set()
    for line in path.read_text().splitlines():
        if not line.startswith(("ATOM", "HETATM")):
            continue
        residue_number = int(line[22:26].strip())
        if residue_number not in seen:
            seen.add(residue_number)
            residue_numbers.append(residue_number)
    return residue_numbers


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
            self.assertEqual(result["kept_chain_ids"], ["A"])
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
            self.assertEqual(result["kept_chain_ids"], ["A"])
            self.assertEqual(unobserved_rows, [])
            self.assertEqual([row[0] for row in poly_seq_rows], ["A"])
            self.assertEqual([row[6] for row in poly_seq_rows], ["7"])
            self.assertEqual([row[0] for row in struct_asym_rows], ["A"])
            self.assertEqual(entity_poly_rows, [])
            self.assertEqual(entity_poly_seq_rows, [])

    def test_reset_auth_indexing_renumbers_pdb_residues_sequentially(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "shifted.pdb"
            _write_two_residue_pdb(source_path)
            result = reset_auth_indexing(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(source_path),
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            self.assertTrue(output_path.exists())
            self.assertEqual(result["kept_residue_count"], 2)
            self.assertEqual(_read_pdb_residue_numbers(output_path), [1, 2])

    @unittest.skipUnless(HAS_BIOPYTHON, "Biopython is required for mmCIF edit tests.")
    def test_reset_auth_indexing_renumbers_mmcif_auth_fields(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "shifted.cif"
            _write_simple_mmcif(source_path)
            result = reset_auth_indexing(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(source_path),
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            label_seq_ids, auth_seq_ids = _read_mmcif_atom_site_seq_ids(output_path)
            self.assertEqual(label_seq_ids, [1, 2])
            self.assertEqual(auth_seq_ids, [1, 2])
            self.assertEqual(result["kept_chain_ids"], ["A"])

    @unittest.skipUnless(HAS_BIOPYTHON, "Biopython is required for mmCIF edit tests.")
    def test_reset_auth_indexing_remaps_sequence_tables_and_secondary_structure(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "prefix_and_helix.cif"
            _write_mmcif_with_unobserved_prefix_and_helix(source_path)
            result = reset_auth_indexing(
                project_id="project-1",
                target_id="target-1",
                target_name="toy",
                structure_path=str(source_path),
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            poly_seq_rows = _read_mmcif_loop_rows(output_path, "_pdbx_poly_seq_scheme")
            struct_conf_rows = _read_mmcif_loop_rows(output_path, "_struct_conf")
            unobserved_rows = _read_mmcif_loop_rows(output_path, "_pdbx_unobs_or_zero_occ_residues")
            self.assertEqual([row[2] for row in poly_seq_rows], ["1", "2", "3"])
            self.assertEqual([row[3] for row in poly_seq_rows], ["PSPLL", "ALA", "GLY"])
            self.assertEqual(unobserved_rows, [])
            self.assertEqual([row[5] for row in struct_conf_rows], ["1"])
            self.assertEqual([row[9] for row in struct_conf_rows], ["3"])
            self.assertEqual([row[4] for row in struct_conf_rows], ["A"])
            self.assertEqual([row[8] for row in struct_conf_rows], ["A"])

    @unittest.skipUnless(HAS_BIOPYTHON, "Biopython is required for mmCIF edit tests.")
    def test_reset_auth_indexing_removes_unobserved_prefix_metadata_from_real_structure(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            result = reset_auth_indexing(
                project_id="project-1",
                target_id="target-1",
                target_name="7xhf",
                structure_path=str(Path(__file__).resolve().parents[2] / "fixtures" / "examples" / "7xhf.cif"),
                output_dir=tmp_dir,
            )

            output_path = Path(result["output_path"])
            text = output_path.read_text()
            self.assertNotIn("MVMEK", text)
            self.assertEqual(_read_mmcif_loop_rows(output_path, "_pdbx_unobs_or_zero_occ_residues"), [])

    def test_normalize_mmcif_filtered_metadata_prunes_stale_chain_annotations(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "stale_metadata.cif"
            _write_mmcif_with_stale_chain_metadata(source_path)

            _normalize_mmcif_filtered_metadata(source_path, {"A"})

            struct_asym_rows = _read_mmcif_loop_rows(source_path, "_struct_asym")
            poly_seq_rows = _read_mmcif_loop_rows(source_path, "_pdbx_poly_seq_scheme")
            assembly_rows = _read_mmcif_loop_rows(source_path, "_pdbx_struct_assembly_gen")
            entity_poly_rows = _read_mmcif_loop_rows(source_path, "_entity_poly")
            entity_poly_seq_rows = _read_mmcif_loop_rows(source_path, "_entity_poly_seq")
            struct_ref_rows = _read_mmcif_loop_rows(source_path, "_struct_ref")
            struct_ref_seq_rows = _read_mmcif_loop_rows(source_path, "_struct_ref_seq")

            self.assertEqual([row[0] for row in struct_asym_rows], ["A"])
            self.assertEqual(poly_seq_rows, [])
            self.assertEqual(assembly_rows[0][2], "A")
            self.assertEqual(entity_poly_rows, [])
            self.assertEqual(entity_poly_seq_rows, [])
            self.assertEqual(struct_ref_rows, [])
            self.assertEqual(struct_ref_seq_rows, [])

    def test_normalize_mmcif_filtered_metadata_rebuilds_poly_seq_scheme_from_atoms(self) -> None:
        with TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / "truncated_poly_seq.cif"
            _write_mmcif_with_truncated_poly_seq_scheme(source_path)

            _normalize_mmcif_filtered_metadata(source_path, {"A"})

            poly_seq_rows = _read_mmcif_loop_rows(source_path, "_pdbx_poly_seq_scheme")
            self.assertEqual([row[2] for row in poly_seq_rows], ["1", "2", "3", "4"])
            self.assertEqual([row[3] for row in poly_seq_rows], ["ALA", "GLY", "SER", "THR"])
            self.assertEqual([row[6] for row in poly_seq_rows], ["10", "11", "12", "13"])


if __name__ == "__main__":
    unittest.main()
