from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
from typing import Any, Callable

from .selection import ResidueRange

MmcifResidueKey = tuple[str, str, str, str]


def crop_to_selection(
    *,
    project_id: str,
    target_id: str,
    target_name: str,
    structure_path: str,
    selection: str,
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
        "selection": selection,
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
    selection: str,
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
        "selection": selection,
        "residue_ranges": [_serialize_range(residue_range) for residue_range in residue_ranges],
        "output_path": str(output_path),
        "kept_residue_count": kept_residue_count,
        "kept_chain_ids": kept_chain_ids,
    }
    return payload


def reset_auth_indexing(
    *,
    project_id: str,
    target_id: str,
    target_name: str,
    structure_path: str,
    output_dir: str,
) -> dict[str, Any]:
    structure_file = Path(structure_path)
    output_path = Path(output_dir) / f"{target_id}-auth-reset{structure_file.suffix}"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    kept_residue_count, kept_chain_ids = _rewrite_structure_auth_indexing(structure_file, output_path)
    return {
        "operation": "reset_auth_indexing",
        "project_id": project_id,
        "target_id": target_id,
        "target_name": target_name,
        "structure_path": str(structure_file),
        "output_path": str(output_path),
        "kept_residue_count": kept_residue_count,
        "kept_chain_ids": kept_chain_ids,
    }


def _write_filtered_structure(
    structure_file: Path,
    output_path: Path,
    residue_ranges: list[ResidueRange],
    *,
    keep_selected: bool,
) -> tuple[int, list[str]]:
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
        def accept_residue(self, residue) -> int:  # type: ignore[override]
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
    return _write_mmcif_text_with_residue_filter(
        lines,
        output_path,
        keep_residue,
        touched_chains=touched_chains,
        observed_residue_keys=observed_residue_keys,
        observed_chain_ids=observed_chain_ids,
    )


def _normalize_mmcif_filtered_metadata(path: Path, kept_chain_ids: set[str]) -> None:
    lines = path.read_text().splitlines()
    atom_residues, chain_entity_ids = _collect_mmcif_atom_residues_and_entities(lines)
    output_lines: list[str] = []

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
            if prefix in {"_entity_poly", "_entity_poly_seq", "_struct_ref", "_struct_ref_seq"}:
                filtered_row_lines = []
            elif prefix == "_struct_asym":
                filtered_row_lines = _filter_mmcif_rows_by_chain(
                    columns,
                    row_lines,
                    ["_struct_asym.id"],
                    kept_chain_ids,
                )
            elif prefix == "_pdbx_poly_seq_scheme":
                filtered_row_lines = _rewrite_mmcif_poly_seq_scheme_rows(
                    columns,
                    atom_residues,
                    chain_entity_ids,
                    kept_chain_ids,
                )
            elif prefix == "_pdbx_unobs_or_zero_occ_atoms":
                filtered_row_lines = _filter_mmcif_rows_by_chain(
                    columns,
                    row_lines,
                    [
                        "_pdbx_unobs_or_zero_occ_atoms.auth_asym_id",
                        "_pdbx_unobs_or_zero_occ_atoms.label_asym_id",
                        "_pdbx_unobs_or_zero_occ_atoms.pdbx_auth_asym_id",
                        "_pdbx_unobs_or_zero_occ_atoms.pdbx_label_asym_id",
                    ],
                    kept_chain_ids,
                )
            elif prefix == "_pdbx_unobs_or_zero_occ_residues":
                filtered_row_lines = _filter_mmcif_rows_by_chain(
                    columns,
                    row_lines,
                    [
                        "_pdbx_unobs_or_zero_occ_residues.auth_asym_id",
                        "_pdbx_unobs_or_zero_occ_residues.label_asym_id",
                        "_pdbx_unobs_or_zero_occ_residues.pdbx_auth_asym_id",
                        "_pdbx_unobs_or_zero_occ_residues.pdbx_label_asym_id",
                    ],
                    kept_chain_ids,
                )
            elif prefix == "_pdbx_struct_assembly_gen":
                filtered_row_lines = _rewrite_mmcif_assembly_gen_rows(columns, row_lines, kept_chain_ids)

        output_lines.append(lines[loop_start])
        output_lines.extend(lines[loop_start + 1 : loop_start + 1 + len(columns)])
        output_lines.extend(filtered_row_lines)

        if index < len(lines) and lines[index].strip() == "#":
            output_lines.append(lines[index])
            index += 1

    path.write_text("\n".join(output_lines) + "\n")


def _collect_mmcif_atom_residues_and_entities(
    lines: list[str],
) -> tuple[list[dict[str, str]], dict[str, str]]:
    residues: list[dict[str, str]] = []
    seen_residues: set[tuple[str, str, str, str]] = set()
    chain_entity_ids: dict[str, str] = {}

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

        row_lines: list[str] = []
        while index < len(lines):
            candidate = lines[index].strip()
            if not candidate or candidate == "#" or candidate == "loop_" or candidate.startswith("_") or candidate.startswith("data_"):
                break
            row_lines.append(lines[index])
            index += 1

        if not columns:
            continue

        prefix = columns[0].split(".")[0]
        if prefix == "_struct_asym":
            chain_idx = columns.index("_struct_asym.id") if "_struct_asym.id" in columns else None
            entity_idx = columns.index("_struct_asym.entity_id") if "_struct_asym.entity_id" in columns else None
            if chain_idx is not None and entity_idx is not None:
                for row_line in row_lines:
                    tokens = _tokenize_mmcif_row(row_line)
                    if len(tokens) == len(columns):
                        chain_entity_ids[tokens[chain_idx]] = tokens[entity_idx]
            continue

        if prefix != "_atom_site":
            continue

        label_asym_idx = columns.index("_atom_site.label_asym_id") if "_atom_site.label_asym_id" in columns else None
        label_seq_idx = columns.index("_atom_site.label_seq_id") if "_atom_site.label_seq_id" in columns else None
        label_comp_idx = columns.index("_atom_site.label_comp_id") if "_atom_site.label_comp_id" in columns else None
        auth_seq_idx = columns.index("_atom_site.auth_seq_id") if "_atom_site.auth_seq_id" in columns else None
        auth_comp_idx = columns.index("_atom_site.auth_comp_id") if "_atom_site.auth_comp_id" in columns else None
        ins_idx = columns.index("_atom_site.pdbx_PDB_ins_code") if "_atom_site.pdbx_PDB_ins_code" in columns else None
        if label_asym_idx is None or label_seq_idx is None:
            continue

        for row_line in row_lines:
            tokens = _tokenize_mmcif_row(row_line)
            if len(tokens) != len(columns):
                continue
            chain_id = tokens[label_asym_idx]
            original_seq = tokens[auth_seq_idx] if auth_seq_idx is not None else tokens[label_seq_idx]
            comp_id = tokens[label_comp_idx] if label_comp_idx is not None else (
                tokens[auth_comp_idx] if auth_comp_idx is not None else "?"
            )
            ins_code = tokens[ins_idx] if ins_idx is not None else "?"
            residue_key = (chain_id, original_seq, comp_id, ins_code)
            if residue_key in seen_residues:
                continue
            seen_residues.add(residue_key)
            residues.append(
                {
                    "chain_id": chain_id,
                    "auth_seq": original_seq,
                    "comp_id": comp_id,
                    "ins_code": ins_code,
                }
            )

    return residues, chain_entity_ids


def _rewrite_mmcif_poly_seq_scheme_rows(
    columns: list[str],
    atom_residues: list[dict[str, str]],
    chain_entity_ids: dict[str, str],
    kept_chain_ids: set[str],
) -> list[str]:
    if not atom_residues:
        return []

    chain_seq_counts: dict[str, int] = defaultdict(int)
    rows: list[str] = []

    for residue in atom_residues:
        chain_id = residue["chain_id"]
        if chain_id not in kept_chain_ids:
            continue
        chain_seq_counts[chain_id] += 1
        seq_id = chain_seq_counts[chain_id]
        auth_seq = residue["auth_seq"]
        comp_id = residue["comp_id"]
        ins_code = residue["ins_code"]
        entity_id = chain_entity_ids.get(chain_id, "1")

        column_values = {column: "?" for column in columns}
        for column in columns:
            if column == "_pdbx_poly_seq_scheme.asym_id":
                column_values[column] = chain_id
            elif column == "_pdbx_poly_seq_scheme.entity_id":
                column_values[column] = entity_id
            elif column == "_pdbx_poly_seq_scheme.seq_id":
                column_values[column] = str(seq_id)
            elif column == "_pdbx_poly_seq_scheme.mon_id":
                column_values[column] = comp_id
            elif column == "_pdbx_poly_seq_scheme.ndb_seq_num":
                column_values[column] = auth_seq
            elif column == "_pdbx_poly_seq_scheme.pdb_seq_num":
                column_values[column] = auth_seq
            elif column == "_pdbx_poly_seq_scheme.auth_seq_num":
                column_values[column] = auth_seq
            elif column == "_pdbx_poly_seq_scheme.pdb_mon_id":
                column_values[column] = comp_id
            elif column == "_pdbx_poly_seq_scheme.auth_mon_id":
                column_values[column] = comp_id
            elif column == "_pdbx_poly_seq_scheme.pdb_strand_id":
                column_values[column] = chain_id
            elif column == "_pdbx_poly_seq_scheme.pdb_ins_code":
                column_values[column] = ins_code if ins_code not in {"?", "."} else "."
            elif column == "_pdbx_poly_seq_scheme.hetero":
                column_values[column] = "n"

        rows.append(" ".join(column_values[column] for column in columns))

    return rows


def _filter_mmcif_rows_by_chain(
    columns: list[str],
    row_lines: list[str],
    chain_candidates: list[str],
    kept_chain_ids: set[str],
) -> list[str]:
    chain_index = next((columns.index(name) for name in chain_candidates if name in columns), None)
    if chain_index is None:
        return row_lines

    filtered_rows: list[str] = []
    for row_line in row_lines:
        tokens = _tokenize_mmcif_row(row_line)
        if len(tokens) != len(columns):
            filtered_rows.append(row_line)
            continue
        if tokens[chain_index] in kept_chain_ids:
            filtered_rows.append(row_line)
    return filtered_rows


def _rewrite_mmcif_assembly_gen_rows(
    columns: list[str],
    row_lines: list[str],
    kept_chain_ids: set[str],
) -> list[str]:
    try:
        asym_list_idx = columns.index("_pdbx_struct_assembly_gen.asym_id_list")
    except ValueError:
        return row_lines

    filtered_rows: list[str] = []
    for row_line in row_lines:
        tokens = _tokenize_mmcif_row(row_line)
        if len(tokens) != len(columns):
            filtered_rows.append(row_line)
            continue

        asym_ids = [entry.strip() for entry in tokens[asym_list_idx].strip("'\"").split(",") if entry.strip()]
        kept_asym_ids = [chain_id for chain_id in asym_ids if chain_id in kept_chain_ids]
        if not kept_asym_ids:
            continue
        tokens[asym_list_idx] = ",".join(kept_asym_ids)
        filtered_rows.append(" ".join([str(token) for token in tokens]))
    return filtered_rows


def _write_mmcif_text_with_residue_filter(
    lines: list[str],
    output_path: Path,
    keep_residue: Callable[[str, int], bool],
    *,
    touched_chains: set[str],
    observed_residue_keys: set[tuple[str, int]],
    observed_chain_ids: set[str],
) -> tuple[int, list[str]]:
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
    _normalize_mmcif_filtered_metadata(output_path, kept_chain_ids)
    return len(kept_residue_keys), sorted(kept_chain_ids)


def _rewrite_structure_auth_indexing(structure_file: Path, output_path: Path) -> tuple[int, list[str]]:
    suffix = structure_file.suffix.lower()
    if suffix in {".cif", ".mmcif"}:
        return _rewrite_mmcif_auth_indexing(structure_file, output_path)
    try:
        return _rewrite_pdb_auth_indexing(structure_file, output_path)
    except ModuleNotFoundError:
        raise RuntimeError("Biopython is required to reset PDB auth indexing. Run `uv sync` in backend/ first.") from None


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
            if prefix == "_atom_site":
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


def _rewrite_mmcif_auth_indexing(structure_file: Path, output_path: Path) -> tuple[int, list[str]]:
    lines = structure_file.read_text().splitlines()
    observed_residue_keys, observed_chain_ids = _collect_mmcif_observed_residues(lines)
    return _rewrite_mmcif_auth_indexing_with_observed_filter(
        lines,
        output_path,
        observed_residue_keys=observed_residue_keys,
        observed_chain_ids=observed_chain_ids,
    )


def _rewrite_mmcif_auth_indexing_with_observed_filter(
    lines: list[str],
    output_path: Path,
    *,
    observed_residue_keys: set[tuple[str, int]],
    observed_chain_ids: set[str],
) -> tuple[int, list[str]]:
    output_lines: list[str] = []
    residue_count = 0
    residue_map_by_key: dict[MmcifResidueKey, int] = {}
    residue_map_by_chain_seq: dict[tuple[str, str], int] = {}

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
        emit_loop = True
        if columns:
            prefix = columns[0].split(".")[0]
            if prefix in {"_entity_poly", "_entity_poly_seq", "_struct_ref", "_struct_ref_seq"}:
                if index < len(lines) and lines[index].strip() == "#":
                    index += 1
                continue
            if prefix == "_atom_site":
                filtered_row_lines, residue_count, observed_chain_ids, residue_map_by_key, residue_map_by_chain_seq = _rewrite_mmcif_atom_site_rows(
                    columns,
                    row_lines,
                )
            elif prefix in {
                "_atom_site_anisotrop",
                "_pdbx_unobs_or_zero_occ_atoms",
                "_pdbx_unobs_or_zero_occ_residues",
                "_pdbx_poly_seq_scheme",
                "_struct_asym",
                "_struct_conf",
                "_struct_sheet_range",
                "_pdbx_struct_sheet_hbond",
            }:
                filtered_row_lines = _rewrite_mmcif_reset_associated_rows(
                    prefix,
                    columns,
                    row_lines,
                    residue_map_by_key=residue_map_by_key,
                    residue_map_by_chain_seq=residue_map_by_chain_seq,
                    observed_chain_ids=observed_chain_ids,
                )

            if not filtered_row_lines:
                emit_loop = False

        if not emit_loop:
            if index < len(lines) and lines[index].strip() == "#":
                index += 1
            continue

        output_lines.append(lines[loop_start])
        output_lines.extend(lines[loop_start + 1 : loop_start + 1 + len(columns)])
        output_lines.extend(filtered_row_lines)

        if index < len(lines) and lines[index].strip() == "#":
            output_lines.append(lines[index])
            index += 1

    if residue_count == 0:
        raise ValueError("The requested edit would remove every residue from the structure.")

    output_path.write_text("\n".join(output_lines) + "\n")
    return residue_count, sorted(observed_chain_ids)


def _rewrite_mmcif_atom_site_rows(
    columns: list[str],
    row_lines: list[str],
) -> tuple[list[str], int, set[str], dict[MmcifResidueKey, int], dict[tuple[str, str], int]]:
    try:
        label_asym_idx = columns.index("_atom_site.label_asym_id")
        label_seq_idx = columns.index("_atom_site.label_seq_id")
    except ValueError:
        return row_lines, 0, set(), {}, {}

    auth_asym_idx = columns.index("_atom_site.auth_asym_id") if "_atom_site.auth_asym_id" in columns else None
    auth_seq_idx = columns.index("_atom_site.auth_seq_id") if "_atom_site.auth_seq_id" in columns else None
    auth_comp_idx = columns.index("_atom_site.auth_comp_id") if "_atom_site.auth_comp_id" in columns else None
    auth_atom_idx = columns.index("_atom_site.auth_atom_id") if "_atom_site.auth_atom_id" in columns else None
    label_comp_idx = columns.index("_atom_site.label_comp_id") if "_atom_site.label_comp_id" in columns else None

    residue_map: dict[tuple[str, str, str], int] = {}
    next_label_seq_by_chain: dict[str, int] = defaultdict(int)
    observed_chain_ids: set[str] = set()
    filtered_rows: list[str] = []
    residue_map_by_key: dict[MmcifResidueKey, int] = {}
    residue_map_by_chain_seq: dict[tuple[str, str], int] = {}

    for row_line in row_lines:
        tokens = _tokenize_mmcif_row(row_line)
        if len(tokens) != len(columns):
            filtered_rows.append(row_line)
            continue
        chain_id = tokens[label_asym_idx]
        original_seq = tokens[auth_seq_idx] if auth_seq_idx is not None else tokens[label_seq_idx]
        label_seq = tokens[label_seq_idx]
        comp_id = tokens[label_comp_idx] if label_comp_idx is not None else tokens[auth_comp_idx] if auth_comp_idx is not None else "?"
        ins_code = "?"
        residue_key = (chain_id, original_seq, comp_id, ins_code)
        if residue_key not in residue_map:
            next_label_seq_by_chain[chain_id] += 1
            residue_map[residue_key] = next_label_seq_by_chain[chain_id]
        normalized_seq = residue_map[residue_key]
        residue_map_by_key[residue_key] = normalized_seq
        residue_map_by_chain_seq[(chain_id, original_seq)] = normalized_seq
        tokens[label_seq_idx] = str(normalized_seq)
        if auth_seq_idx is not None:
            tokens[auth_seq_idx] = str(normalized_seq)
        if auth_asym_idx is not None:
            tokens[auth_asym_idx] = chain_id
        if auth_comp_idx is not None and label_comp_idx is not None:
            tokens[auth_comp_idx] = tokens[label_comp_idx]
        if auth_atom_idx is not None and "_atom_site.label_atom_id" in columns:
            tokens[auth_atom_idx] = tokens[columns.index("_atom_site.label_atom_id")]
        filtered_rows.append(" ".join([str(t) for t in tokens]))
        observed_chain_ids.add(chain_id)

    return filtered_rows, len(residue_map), observed_chain_ids, residue_map_by_key, residue_map_by_chain_seq


def _rewrite_mmcif_reset_associated_rows(
    prefix: str,
    columns: list[str],
    row_lines: list[str],
    *,
    residue_map_by_key: dict[MmcifResidueKey, int],
    residue_map_by_chain_seq: dict[tuple[str, str], int],
    observed_chain_ids: set[str],
) -> list[str]:
    if prefix == "_struct_asym":
        filtered_rows: list[str] = []
        for row_line in row_lines:
            tokens = _tokenize_mmcif_row(row_line)
            if len(tokens) != len(columns):
                filtered_rows.append(row_line)
                continue
            chain_id = _first_existing_value(tokens, columns, ["_struct_asym.id"])
            if chain_id in observed_chain_ids:
                filtered_rows.append(row_line)
        return filtered_rows
    if prefix == "_pdbx_poly_seq_scheme":
        return _rewrite_single_residue_reference_rows(
            row_lines,
            columns,
            chain_candidates=["_pdbx_poly_seq_scheme.asym_id", "_pdbx_poly_seq_scheme.pdb_strand_id"],
            seq_candidates=["_pdbx_poly_seq_scheme.seq_id", "_pdbx_poly_seq_scheme.pdb_seq_num", "_pdbx_poly_seq_scheme.auth_seq_num"],
            comp_candidates=["_pdbx_poly_seq_scheme.mon_id", "_pdbx_poly_seq_scheme.pdb_mon_id", "_pdbx_poly_seq_scheme.auth_mon_id"],
            ins_candidates=["_pdbx_poly_seq_scheme.pdb_ins_code"],
            residue_map_by_key=residue_map_by_key,
            residue_map_by_chain_seq=residue_map_by_chain_seq,
            observed_chain_ids=observed_chain_ids,
        )
    if prefix in {"_pdbx_unobs_or_zero_occ_atoms", "_pdbx_unobs_or_zero_occ_residues", "_atom_site_anisotrop"}:
        if prefix in {"_pdbx_unobs_or_zero_occ_atoms", "_pdbx_unobs_or_zero_occ_residues"}:
            return []
        return _rewrite_single_residue_reference_rows(
            row_lines,
            columns,
            chain_candidates=[
                f"{prefix}.auth_asym_id",
                f"{prefix}.label_asym_id",
                f"{prefix}.pdbx_auth_asym_id",
                f"{prefix}.pdbx_label_asym_id",
            ],
            seq_candidates=[
                f"{prefix}.auth_seq_id",
                f"{prefix}.label_seq_id",
                f"{prefix}.pdbx_auth_seq_id",
                f"{prefix}.pdbx_label_seq_id",
            ],
            comp_candidates=[
                f"{prefix}.auth_comp_id",
                f"{prefix}.label_comp_id",
            ],
            ins_candidates=[
                f"{prefix}.PDB_ins_code",
                f"{prefix}.pdbx_PDB_ins_code",
            ],
            residue_map_by_key=residue_map_by_key,
            residue_map_by_chain_seq=residue_map_by_chain_seq,
            observed_chain_ids=observed_chain_ids,
        )
    if prefix in {"_struct_conf", "_struct_sheet_range"}:
        return _rewrite_dual_residue_reference_rows(
            row_lines,
            columns,
            first_chain_candidates=[f"{prefix}.beg_label_asym_id", f"{prefix}.beg_auth_asym_id"],
            first_seq_candidates=[f"{prefix}.beg_label_seq_id", f"{prefix}.beg_auth_seq_id"],
            first_comp_candidates=[f"{prefix}.beg_label_comp_id", f"{prefix}.beg_auth_comp_id"],
            first_ins_candidates=[f"{prefix}.pdbx_beg_PDB_ins_code"],
            second_chain_candidates=[f"{prefix}.end_label_asym_id", f"{prefix}.end_auth_asym_id"],
            second_seq_candidates=[f"{prefix}.end_label_seq_id", f"{prefix}.end_auth_seq_id"],
            second_comp_candidates=[f"{prefix}.end_label_comp_id", f"{prefix}.end_auth_comp_id"],
            second_ins_candidates=[f"{prefix}.pdbx_end_PDB_ins_code"],
            residue_map_by_key=residue_map_by_key,
            residue_map_by_chain_seq=residue_map_by_chain_seq,
            observed_chain_ids=observed_chain_ids,
        )
    if prefix == "_pdbx_struct_sheet_hbond":
        return _rewrite_dual_residue_reference_rows(
            row_lines,
            columns,
            first_chain_candidates=[f"{prefix}.range_1_label_asym_id", f"{prefix}.range_1_auth_asym_id"],
            first_seq_candidates=[f"{prefix}.range_1_label_seq_id", f"{prefix}.range_1_auth_seq_id"],
            first_comp_candidates=[f"{prefix}.range_1_label_comp_id", f"{prefix}.range_1_auth_comp_id"],
            first_ins_candidates=[f"{prefix}.range_1_PDB_ins_code"],
            second_chain_candidates=[f"{prefix}.range_2_label_asym_id", f"{prefix}.range_2_auth_asym_id"],
            second_seq_candidates=[f"{prefix}.range_2_label_seq_id", f"{prefix}.range_2_auth_seq_id"],
            second_comp_candidates=[f"{prefix}.range_2_label_comp_id", f"{prefix}.range_2_auth_comp_id"],
            second_ins_candidates=[f"{prefix}.range_2_PDB_ins_code"],
            residue_map_by_key=residue_map_by_key,
            residue_map_by_chain_seq=residue_map_by_chain_seq,
            observed_chain_ids=observed_chain_ids,
        )
    return row_lines


def _first_existing_value(tokens: list[str], columns: list[str], candidates: list[str]) -> str:
    for name in candidates:
        if name in columns:
            return tokens[columns.index(name)]
    return ""


def _map_residue_reference(
    tokens: list[str],
    columns: list[str],
    *,
    chain_candidates: list[str],
    seq_candidates: list[str],
    comp_candidates: list[str],
    ins_candidates: list[str],
    residue_map_by_key: dict[MmcifResidueKey, int],
    residue_map_by_chain_seq: dict[tuple[str, str], int],
) -> tuple[str, str, str, str, int] | None:
    chain_id = _first_existing_value(tokens, columns, chain_candidates)
    seq_value = _first_existing_value(tokens, columns, seq_candidates)
    comp_value = _first_existing_value(tokens, columns, comp_candidates) if comp_candidates else "?"
    ins_value = _first_existing_value(tokens, columns, ins_candidates) if ins_candidates else "?"
    if not chain_id or not seq_value:
        return None
    residue_key = (chain_id, seq_value, comp_value or "?", ins_value or "?")
    normalized_seq = residue_map_by_key.get(residue_key)
    if normalized_seq is None:
        normalized_seq = residue_map_by_chain_seq.get((chain_id, seq_value))
    if normalized_seq is None:
        return None
    return chain_id, seq_value, comp_value or "?", ins_value or "?", normalized_seq


def _rewrite_single_residue_reference_rows(
    row_lines: list[str],
    columns: list[str],
    *,
    chain_candidates: list[str],
    seq_candidates: list[str],
    comp_candidates: list[str],
    ins_candidates: list[str],
    residue_map_by_key: dict[MmcifResidueKey, int],
    residue_map_by_chain_seq: dict[tuple[str, str], int],
    observed_chain_ids: set[str],
) -> list[str]:
    filtered_rows: list[str] = []
    for row_line in row_lines:
        tokens = _tokenize_mmcif_row(row_line)
        if len(tokens) != len(columns):
            filtered_rows.append(row_line)
            continue
        mapped = _map_residue_reference(
            tokens,
            columns,
            chain_candidates=chain_candidates,
            seq_candidates=seq_candidates,
            comp_candidates=comp_candidates,
            ins_candidates=ins_candidates,
            residue_map_by_key=residue_map_by_key,
            residue_map_by_chain_seq=residue_map_by_chain_seq,
        )
        if mapped is None:
            continue
        chain_id, _original_seq, comp_value, ins_value, normalized_seq = mapped
        _set_existing_value(tokens, columns, chain_candidates, chain_id)
        _set_existing_value(tokens, columns, seq_candidates, str(normalized_seq))
        if comp_candidates:
            _set_existing_value(tokens, columns, comp_candidates, comp_value)
        if ins_candidates:
            _set_existing_value(tokens, columns, ins_candidates, ins_value)
        if chain_id in observed_chain_ids:
            filtered_rows.append(" ".join([str(t) for t in tokens]))
    return filtered_rows


def _rewrite_dual_residue_reference_rows(
    row_lines: list[str],
    columns: list[str],
    *,
    first_chain_candidates: list[str],
    first_seq_candidates: list[str],
    first_comp_candidates: list[str],
    first_ins_candidates: list[str],
    second_chain_candidates: list[str],
    second_seq_candidates: list[str],
    second_comp_candidates: list[str],
    second_ins_candidates: list[str],
    residue_map_by_key: dict[MmcifResidueKey, int],
    residue_map_by_chain_seq: dict[tuple[str, str], int],
    observed_chain_ids: set[str],
) -> list[str]:
    filtered_rows: list[str] = []
    for row_line in row_lines:
        tokens = _tokenize_mmcif_row(row_line)
        if len(tokens) != len(columns):
            filtered_rows.append(row_line)
            continue

        first = _map_residue_reference(
            tokens,
            columns,
            chain_candidates=first_chain_candidates,
            seq_candidates=first_seq_candidates,
            comp_candidates=first_comp_candidates,
            ins_candidates=first_ins_candidates,
            residue_map_by_key=residue_map_by_key,
            residue_map_by_chain_seq=residue_map_by_chain_seq,
        )
        second = _map_residue_reference(
            tokens,
            columns,
            chain_candidates=second_chain_candidates,
            seq_candidates=second_seq_candidates,
            comp_candidates=second_comp_candidates,
            ins_candidates=second_ins_candidates,
            residue_map_by_key=residue_map_by_key,
            residue_map_by_chain_seq=residue_map_by_chain_seq,
        )
        if first is None or second is None:
            continue
        first_chain, _first_seq, first_comp, first_ins, first_normalized = first
        second_chain, _second_seq, second_comp, second_ins, second_normalized = second
        _set_existing_value(tokens, columns, first_chain_candidates, first_chain)
        _set_existing_value(tokens, columns, first_seq_candidates, str(first_normalized))
        _set_existing_value(tokens, columns, first_comp_candidates, first_comp)
        _set_existing_value(tokens, columns, first_ins_candidates, first_ins)
        _set_existing_value(tokens, columns, second_chain_candidates, second_chain)
        _set_existing_value(tokens, columns, second_seq_candidates, str(second_normalized))
        _set_existing_value(tokens, columns, second_comp_candidates, second_comp)
        _set_existing_value(tokens, columns, second_ins_candidates, second_ins)
        if first_chain in observed_chain_ids and second_chain in observed_chain_ids:
            filtered_rows.append(" ".join([str(t) for t in tokens]))
    return filtered_rows


def _set_existing_value(tokens: list[str], columns: list[str], candidates: list[str], value: str) -> None:
    for name in candidates:
        if name in columns:
            tokens[columns.index(name)] = value
            return


def _rewrite_pdb_auth_indexing(structure_file: Path, output_path: Path) -> tuple[int, list[str]]:
    lines = structure_file.read_text().splitlines()
    residue_map: dict[tuple[str, str, str], int] = {}
    next_seq_by_chain: dict[str, int] = defaultdict(int)
    kept_chain_ids: set[str] = set()
    kept_residue_keys: set[tuple[str, str, str]] = set()
    output_lines: list[str] = []

    for line in lines:
        record = line[:6].strip()
        if record in {"ATOM", "HETATM", "ANISOU"}:
            chain_id = line[21].strip() or " "
            residue_number = line[22:26].strip()
            insertion_code = line[26].strip()
            residue_key = (chain_id, residue_number, insertion_code)
            if residue_key not in residue_map:
                next_seq_by_chain[chain_id] += 1
                residue_map[residue_key] = next_seq_by_chain[chain_id]
            normalized_seq = residue_map[residue_key]
            rewritten = f"{line[:22]}{normalized_seq:>4}{line[26:]}"
            output_lines.append(rewritten)
            kept_chain_ids.add(chain_id)
            kept_residue_keys.add(residue_key)
            continue
        output_lines.append(line)

    if not kept_residue_keys:
        raise ValueError("The requested edit would remove every residue from the structure.")

    if not any(line.startswith("END") for line in output_lines):
        output_lines.append("END")
    output_path.write_text("\n".join(output_lines) + "\n")
    return len(kept_residue_keys), sorted(kept_chain_ids)
