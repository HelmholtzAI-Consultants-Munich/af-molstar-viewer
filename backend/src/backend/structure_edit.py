from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
from typing import Any, Callable, NamedTuple

from .selection import ResidueRange

MmcifResidueKey = tuple[str, str, str, str]

_MMCIF_MONOMER_CODES = {
    "ALA": "A",
    "ARG": "R",
    "ASN": "N",
    "ASP": "D",
    "CYS": "C",
    "GLN": "Q",
    "GLU": "E",
    "GLY": "G",
    "HIS": "H",
    "ILE": "I",
    "LEU": "L",
    "LYS": "K",
    "MET": "M",
    "PHE": "F",
    "PRO": "P",
    "SER": "S",
    "THR": "T",
    "TRP": "W",
    "TYR": "Y",
    "VAL": "V",
    "SEC": "U",
    "PYL": "O",
    "A": "A",
    "C": "C",
    "G": "G",
    "U": "U",
    "T": "T",
    "DA": "A",
    "DC": "C",
    "DG": "G",
    "DT": "T",
    "DU": "U",
}


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


_MMCIF_SECONDARY_STRUCTURE_PREFIXES = {
    "_struct_conf",
    "_struct_sheet_range",
    "_pdbx_struct_sheet_hbond",
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
        if structure_file.suffix.lower() not in {".pdb", ".ent"}:
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
        _normalize_mmcif_label_seq_ids(output_path)
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
    residues_by_chain: dict[str, list[dict[str, str]]] = defaultdict(list)
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
                if (chain_id, residue_number, insertion_code) not in kept_residue_keys:
                    residues_by_chain[chain_id].append(
                        {
                            "seq": line[22:26].strip(),
                            "ins": insertion_code,
                            "chain": chain_id,
                            "comp": line[17:20].strip(),
                            "new_seq": line[22:26].strip(),
                        }
                    )
                kept_residue_keys.add((chain_id, residue_number, insertion_code))
                kept_chain_ids.add(chain_id)
            continue
        if record == "TER":
            continue
        filtered_lines.append(line)

    if not kept_residue_keys:
        raise ValueError("The requested edit would remove every residue from the structure.")

    filtered_lines = _rewrite_pdb_secondary_structure_lines(filtered_lines, residues_by_chain)

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


def _normalize_mmcif_label_seq_ids(path: Path) -> None:
    lines = path.read_text().splitlines()

    atom_site_columns: list[str] = []
    atom_site_row_indices: list[int] = []
    atom_site_start = None

    index = 0
    while index < len(lines):
        if lines[index].strip() != "loop_":
            index += 1
            continue

        loop_start = index
        index += 1
        columns: list[str] = []
        while index < len(lines) and lines[index].strip().startswith("_"):
            columns.append(lines[index].strip())
            index += 1

        row_indices: list[int] = []
        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped or stripped == "#" or stripped == "loop_" or stripped.startswith("_") or stripped.startswith("data_"):
                break
            row_indices.append(index)
            index += 1

        if columns and columns[0].startswith("_atom_site."):
            atom_site_start = loop_start
            atom_site_columns = columns
            atom_site_row_indices = row_indices
            break

    if atom_site_start is None or not atom_site_row_indices:
        return

    try:
        label_asym_idx = atom_site_columns.index("_atom_site.label_asym_id")
        label_seq_idx = atom_site_columns.index("_atom_site.label_seq_id")
    except ValueError:
        return

    auth_seq_idx = atom_site_columns.index("_atom_site.auth_seq_id") if "_atom_site.auth_seq_id" in atom_site_columns else None
    auth_comp_idx = atom_site_columns.index("_atom_site.auth_comp_id") if "_atom_site.auth_comp_id" in atom_site_columns else None
    label_comp_idx = atom_site_columns.index("_atom_site.label_comp_id") if "_atom_site.label_comp_id" in atom_site_columns else None
    ins_code_idx = atom_site_columns.index("_atom_site.pdbx_PDB_ins_code") if "_atom_site.pdbx_PDB_ins_code" in atom_site_columns else None

    next_label_seq_by_chain: dict[str, int] = {}
    label_seq_by_residue: dict[MmcifResidueKey, int] = {}
    label_seq_by_chain_seq: dict[tuple[str, str], int] = {}
    residues_by_chain: dict[str, list[dict[str, str]]] = defaultdict(list)
    observed_chain_ids: set[str] = set()

    for row_index in atom_site_row_indices:
        tokens = _tokenize_mmcif_row(lines[row_index])
        if len(tokens) != len(atom_site_columns):
            continue

        chain_id = tokens[label_asym_idx]
        label_seq = tokens[label_seq_idx]
        auth_seq = tokens[auth_seq_idx] if auth_seq_idx is not None else label_seq
        comp_id = tokens[auth_comp_idx] if auth_comp_idx is not None else (
            tokens[label_comp_idx] if label_comp_idx is not None else "?"
        )
        ins_code = tokens[ins_code_idx] if ins_code_idx is not None else "?"
        normalized_ins_code = "?" if ins_code in {"", ".", "?"} else ins_code
        residue_key = (chain_id, label_seq, comp_id, normalized_ins_code)

        if residue_key not in label_seq_by_residue:
            next_label_seq = next_label_seq_by_chain.get(chain_id, 0) + 1
            next_label_seq_by_chain[chain_id] = next_label_seq
            label_seq_by_residue[residue_key] = next_label_seq
            label_seq_by_chain_seq[(chain_id, label_seq)] = next_label_seq
            residues_by_chain[chain_id].append(
                {
                    "label_seq": label_seq,
                    "auth_seq": auth_seq,
                    "new_label_seq": str(next_label_seq),
                    "new_auth_seq": auth_seq,
                    "label_comp": tokens[label_comp_idx] if label_comp_idx is not None else comp_id,
                    "auth_comp": tokens[auth_comp_idx] if auth_comp_idx is not None else comp_id,
                    "ins_code": normalized_ins_code,
                }
            )

        tokens[label_seq_idx] = str(label_seq_by_residue[residue_key])
        lines[row_index] = " ".join(tokens)
        observed_chain_ids.add(chain_id)

    output_lines: list[str] = []
    index = 0
    while index < len(lines):
        if lines[index].strip() != "loop_":
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
            stripped = lines[index].strip()
            if not stripped or stripped == "#" or stripped == "loop_" or stripped.startswith("_") or stripped.startswith("data_"):
                break
            row_lines.append(lines[index])
            index += 1

        rewritten_rows = row_lines
        if columns:
            prefix = columns[0].split(".")[0]
            if prefix in {"_atom_site_anisotrop", "_ma_qa_metric_local"}:
                rewritten_rows = _rewrite_single_residue_reference_rows(
                    row_lines,
                    columns,
                    chain_candidates=[
                        f"{prefix}.label_asym_id",
                        f"{prefix}.pdbx_label_asym_id",
                    ],
                    seq_candidates=[
                        f"{prefix}.label_seq_id",
                        f"{prefix}.pdbx_label_seq_id",
                    ],
                    comp_candidates=[f"{prefix}.label_comp_id"],
                    ins_candidates=[
                        f"{prefix}.PDB_ins_code",
                        f"{prefix}.pdbx_PDB_ins_code",
                    ],
                    residue_map_by_key=label_seq_by_residue,
                    residue_map_by_chain_seq=label_seq_by_chain_seq,
                    observed_chain_ids=observed_chain_ids,
                )
            elif prefix in _MMCIF_SECONDARY_STRUCTURE_PREFIXES:
                rewritten_rows = _rewrite_mmcif_secondary_structure_rows(
                    prefix,
                    columns,
                    row_lines,
                    residues_by_chain,
                )

        if columns and row_lines and not rewritten_rows:
            # An empty loop_ is invalid mmCIF, so drop the whole category.
            if index < len(lines) and lines[index].strip() == "#":
                index += 1
            continue

        output_lines.append(lines[loop_start])
        output_lines.extend(lines[loop_start + 1 : loop_start + 1 + len(columns)])
        output_lines.extend(rewritten_rows)

        if index < len(lines) and lines[index].strip() == "#":
            output_lines.append(lines[index])
            index += 1

    path.write_text("\n".join(output_lines) + "\n")


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
        auth_seq_by_label=_collect_mmcif_auth_seq_by_label(lines),
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
            if prefix == "_entity_poly":
                filtered_row_lines = _rewrite_mmcif_entity_poly_rows(
                    columns,
                    row_lines,
                    atom_residues,
                    chain_entity_ids,
                    kept_chain_ids,
                )
            elif prefix == "_entity_poly_seq":
                filtered_row_lines = _rewrite_mmcif_entity_poly_seq_rows(columns, atom_residues, chain_entity_ids, kept_chain_ids)
            elif prefix in {"_struct_ref", "_struct_ref_seq"}:
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


def _rewrite_mmcif_entity_poly_rows(
    columns: list[str],
    row_lines: list[str],
    atom_residues: list[dict[str, str]],
    chain_entity_ids: dict[str, str],
    kept_chain_ids: set[str],
) -> list[str]:
    entity_index = columns.index("_entity_poly.entity_id") if "_entity_poly.entity_id" in columns else None
    strand_index = columns.index("_entity_poly.pdbx_strand_id") if "_entity_poly.pdbx_strand_id" in columns else None
    if entity_index is None:
        return row_lines

    kept_entity_ids = {chain_entity_ids.get(chain_id) for chain_id in kept_chain_ids}
    kept_entity_ids.discard(None)
    if not kept_entity_ids:
        return []

    entity_chain_ids: dict[str, list[str]] = defaultdict(list)
    entity_sequences: dict[str, list[str]] = defaultdict(list)
    primary_chain_by_entity: dict[str, str] = {}
    for residue in atom_residues:
        chain_id = residue["chain_id"]
        if chain_id not in kept_chain_ids:
            continue
        entity_id = chain_entity_ids.get(chain_id, "1")
        if chain_id not in entity_chain_ids[entity_id]:
            entity_chain_ids[entity_id].append(chain_id)
        primary_chain = primary_chain_by_entity.setdefault(entity_id, chain_id)
        if chain_id == primary_chain:
            entity_sequences[entity_id].append(_mmcif_monomer_code(residue["comp_id"]))

    rows: list[str] = []
    for entity_id in sorted(kept_entity_ids, key=lambda value: int(value) if value.isdigit() else value):
        sequence = "".join(entity_sequences.get(entity_id, [])) or "?"
        column_values = {column: "?" for column in columns}
        for column in columns:
            if column == "_entity_poly.entity_id":
                column_values[column] = entity_id
            elif column == "_entity_poly.type":
                column_values[column] = "polypeptide(L)"
            elif column in {"_entity_poly.nstd_linkage", "_entity_poly.nstd_monomer"}:
                column_values[column] = "no"
            elif column in {"_entity_poly.pdbx_seq_one_letter_code", "_entity_poly.pdbx_seq_one_letter_code_can"}:
                column_values[column] = sequence
            elif column == "_entity_poly.pdbx_strand_id":
                column_values[column] = ",".join(entity_chain_ids.get(entity_id, [])) or "?"
        rows.append(" ".join(column_values[column] for column in columns))
    return rows


def _mmcif_monomer_code(comp_id: str) -> str:
    return _MMCIF_MONOMER_CODES.get(comp_id.strip().upper(), "X")


def _rewrite_mmcif_entity_poly_seq_rows(
    columns: list[str],
    atom_residues: list[dict[str, str]],
    chain_entity_ids: dict[str, str],
    kept_chain_ids: set[str],
) -> list[str]:
    if not atom_residues:
        return []

    entity_index = columns.index("_entity_poly_seq.entity_id") if "_entity_poly_seq.entity_id" in columns else None
    num_index = columns.index("_entity_poly_seq.num") if "_entity_poly_seq.num" in columns else None
    mon_index = columns.index("_entity_poly_seq.mon_id") if "_entity_poly_seq.mon_id" in columns else None
    if entity_index is None or num_index is None or mon_index is None:
        return []

    entity_seq_counts: dict[str, int] = defaultdict(int)
    rows: list[str] = []
    for residue in atom_residues:
        chain_id = residue["chain_id"]
        if chain_id not in kept_chain_ids:
            continue
        entity_id = chain_entity_ids.get(chain_id, "1")
        entity_seq_counts[entity_id] += 1
        column_values = {column: "?" for column in columns}
        for column in columns:
            if column == "_entity_poly_seq.entity_id":
                column_values[column] = entity_id
            elif column == "_entity_poly_seq.num":
                column_values[column] = str(entity_seq_counts[entity_id])
            elif column == "_entity_poly_seq.mon_id":
                column_values[column] = residue["comp_id"]
            elif column == "_entity_poly_seq.hetero":
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
    auth_seq_by_label: dict[tuple[str, str], int],
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
                "_ma_qa_metric_local",
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
                    auth_seq_by_label=auth_seq_by_label,
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
    _normalize_mmcif_label_seq_ids(output_path)
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
    auth_seq_by_label: dict[tuple[str, str], int],
) -> tuple[list[str], set[tuple[str, int]], set[str]]:
    filtered_rows: list[str] = []
    kept_residue_keys: set[tuple[str, int]] = set()
    kept_chain_ids: set[str] = set()

    chain_column_names = [
        "_atom_site.auth_asym_id",
        "_atom_site.label_asym_id",
        "_atom_site_anisotrop.pdbx_auth_asym_id",
        "_atom_site_anisotrop.pdbx_label_asym_id",
        "_ma_qa_metric_local.auth_asym_id",
        "_ma_qa_metric_local.label_asym_id",
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
        "_ma_qa_metric_local.auth_seq_id",
        "_ma_qa_metric_local.label_seq_id",
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

    seq_is_label = columns[seq_index].endswith(("label_seq_id", ".seq_id"))

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

        if seq_is_label:
            # The selection is in auth numbering; a label_seq_id only matches it
            # by accident, and stops matching once the structure has been edited.
            residue_number = auth_seq_by_label.get((chain_id, residue_number_token), residue_number)

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


def _find_mmcif_loop(lines: list[str], prefix: str) -> tuple[list[str], list[str]]:
    """Return the column names and row lines of the first loop_ for `prefix`."""
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

        if columns and columns[0].split(".")[0] == prefix:
            return columns, row_lines

    return [], []


def _collect_mmcif_auth_seq_by_label(lines: list[str]) -> dict[tuple[str, str], int]:
    """Map (label_asym_id, label_seq_id) onto auth_seq_id from `_atom_site`.

    Categories such as `_ma_qa_metric_local` carry only label numbering, while a
    residue selection is expressed in auth numbering. The two agree in a fresh
    AlphaFold model but drift apart as soon as the structure has been edited
    once, so a label_seq_id has to be translated before it can be selected on.
    """
    columns, row_lines = _find_mmcif_loop(lines, "_atom_site")
    try:
        label_asym_idx = columns.index("_atom_site.label_asym_id")
        label_seq_idx = columns.index("_atom_site.label_seq_id")
        auth_seq_idx = columns.index("_atom_site.auth_seq_id")
    except ValueError:
        return {}

    auth_seq_by_label: dict[tuple[str, str], int] = {}
    for row_line in row_lines:
        tokens = _tokenize_mmcif_row(row_line)
        if len(tokens) != len(columns):
            continue
        auth_seq = _optional_int(tokens[auth_seq_idx])
        if auth_seq is not None:
            auth_seq_by_label.setdefault((tokens[label_asym_idx], tokens[label_seq_idx]), auth_seq)
    return auth_seq_by_label


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
    return _rewrite_mmcif_auth_indexing_lines(structure_file.read_text().splitlines(), output_path)


def _rewrite_mmcif_auth_indexing_lines(
    lines: list[str],
    output_path: Path,
) -> tuple[int, list[str]]:
    output_lines: list[str] = []
    atom_residues, _ = _collect_mmcif_atom_residues_and_entities(lines)

    # `_atom_site` sits at the end of an mmCIF file, but the categories that
    # reference it (notably `_struct_conf`) come first, so work out the new
    # numbering up front instead of while walking the loops in file order.
    atom_site_columns, atom_site_row_lines = _find_mmcif_loop(lines, "_atom_site")
    (
        rewritten_atom_site_rows,
        residue_count,
        observed_chain_ids,
        residue_map_by_key,
        residue_map_by_chain_seq,
        residues_by_chain,
    ) = _rewrite_mmcif_atom_site_rows(atom_site_columns, atom_site_row_lines)

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
            if prefix in {"_struct_ref", "_struct_ref_seq"}:
                if index < len(lines) and lines[index].strip() == "#":
                    index += 1
                continue
            if prefix == "_atom_site":
                filtered_row_lines = rewritten_atom_site_rows
            elif prefix in _MMCIF_SECONDARY_STRUCTURE_PREFIXES:
                filtered_row_lines = _rewrite_mmcif_secondary_structure_rows(
                    prefix,
                    columns,
                    row_lines,
                    residues_by_chain,
                )
            elif prefix in {
                "_atom_site_anisotrop",
                "_ma_qa_metric_local",
                "_pdbx_unobs_or_zero_occ_atoms",
                "_pdbx_unobs_or_zero_occ_residues",
                "_pdbx_poly_seq_scheme",
                "_struct_asym",
            }:
                filtered_row_lines = _rewrite_mmcif_reset_associated_rows(
                    prefix,
                    columns,
                    row_lines,
                    residue_map_by_key=residue_map_by_key,
                    residue_map_by_chain_seq=residue_map_by_chain_seq,
                    observed_chain_ids=observed_chain_ids,
                    atom_residues=atom_residues,
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
    _normalize_mmcif_filtered_metadata(output_path, observed_chain_ids)
    return residue_count, sorted(observed_chain_ids)


def _rewrite_mmcif_atom_site_rows(
    columns: list[str],
    row_lines: list[str],
) -> tuple[
    list[str],
    int,
    set[str],
    dict[MmcifResidueKey, int],
    dict[tuple[str, str], int],
    dict[str, list[dict[str, str]]],
]:
    try:
        label_asym_idx = columns.index("_atom_site.label_asym_id")
        label_seq_idx = columns.index("_atom_site.label_seq_id")
    except ValueError:
        return row_lines, 0, set(), {}, {}, {}

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
    residues_by_chain: dict[str, list[dict[str, str]]] = defaultdict(list)

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
            residues_by_chain[chain_id].append(
                {
                    "label_seq": label_seq,
                    "auth_seq": original_seq,
                    "new_label_seq": str(residue_map[residue_key]),
                    "new_auth_seq": str(residue_map[residue_key]),
                    "label_comp": comp_id,
                    "auth_comp": comp_id,
                    "ins_code": ins_code,
                }
            )
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

    return (
        filtered_rows,
        len(residue_map),
        observed_chain_ids,
        residue_map_by_key,
        residue_map_by_chain_seq,
        residues_by_chain,
    )


def _rewrite_mmcif_reset_associated_rows(
    prefix: str,
    columns: list[str],
    row_lines: list[str],
    *,
    residue_map_by_key: dict[MmcifResidueKey, int],
    residue_map_by_chain_seq: dict[tuple[str, str], int],
    observed_chain_ids: set[str],
    atom_residues: list[dict[str, str]],
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
        return _rewrite_poly_seq_scheme_reset_rows(row_lines, columns, atom_residues, observed_chain_ids)
    if prefix in {"_pdbx_unobs_or_zero_occ_atoms", "_pdbx_unobs_or_zero_occ_residues", "_atom_site_anisotrop", "_ma_qa_metric_local"}:
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
    return row_lines


def _rewrite_poly_seq_scheme_reset_rows(
    row_lines: list[str],
    columns: list[str],
    atom_residues: list[dict[str, str]],
    observed_chain_ids: set[str],
) -> list[str]:
    chain_candidates = ["_pdbx_poly_seq_scheme.asym_id", "_pdbx_poly_seq_scheme.pdb_strand_id"]
    seq_candidates = ["_pdbx_poly_seq_scheme.seq_id", "_pdbx_poly_seq_scheme.pdb_seq_num", "_pdbx_poly_seq_scheme.auth_seq_num"]
    comp_candidates = ["_pdbx_poly_seq_scheme.mon_id", "_pdbx_poly_seq_scheme.pdb_mon_id", "_pdbx_poly_seq_scheme.auth_mon_id"]
    ins_candidates = ["_pdbx_poly_seq_scheme.pdb_ins_code"]

    expected_by_chain: dict[str, list[str]] = defaultdict(list)
    for residue in atom_residues:
        expected_by_chain[residue["chain_id"]].append(residue["comp_id"])

    next_seq_by_chain: dict[str, int] = defaultdict(int)
    matched_index_by_chain: dict[str, int] = defaultdict(int)
    filtered_rows: list[str] = []
    for row_line in row_lines:
        tokens = _tokenize_mmcif_row(row_line)
        if len(tokens) != len(columns):
            filtered_rows.append(row_line)
            continue

        chain_id = _first_existing_value(tokens, columns, chain_candidates)
        if chain_id not in observed_chain_ids:
            continue

        comp_value = _first_existing_value(tokens, columns, comp_candidates)
        expected_comp_ids = expected_by_chain.get(chain_id, [])
        cursor = matched_index_by_chain[chain_id]
        while cursor < len(expected_comp_ids) and expected_comp_ids[cursor] != comp_value:
            cursor += 1
        if cursor >= len(expected_comp_ids):
            continue

        matched_index_by_chain[chain_id] = cursor + 1
        next_seq_by_chain[chain_id] += 1
        normalized_seq = str(next_seq_by_chain[chain_id])
        _set_existing_value(tokens, columns, chain_candidates, chain_id)
        _set_existing_value(tokens, columns, seq_candidates, normalized_seq)
        _set_existing_value(tokens, columns, comp_candidates, comp_value)
        _set_existing_value(tokens, columns, ins_candidates, ".")
        filtered_rows.append(" ".join([str(token) for token in tokens]))

    return filtered_rows


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
    allow_comp_fallback: bool,
) -> tuple[str, str, str, str, int] | None:
    chain_id = _first_existing_value(tokens, columns, chain_candidates)
    seq_value = _first_existing_value(tokens, columns, seq_candidates)
    comp_value = _first_existing_value(tokens, columns, comp_candidates) if comp_candidates else "?"
    ins_value = _first_existing_value(tokens, columns, ins_candidates) if ins_candidates else "?"
    if not chain_id or not seq_value:
        return None
    normalized_ins_value = "?" if ins_value in {"", ".", "?"} else ins_value
    residue_key = (chain_id, seq_value, comp_value or "?", normalized_ins_value)
    normalized_seq = residue_map_by_key.get(residue_key)
    if normalized_seq is None:
        normalized_seq = residue_map_by_chain_seq.get((chain_id, seq_value))
    if normalized_seq is None and allow_comp_fallback and comp_value:
        matches = {
            mapped_seq
            for (mapped_chain, _mapped_seq, mapped_comp, mapped_ins), mapped_seq in residue_map_by_key.items()
            if mapped_chain == chain_id and mapped_comp == comp_value and mapped_ins == normalized_ins_value
        }
        if len(matches) == 1:
            normalized_seq = matches.pop()
    if normalized_seq is None:
        # The residue this row annotates is gone, so the row goes with it.
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
    rows = _map_single_residue_reference_rows(
        row_lines,
        columns,
        chain_candidates=chain_candidates,
        seq_candidates=seq_candidates,
        comp_candidates=comp_candidates,
        ins_candidates=ins_candidates,
        residue_map_by_key=residue_map_by_key,
        residue_map_by_chain_seq=residue_map_by_chain_seq,
        observed_chain_ids=observed_chain_ids,
        allow_comp_fallback=False,
    )
    if row_lines and not rows:
        # Nothing matched on sequence numbers, so this category was never on the
        # same numbering as atom_site. Residue names are all that is left.
        rows = _map_single_residue_reference_rows(
            row_lines,
            columns,
            chain_candidates=chain_candidates,
            seq_candidates=seq_candidates,
            comp_candidates=comp_candidates,
            ins_candidates=ins_candidates,
            residue_map_by_key=residue_map_by_key,
            residue_map_by_chain_seq=residue_map_by_chain_seq,
            observed_chain_ids=observed_chain_ids,
            allow_comp_fallback=True,
        )
    return rows


def _map_single_residue_reference_rows(
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
    allow_comp_fallback: bool,
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
            allow_comp_fallback=allow_comp_fallback,
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
    residues_by_chain: dict[str, list[dict[str, str]]] = defaultdict(list)
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
                residues_by_chain[chain_id].append(
                    {
                        "seq": residue_number,
                        "ins": insertion_code,
                        "chain": chain_id,
                        "comp": line[17:20].strip(),
                        "new_seq": str(residue_map[residue_key]),
                    }
                )
            normalized_seq = residue_map[residue_key]
            rewritten = f"{line[:22]}{normalized_seq:>4}{line[26:]}"
            output_lines.append(rewritten)
            kept_chain_ids.add(chain_id)
            kept_residue_keys.add(residue_key)
            continue
        output_lines.append(line)

    if not kept_residue_keys:
        raise ValueError("The requested edit would remove every residue from the structure.")

    # HELIX/SHEET records sit ahead of the coordinates, so they are remapped
    # once the whole chain has been seen.
    output_lines = _rewrite_pdb_secondary_structure_lines(output_lines, residues_by_chain)

    if not any(line.startswith("END") for line in output_lines):
        output_lines.append("END")
    output_path.write_text("\n".join(output_lines) + "\n")
    return len(kept_residue_keys), sorted(kept_chain_ids)


def _mmcif_endpoint_columns(prefix: str, stem: str) -> dict[str, list[str]]:
    return {
        "chain": [f"{prefix}.{stem}_label_asym_id", f"{prefix}.{stem}_auth_asym_id"],
        "label_seq": [f"{prefix}.{stem}_label_seq_id"],
        "auth_seq": [f"{prefix}.{stem}_auth_seq_id"],
        "label_comp": [f"{prefix}.{stem}_label_comp_id"],
        "auth_comp": [f"{prefix}.{stem}_auth_comp_id"],
        "ins_code": [f"{prefix}.pdbx_{stem}_PDB_ins_code", f"{prefix}.{stem}_PDB_ins_code"],
    }


def _optional_int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _locate_mmcif_residue_by_comp(chain_residues: list[dict[str, str]], comp_value: str, field: str) -> int | None:
    """Match on residue name, but only where that names exactly one residue."""
    if not comp_value or comp_value in {".", "?"}:
        return None
    matches = [position for position, residue in enumerate(chain_residues) if residue[field] == comp_value]
    return matches[0] if len(matches) == 1 else None


def _normalized_ins_code(value: str) -> str:
    return "" if value.strip() in {"", ".", "?"} else value.strip()


def _residue_span_positions(
    residues: list[dict[str, str]],
    beg_seq: str,
    beg_ins: str,
    end_seq: str,
    end_ins: str,
) -> tuple[int, int] | None:
    """Locate [beg, end] among the residues that are actually present.

    `residues` is in file order, so positions are what the rewritten numbering
    is built from; this never does arithmetic on the original numbers, which is
    what makes it safe across gaps such as a chain running 6-42 then 52-138.
    """
    beg_position = _locate_residue(residues, beg_seq, beg_ins)
    end_position = _locate_residue(residues, end_seq, end_ins)
    if beg_position is not None and end_position is not None:
        return (beg_position, end_position) if beg_position <= end_position else (end_position, beg_position)

    # An endpoint is missing, either cut away or never observed: keep whatever
    # part of the range is still there.
    beg_number = _optional_int(beg_seq)
    end_number = _optional_int(end_seq)
    if beg_number is None or end_number is None:
        return None
    if end_number < beg_number:
        beg_number, end_number = end_number, beg_number
    inside = [
        position
        for position, residue in enumerate(residues)
        if (number := _optional_int(residue["seq"])) is not None and beg_number <= number <= end_number
    ]
    if not inside:
        return None
    return inside[0], inside[-1]


def _locate_residue(residues: list[dict[str, str]], seq_value: str, ins_value: str) -> int | None:
    ins_value = _normalized_ins_code(ins_value)
    for position, residue in enumerate(residues):
        if residue["seq"] == seq_value and _normalized_ins_code(residue["ins"]) == ins_value:
            return position
    return None


def _mmcif_residue_span(
    chain_residues: list[dict[str, str]],
    seq_field: str,
    comp_field: str,
    beg_value: str,
    end_value: str,
    beg_comp: str,
    end_comp: str,
    beg_ins: str,
    end_ins: str,
    *,
    allow_comp_fallback: bool,
) -> tuple[int, int] | None:
    view = [{"seq": residue[seq_field], "ins": residue["ins_code"]} for residue in chain_residues]
    span = _residue_span_positions(view, beg_value, beg_ins, end_value, end_ins)
    if span is not None:
        return span

    # Numbering that never lined up with atom_site in the first place: fall back
    # to residue names, and only where they pin down a single residue each.
    if not allow_comp_fallback:
        return None
    beg_position = _locate_mmcif_residue_by_comp(chain_residues, beg_comp, comp_field)
    end_position = _locate_mmcif_residue_by_comp(chain_residues, end_comp, comp_field)
    if beg_position is None or end_position is None:
        return None
    return (beg_position, end_position) if beg_position <= end_position else (end_position, beg_position)


def _rewrite_mmcif_secondary_structure_rows(
    prefix: str,
    columns: list[str],
    row_lines: list[str],
    residues_by_chain: dict[str, list[dict[str, str]]],
) -> list[str]:
    """Re-point helix/strand records at the rewritten residue numbering.

    Mol* reads `_struct_conf` and `_struct_sheet_range` by label_seq_id, so a
    record left on the original numbering lands on the wrong residues once the
    kept atoms have been renumbered, which is what makes helices and sheets go
    missing after an edit. Ranges that only partly survive are clamped to the
    residues still present; records with nothing left are dropped.
    """
    if prefix == "_pdbx_struct_sheet_hbond":
        endpoint_stems = [("range_1", "range_1"), ("range_2", "range_2")]
    else:
        endpoint_stems = [("beg", "end")]

    rows = _map_mmcif_secondary_structure_rows(
        columns,
        row_lines,
        prefix,
        endpoint_stems,
        residues_by_chain,
        allow_comp_fallback=False,
    )
    if row_lines and not rows:
        # Nothing matched on sequence numbers, so this category was never on the
        # same numbering as atom_site. Residue names are all that is left.
        rows = _map_mmcif_secondary_structure_rows(
            columns,
            row_lines,
            prefix,
            endpoint_stems,
            residues_by_chain,
            allow_comp_fallback=True,
        )
    return rows


def _map_mmcif_secondary_structure_rows(
    columns: list[str],
    row_lines: list[str],
    prefix: str,
    endpoint_stems: list[tuple[str, str]],
    residues_by_chain: dict[str, list[dict[str, str]]],
    *,
    allow_comp_fallback: bool,
) -> list[str]:
    filtered_rows: list[str] = []
    for row_line in row_lines:
        tokens = _tokenize_mmcif_row(row_line)
        if len(tokens) != len(columns):
            filtered_rows.append(row_line)
            continue

        mapped_tokens = list(tokens)
        dropped = False
        for beg_stem, end_stem in endpoint_stems:
            beg_fields = _mmcif_endpoint_columns(prefix, beg_stem)
            end_fields = _mmcif_endpoint_columns(prefix, end_stem)
            chain_id = _first_existing_value(tokens, columns, beg_fields["chain"])
            chain_residues = residues_by_chain.get(chain_id)
            if not chain_residues:
                dropped = True
                break

            kind = "label"
            beg_value = _first_existing_value(tokens, columns, beg_fields["label_seq"])
            end_value = _first_existing_value(tokens, columns, end_fields["label_seq"])
            if beg_value in {"", ".", "?"} or end_value in {"", ".", "?"}:
                kind = "auth"
                beg_value = _first_existing_value(tokens, columns, beg_fields["auth_seq"])
                end_value = _first_existing_value(tokens, columns, end_fields["auth_seq"])

            span = _mmcif_residue_span(
                chain_residues,
                f"{kind}_seq",
                f"{kind}_comp",
                beg_value,
                end_value,
                _first_existing_value(tokens, columns, beg_fields[f"{kind}_comp"]),
                _first_existing_value(tokens, columns, end_fields[f"{kind}_comp"]),
                _first_existing_value(tokens, columns, beg_fields["ins_code"]),
                _first_existing_value(tokens, columns, end_fields["ins_code"]),
                allow_comp_fallback=allow_comp_fallback,
            )
            if span is None:
                dropped = True
                break

            for position, fields in ((span[0], beg_fields), (span[1], end_fields)):
                residue = chain_residues[position]
                _set_existing_value(mapped_tokens, columns, fields["label_seq"], residue["new_label_seq"])
                _set_existing_value(mapped_tokens, columns, fields["auth_seq"], residue["new_auth_seq"])
                _set_existing_value(mapped_tokens, columns, fields["label_comp"], residue["label_comp"])
                _set_existing_value(mapped_tokens, columns, fields["auth_comp"], residue["auth_comp"])
                _set_existing_value(mapped_tokens, columns, fields["ins_code"], residue["ins_code"])

        if dropped:
            continue
        filtered_rows.append(" ".join(mapped_tokens))

    return filtered_rows


class _PdbResidueField(NamedTuple):
    """Column spans of one residue reference in a PDB HELIX/SHEET record."""

    comp: slice
    chain: int
    seq: slice
    ins: int


# Column numbers are from the PDB format spec, converted to 0-based slices.
_PDB_HELIX_BEG = _PdbResidueField(slice(15, 18), 19, slice(21, 25), 25)
_PDB_HELIX_END = _PdbResidueField(slice(27, 30), 31, slice(33, 37), 37)
_PDB_HELIX_LENGTH = slice(71, 76)
_PDB_SHEET_BEG = _PdbResidueField(slice(17, 20), 21, slice(22, 26), 26)
_PDB_SHEET_END = _PdbResidueField(slice(28, 31), 32, slice(33, 37), 37)
_PDB_SHEET_CUR = _PdbResidueField(slice(45, 48), 49, slice(50, 54), 54)
_PDB_SHEET_PREV = _PdbResidueField(slice(60, 63), 64, slice(65, 69), 69)
_PDB_SHEET_CUR_ATOM = slice(41, 45)
_PDB_SHEET_PREV_ATOM = slice(56, 60)
_PDB_SHEET_ID = slice(11, 14)
_PDB_SHEET_STRAND_COUNT = slice(14, 16)
_PDB_RECORD_WIDTH = 80


def _read_pdb_field(line: str, where: slice) -> str:
    return line[where].strip()


def _write_pdb_field(chars: list[str], where: slice, value: str) -> None:
    width = where.stop - where.start
    chars[where] = list(value.rjust(width)[:width])


def _rewrite_pdb_secondary_structure_lines(
    lines: list[str],
    residues_by_chain: dict[str, list[dict[str, str]]],
) -> list[str]:
    """Move HELIX/SHEET records onto the rewritten residue numbering.

    Mol* turns these records into struct_conf/struct_sheet_range and resolves
    them on auth numbering, so a record left behind by a renumbering draws the
    wrong part of the chain. Ranges are mapped by position among the residues
    that are present, so gaps in the original numbering do not shift anything.
    """
    rewritten: list[str] = []
    for line in lines:
        record = line[:6].strip()
        if record == "HELIX":
            mapped = _rewrite_pdb_helix_line(line, residues_by_chain)
        elif record == "SHEET":
            mapped = _rewrite_pdb_sheet_line(line, residues_by_chain)
        else:
            rewritten.append(line)
            continue
        if mapped is not None:
            rewritten.append(mapped)
    return _renumber_pdb_sheet_strand_counts(rewritten)


def _map_pdb_residue_range(
    line: str,
    beg_field: _PdbResidueField,
    end_field: _PdbResidueField,
    residues_by_chain: dict[str, list[dict[str, str]]],
) -> tuple[dict[str, str], dict[str, str]] | None:
    chain_id = line[beg_field.chain] if len(line) > beg_field.chain else ""
    chain_residues = residues_by_chain.get(chain_id)
    if not chain_residues:
        return None
    span = _residue_span_positions(
        chain_residues,
        _read_pdb_field(line, beg_field.seq),
        line[beg_field.ins] if len(line) > beg_field.ins else "",
        _read_pdb_field(line, end_field.seq),
        line[end_field.ins] if len(line) > end_field.ins else "",
    )
    if span is None:
        return None
    return chain_residues[span[0]], chain_residues[span[1]]


def _apply_pdb_residue(chars: list[str], field: _PdbResidueField, residue: dict[str, str]) -> None:
    _write_pdb_field(chars, field.comp, residue["comp"])
    chars[field.chain] = residue["chain"]
    _write_pdb_field(chars, field.seq, residue["new_seq"])
    chars[field.ins] = residue["ins"] or " "


def _rewrite_pdb_helix_line(line: str, residues_by_chain: dict[str, list[dict[str, str]]]) -> str | None:
    mapped = _map_pdb_residue_range(line, _PDB_HELIX_BEG, _PDB_HELIX_END, residues_by_chain)
    if mapped is None:
        return None
    beg_residue, end_residue = mapped
    chars = list(line.ljust(_PDB_RECORD_WIDTH))
    _apply_pdb_residue(chars, _PDB_HELIX_BEG, beg_residue)
    _apply_pdb_residue(chars, _PDB_HELIX_END, end_residue)
    if _read_pdb_field(line, _PDB_HELIX_LENGTH):
        length = int(end_residue["new_seq"]) - int(beg_residue["new_seq"]) + 1
        _write_pdb_field(chars, _PDB_HELIX_LENGTH, str(length))
    return "".join(chars).rstrip()


def _rewrite_pdb_sheet_line(line: str, residues_by_chain: dict[str, list[dict[str, str]]]) -> str | None:
    mapped = _map_pdb_residue_range(line, _PDB_SHEET_BEG, _PDB_SHEET_END, residues_by_chain)
    if mapped is None:
        return None
    beg_residue, end_residue = mapped
    chars = list(line.ljust(_PDB_RECORD_WIDTH))
    _apply_pdb_residue(chars, _PDB_SHEET_BEG, beg_residue)
    _apply_pdb_residue(chars, _PDB_SHEET_END, end_residue)

    # The strand registration names one residue in this strand and one in the
    # previous strand. It is optional, so blank the pair out rather than drop
    # the strand when either residue no longer exists.
    registration = []
    for field in (_PDB_SHEET_CUR, _PDB_SHEET_PREV):
        chain_residues = residues_by_chain.get(line[field.chain] if len(line) > field.chain else "")
        seq_value = _read_pdb_field(line, field.seq)
        position = (
            _locate_residue(chain_residues, seq_value, line[field.ins] if len(line) > field.ins else "")
            if chain_residues and seq_value
            else None
        )
        registration.append(None if position is None else chain_residues[position])
    if all(residue is not None for residue in registration):
        _apply_pdb_residue(chars, _PDB_SHEET_CUR, registration[0])
        _apply_pdb_residue(chars, _PDB_SHEET_PREV, registration[1])
    else:
        for where in (_PDB_SHEET_CUR_ATOM, _PDB_SHEET_PREV_ATOM):
            _write_pdb_field(chars, where, "")
        for field in (_PDB_SHEET_CUR, _PDB_SHEET_PREV):
            _write_pdb_field(chars, field.comp, "")
            chars[field.chain] = " "
            _write_pdb_field(chars, field.seq, "")
            chars[field.ins] = " "
    return "".join(chars).rstrip()


def _renumber_pdb_sheet_strand_counts(lines: list[str]) -> list[str]:
    strands_by_sheet: dict[str, int] = defaultdict(int)
    for line in lines:
        if line.startswith("SHEET"):
            strands_by_sheet[_read_pdb_field(line, _PDB_SHEET_ID)] += 1
    if not strands_by_sheet:
        return lines

    renumbered: list[str] = []
    for line in lines:
        if not line.startswith("SHEET"):
            renumbered.append(line)
            continue
        chars = list(line.ljust(_PDB_RECORD_WIDTH))
        _write_pdb_field(chars, _PDB_SHEET_STRAND_COUNT, str(strands_by_sheet[_read_pdb_field(line, _PDB_SHEET_ID)]))
        renumbered.append("".join(chars).rstrip())
    return renumbered
