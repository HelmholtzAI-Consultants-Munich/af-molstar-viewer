from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Callable

from .selection import ResidueRange


def crop_to_selection(
    *,
    project_id: str,
    target_id: str,
    target_name: str,
    structure_path: str,
    target_interface_residues: str,
    residue_ranges: list[ResidueRange],
    output_dir: str,
) -> dict[str, Any]:
    structure_file = Path(structure_path)
    output_path = Path(output_dir) / f"{target_id}-cropped{structure_file.suffix}"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    kept_residue_count, kept_chain_ids = _write_filtered_structure(
        structure_file,
        output_path,
        residue_ranges,
        keep_selected=True,
    )
    payload = {
        "operation": "crop_to_selection",
        "project_id": project_id,
        "target_id": target_id,
        "target_name": target_name,
        "structure_path": str(structure_file),
        "target_interface_residues": target_interface_residues,
        "residue_ranges": [_serialize_range(residue_range) for residue_range in residue_ranges],
        "output_path": str(output_path),
        "kept_residue_count": kept_residue_count,
        "kept_chain_ids": kept_chain_ids,
    }
    return payload


def cut_selection_off_target(
    *,
    project_id: str,
    target_id: str,
    target_name: str,
    structure_path: str,
    target_interface_residues: str,
    residue_ranges: list[ResidueRange],
    output_dir: str,
) -> dict[str, Any]:
    structure_file = Path(structure_path)
    output_path = Path(output_dir) / f"{target_id}-cut{structure_file.suffix}"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    kept_residue_count, kept_chain_ids = _write_filtered_structure(
        structure_file,
        output_path,
        residue_ranges,
        keep_selected=False,
    )
    payload = {
        "operation": "cut_selection_off_target",
        "project_id": project_id,
        "target_id": target_id,
        "target_name": target_name,
        "structure_path": str(structure_file),
        "target_interface_residues": target_interface_residues,
        "residue_ranges": [_serialize_range(residue_range) for residue_range in residue_ranges],
        "output_path": str(output_path),
        "kept_residue_count": kept_residue_count,
        "kept_chain_ids": kept_chain_ids,
    }
    return payload


def _write_filtered_structure(
    structure_file: Path,
    output_path: Path,
    residue_ranges: list[ResidueRange],
    *,
    keep_selected: bool,
) -> int:
    if structure_file.suffix.lower() in {".cif", ".mmcif"}:
        return _write_filtered_mmcif_text(
            structure_file,
            output_path,
            residue_ranges,
            keep_selected=keep_selected,
        )
    try:
        return _write_filtered_structure_with_biopython(
            structure_file,
            output_path,
            residue_ranges,
            keep_selected=keep_selected,
        )
    except ModuleNotFoundError:
        if structure_file.suffix.lower() != ".pdb":
            raise RuntimeError(
                "Biopython is required to edit CIF/mmCIF structures. Run `uv sync` in backend/ first."
            ) from None
        return _write_filtered_pdb_text(
            structure_file,
            output_path,
            residue_ranges,
            keep_selected=keep_selected,
        )


def _write_filtered_structure_with_biopython(
    structure_file: Path,
    output_path: Path,
    residue_ranges: list[ResidueRange],
    *,
    keep_selected: bool,
) -> tuple[int, list[str]]:
    from Bio.PDB import MMCIFIO, MMCIFParser, PDBIO, PDBParser, Select

    keep_residue = _make_keep_residue_predicate(residue_ranges, keep_selected=keep_selected)
    parser = MMCIFParser(QUIET=True) if structure_file.suffix.lower() in {".cif", ".mmcif"} else PDBParser(QUIET=True)
    structure = parser.get_structure(structure_file.stem, str(structure_file))

    class ResidueSelect(Select):
        def accept_residue(self, residue) -> bool:  # type: ignore[override]
            # Keep Biopython's original residue ids so edited structures preserve
            # numbering gaps such as A1, A5 after cutting away A2-4.
            return 1 if keep_residue(residue.get_parent().id, residue.id[1]) else 0

    kept_chain_ids = sorted(
        {
            residue.get_parent().id
            for residue in structure.get_residues()
            if keep_residue(residue.get_parent().id, residue.id[1])
        }
    )
    kept_residue_count = sum(
        1
        for residue in structure.get_residues()
        if keep_residue(residue.get_parent().id, residue.id[1])
    )
    if kept_residue_count == 0:
        raise ValueError("The requested edit would remove every residue from the structure.")

    io = MMCIFIO() if structure_file.suffix.lower() in {".cif", ".mmcif"} else PDBIO()
    io.set_structure(structure)
    io.save(str(output_path), select=ResidueSelect())
    if structure_file.suffix.lower() in {".cif", ".mmcif"}:
        _normalize_mmcif_atom_site_label_seq_ids(output_path)
    return kept_residue_count, kept_chain_ids


def _write_filtered_pdb_text(
    structure_file: Path,
    output_path: Path,
    residue_ranges: list[ResidueRange],
    *,
    keep_selected: bool,
) -> tuple[int, list[str]]:
    keep_residue = _make_keep_residue_predicate(residue_ranges, keep_selected=keep_selected)
    kept_residue_keys: set[tuple[str, int, str]] = set()
    kept_chain_ids: set[str] = set()
    filtered_lines: list[str] = []

    for line in structure_file.read_text().splitlines():
        record = line[:6].strip()
        if record in {"ATOM", "HETATM", "ANISOU"}:
            chain_id = line[21].strip() or " "
            residue_number = int(line[22:26].strip())
            insertion_code = line[26].strip()
            if keep_residue(chain_id, residue_number):
                # Copy the original coordinate record verbatim so residue numbers
                # remain unchanged in the output structure.
                filtered_lines.append(line)
                kept_residue_keys.add((chain_id, residue_number, insertion_code))
                kept_chain_ids.add(chain_id)
            continue
        if record == "TER":
            continue
        filtered_lines.append(line)

    if not kept_residue_keys:
        raise ValueError("The requested edit would remove every residue from the structure.")

    if not any(line.startswith("END") for line in filtered_lines):
        filtered_lines.append("END")
    output_path.write_text("\n".join(filtered_lines) + "\n")
    return len(kept_residue_keys), sorted(kept_chain_ids)


def _make_keep_residue_predicate(
    residue_ranges: list[ResidueRange],
    *,
    keep_selected: bool,
) -> Callable[[str, int], bool]:
    def residue_is_selected(chain_id: str, residue_number: int) -> bool:
        return any(
            residue_range.chain_id == chain_id
            and residue_range.start <= residue_number <= residue_range.end
            for residue_range in residue_ranges
        )

    return residue_is_selected if keep_selected else lambda chain_id, residue_number: not residue_is_selected(chain_id, residue_number)


def _serialize_range(residue_range: ResidueRange) -> dict[str, int | str]:
    return {
        "chain_id": residue_range.chain_id,
        "start": residue_range.start,
        "end": residue_range.end,
    }


_MMCIF_TOKEN_PATTERN = re.compile(r"'(?:[^']*)'|\"(?:[^\"]*)\"|\S+")


def _tokenize_mmcif_row(line: str) -> list[str]:
    return _MMCIF_TOKEN_PATTERN.findall(line)


def _normalize_mmcif_atom_site_label_seq_ids(path: Path) -> None:
    lines = path.read_text().splitlines()

    loop_start = None
    loop_end = None
    columns: list[str] = []
    row_indices: list[int] = []

    index = 0
    while index < len(lines):
        if lines[index].strip() != "loop_":
            index += 1
            continue

        candidate_columns: list[str] = []
        cursor = index + 1
        while cursor < len(lines) and lines[cursor].strip().startswith("_"):
            candidate_columns.append(lines[cursor].strip())
            cursor += 1

        if candidate_columns and candidate_columns[0].startswith("_atom_site."):
            loop_start = index
            columns = candidate_columns
            while cursor < len(lines):
                stripped = lines[cursor].strip()
                if not stripped or stripped == "#" or stripped == "loop_" or stripped.startswith("_") or stripped.startswith("data_"):
                    break
                row_indices.append(cursor)
                cursor += 1
            loop_end = cursor
            break

        index = cursor

    if loop_start is None or loop_end is None or not row_indices:
        return

    try:
        label_asym_idx = columns.index("_atom_site.label_asym_id")
        label_seq_idx = columns.index("_atom_site.label_seq_id")
    except ValueError:
        return

    auth_seq_idx = columns.index("_atom_site.auth_seq_id") if "_atom_site.auth_seq_id" in columns else None
    auth_comp_idx = columns.index("_atom_site.auth_comp_id") if "_atom_site.auth_comp_id" in columns else None
    label_comp_idx = columns.index("_atom_site.label_comp_id") if "_atom_site.label_comp_id" in columns else None
    ins_code_idx = columns.index("_atom_site.pdbx_PDB_ins_code") if "_atom_site.pdbx_PDB_ins_code" in columns else None

    next_label_seq_by_chain: dict[str, int] = {}
    label_seq_by_residue: dict[tuple[str, str, str, str], int] = {}

    for row_index in row_indices:
        tokens = _tokenize_mmcif_row(lines[row_index])
        if len(tokens) != len(columns):
            continue

        chain_id = tokens[label_asym_idx]
        auth_seq = tokens[auth_seq_idx] if auth_seq_idx is not None else tokens[label_seq_idx]
        comp_id = tokens[auth_comp_idx] if auth_comp_idx is not None else (
            tokens[label_comp_idx] if label_comp_idx is not None else "?"
        )
        ins_code = tokens[ins_code_idx] if ins_code_idx is not None else "?"
        residue_key = (chain_id, auth_seq, comp_id, ins_code)

        if residue_key not in label_seq_by_residue:
            next_label_seq = next_label_seq_by_chain.get(chain_id, 0) + 1
            next_label_seq_by_chain[chain_id] = next_label_seq
            label_seq_by_residue[residue_key] = next_label_seq

        tokens[label_seq_idx] = str(label_seq_by_residue[residue_key])
        lines[row_index] = " ".join(tokens)

    path.write_text("\n".join(lines) + "\n")


def _write_filtered_mmcif_text(
    structure_file: Path,
    output_path: Path,
    residue_ranges: list[ResidueRange],
    *,
    keep_selected: bool,
) -> tuple[int, list[str]]:
    keep_residue = _make_keep_residue_predicate(residue_ranges, keep_selected=keep_selected)
    lines = structure_file.read_text().splitlines()
    touched_chains = {residue_range.chain_id for residue_range in residue_ranges}
    observed_residue_keys, observed_chain_ids = _collect_mmcif_observed_residues(lines)
    output_lines: list[str] = []
    kept_residue_keys: set[tuple[str, int]] = set()
    kept_chain_ids: set[str] = set()

    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if stripped != "loop_":
            output_lines.append(lines[index])
            index += 1
            continue

        loop_start = index
        index += 1
        columns: list[str] = []
        while index < len(lines) and lines[index].strip().startswith("_"):
            columns.append(lines[index].strip())
            index += 1

        row_lines: list[str] = []
        while index < len(lines):
            candidate = lines[index].strip()
            if not candidate or candidate == "#" or candidate == "loop_" or candidate.startswith("_") or candidate.startswith("data_"):
                break
            row_lines.append(lines[index])
            index += 1

        filtered_row_lines = row_lines
        if columns:
            prefix = columns[0].split(".")[0]
            if prefix in {"_entity_poly", "_entity_poly_seq"}:
                filtered_row_lines = []
            if prefix in {
                "_atom_site",
                "_atom_site_anisotrop",
                "_pdbx_unobs_or_zero_occ_atoms",
                "_pdbx_unobs_or_zero_occ_residues",
                "_pdbx_poly_seq_scheme",
                "_struct_asym",
            }:
                filtered_row_lines, loop_kept_residue_keys, loop_kept_chain_ids = _filter_mmcif_loop_rows(
                    prefix,
                    columns,
                    row_lines,
                    keep_residue,
                    touched_chains=touched_chains,
                    observed_residue_keys=observed_residue_keys,
                    observed_chain_ids=observed_chain_ids,
                )
                kept_residue_keys.update(loop_kept_residue_keys)
                kept_chain_ids.update(loop_kept_chain_ids)

        output_lines.append(lines[loop_start])
        output_lines.extend(lines[loop_start + 1 : loop_start + 1 + len(columns)])
        output_lines.extend(filtered_row_lines)

        if index < len(lines) and lines[index].strip() == "#":
            output_lines.append(lines[index])
            index += 1

    if not kept_residue_keys:
        raise ValueError("The requested edit would remove every residue from the structure.")

    output_path.write_text("\n".join(output_lines) + "\n")
    return len(kept_residue_keys), sorted(kept_chain_ids)


def _filter_mmcif_loop_rows(
    prefix: str,
    columns: list[str],
    row_lines: list[str],
    keep_residue: Callable[[str, int], bool],
    *,
    touched_chains: set[str],
    observed_residue_keys: set[tuple[str, int]],
    observed_chain_ids: set[str],
) -> tuple[list[str], set[tuple[str, int]], set[str]]:
    filtered_rows: list[str] = []
    kept_residue_keys: set[tuple[str, int]] = set()
    kept_chain_ids: set[str] = set()

    chain_column_names = [
        "_atom_site.auth_asym_id",
        "_atom_site.label_asym_id",
        "_atom_site_anisotrop.pdbx_auth_asym_id",
        "_atom_site_anisotrop.pdbx_label_asym_id",
        "_pdbx_unobs_or_zero_occ_atoms.auth_asym_id",
        "_pdbx_unobs_or_zero_occ_atoms.label_asym_id",
        "_pdbx_unobs_or_zero_occ_residues.auth_asym_id",
        "_pdbx_unobs_or_zero_occ_residues.label_asym_id",
        "_pdbx_poly_seq_scheme.pdb_strand_id",
        "_pdbx_poly_seq_scheme.asym_id",
        "_struct_asym.id",
    ]
    seq_column_names = [
        "_atom_site.auth_seq_id",
        "_atom_site.label_seq_id",
        "_atom_site_anisotrop.pdbx_auth_seq_id",
        "_atom_site_anisotrop.pdbx_label_seq_id",
        "_pdbx_unobs_or_zero_occ_atoms.auth_seq_id",
        "_pdbx_unobs_or_zero_occ_atoms.label_seq_id",
        "_pdbx_unobs_or_zero_occ_residues.auth_seq_id",
        "_pdbx_unobs_or_zero_occ_residues.label_seq_id",
        "_pdbx_poly_seq_scheme.auth_seq_num",
        "_pdbx_poly_seq_scheme.seq_id",
        "_pdbx_poly_seq_scheme.pdb_seq_num",
    ]

    chain_index = next((columns.index(name) for name in chain_column_names if name in columns), None)
    seq_index = next((columns.index(name) for name in seq_column_names if name in columns), None)
    if prefix == "_struct_asym":
        if chain_index is None:
            return row_lines, kept_residue_keys, kept_chain_ids
        for row_line in row_lines:
            tokens = _tokenize_mmcif_row(row_line)
            if len(tokens) != len(columns):
                filtered_rows.append(row_line)
                continue
            chain_id = tokens[chain_index]
            if chain_id in observed_chain_ids:
                filtered_rows.append(row_line)
                kept_chain_ids.add(chain_id)
        return filtered_rows, kept_residue_keys, kept_chain_ids

    if chain_index is None or seq_index is None:
        return row_lines, kept_residue_keys, kept_chain_ids

    for row_line in row_lines:
        tokens = _tokenize_mmcif_row(row_line)
        if len(tokens) != len(columns):
            filtered_rows.append(row_line)
            continue

        chain_id = tokens[chain_index]
        residue_number_token = tokens[seq_index]
        try:
            residue_number = int(residue_number_token)
        except ValueError:
            filtered_rows.append(row_line)
            continue

        if chain_id not in observed_chain_ids and prefix != "_atom_site" and prefix != "_atom_site_anisotrop":
            continue

        if prefix in {"_pdbx_unobs_or_zero_occ_atoms", "_pdbx_unobs_or_zero_occ_residues"} and chain_id in touched_chains:
            continue

        if prefix == "_pdbx_poly_seq_scheme" and chain_id in touched_chains and (chain_id, residue_number) not in observed_residue_keys:
            continue

        if keep_residue(chain_id, residue_number):
            filtered_rows.append(row_line)
            kept_residue_keys.add((chain_id, residue_number))
            kept_chain_ids.add(chain_id)

    return filtered_rows, kept_residue_keys, kept_chain_ids


def _collect_mmcif_observed_residues(lines: list[str]) -> tuple[set[tuple[str, int]], set[str]]:
    observed_residue_keys: set[tuple[str, int]] = set()
    observed_chain_ids: set[str] = set()

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

        if not columns or columns[0].split(".")[0] != "_atom_site":
            while index < len(lines):
                stripped = lines[index].strip()
                if not stripped or stripped == "#" or stripped == "loop_" or stripped.startswith("_") or stripped.startswith("data_"):
                    break
                index += 1
            continue

        chain_idx = next(
            (columns.index(name) for name in ["_atom_site.auth_asym_id", "_atom_site.label_asym_id"] if name in columns),
            None,
        )
        seq_idx = next(
            (columns.index(name) for name in ["_atom_site.auth_seq_id", "_atom_site.label_seq_id"] if name in columns),
            None,
        )
        if chain_idx is None or seq_idx is None:
            break

        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped or stripped == "#" or stripped == "loop_" or stripped.startswith("_") or stripped.startswith("data_"):
                break
            tokens = _tokenize_mmcif_row(lines[index])
            if len(tokens) == len(columns):
                chain_id = tokens[chain_idx]
                try:
                    residue_number = int(tokens[seq_idx])
                except ValueError:
                    pass
                else:
                    observed_residue_keys.add((chain_id, residue_number))
                    observed_chain_ids.add(chain_id)
            index += 1
        break

    return observed_residue_keys, observed_chain_ids
