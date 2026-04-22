from __future__ import annotations

from pathlib import Path
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
    kept_residue_count = _write_filtered_structure(
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
    kept_residue_count = _write_filtered_structure(
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
    }
    return payload


def _write_filtered_structure(
    structure_file: Path,
    output_path: Path,
    residue_ranges: list[ResidueRange],
    *,
    keep_selected: bool,
) -> int:
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
) -> int:
    from Bio.PDB import MMCIFIO, MMCIFParser, PDBIO, PDBParser, Select

    keep_residue = _make_keep_residue_predicate(residue_ranges, keep_selected=keep_selected)
    parser = MMCIFParser(QUIET=True) if structure_file.suffix.lower() in {".cif", ".mmcif"} else PDBParser(QUIET=True)
    structure = parser.get_structure(structure_file.stem, str(structure_file))

    class ResidueSelect(Select):
        def accept_residue(self, residue) -> bool:  # type: ignore[override]
            # Keep Biopython's original residue ids so edited structures preserve
            # numbering gaps such as A1, A5 after cutting away A2-4.
            return 1 if keep_residue(residue.get_parent().id, residue.id[1]) else 0

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
    return kept_residue_count


def _write_filtered_pdb_text(
    structure_file: Path,
    output_path: Path,
    residue_ranges: list[ResidueRange],
    *,
    keep_selected: bool,
) -> int:
    keep_residue = _make_keep_residue_predicate(residue_ranges, keep_selected=keep_selected)
    kept_residue_keys: set[tuple[str, int, str]] = set()
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
            continue
        if record == "TER":
            continue
        filtered_lines.append(line)

    if not kept_residue_keys:
        raise ValueError("The requested edit would remove every residue from the structure.")

    if not any(line.startswith("END") for line in filtered_lines):
        filtered_lines.append("END")
    output_path.write_text("\n".join(filtered_lines) + "\n")
    return len(kept_residue_keys)


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
