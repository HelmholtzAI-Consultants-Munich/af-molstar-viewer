from __future__ import annotations

from dataclasses import dataclass
from json import dumps, loads
from pathlib import Path
from typing import Any

try:
    from Bio.PDB.MMCIF2Dict import MMCIF2Dict
except ModuleNotFoundError:  # pragma: no cover - optional backend dependency in local test envs.
    MMCIF2Dict = None  # type: ignore[assignment]

from .models import ViewerAsset, ViewerFile
from .selection import ResidueRange, parse_selection

PROTEIN_CODES = {
    "ALA",
    "ARG",
    "ASN",
    "ASP",
    "CYS",
    "GLN",
    "GLU",
    "GLY",
    "HIS",
    "ILE",
    "LEU",
    "LYS",
    "MET",
    "PHE",
    "PRO",
    "SER",
    "THR",
    "TRP",
    "TYR",
    "VAL",
    "SEC",
    "PYL",
}

NUCLEIC_CODES = {
    "A",
    "C",
    "G",
    "U",
    "T",
    "DA",
    "DC",
    "DG",
    "DT",
    "DU",
}


@dataclass(slots=True)
class ResidueRecord:
    chain_id: str
    auth_seq_id: int
    comp_id: str
    atom_start: int
    atom_end: int
    is_polymer: bool


def project_derived_viewer_asset(
    *,
    root_dir: Path,
    source_asset: ViewerAsset,
    derived_target_id: str,
    derived_label: str,
    derived_structure_path: str,
    selection: str | None = None,
    keep_selected: bool | None = None,
) -> ViewerAsset:
    source_files = list(source_asset.files)
    source_structure_file = next((file for file in source_files if _is_structure_file(file.name)), None)
    if source_structure_file is None:
        raise ValueError(f"No structure file found for target {source_asset.artifact_id}")

    if selection is None or keep_selected is None:
        files = [
            ViewerFile(
                name=file.name if not _is_structure_file(file.name) else Path(derived_structure_path).name,
                path=derived_structure_path if _is_structure_file(file.name) else str(_resolve_path(root_dir, file.path)),
            )
            for file in source_files
        ]
        return ViewerAsset(
            id=f"viewer-{derived_target_id}",
            artifact_id=derived_target_id,
            label=derived_label,
            files=files,
        )

    source_structure_path = _resolve_path(root_dir, source_structure_file.path)
    residues = _parse_structure_residues(source_structure_path)
    selection_ranges = parse_selection(selection)
    kept_residue_indices = [
        index
        for index, residue in enumerate(residues)
        if _residue_should_be_kept(residue, selection_ranges, keep_selected=keep_selected)
    ]
    kept_polymer_indices = [index for index in kept_residue_indices if residues[index].is_polymer]

    output_dir = Path(derived_structure_path).parent
    output_dir.mkdir(parents=True, exist_ok=True)

    files: list[ViewerFile] = []
    for file in source_files:
        if _is_structure_file(file.name):
            files.append(ViewerFile(name=Path(derived_structure_path).name, path=derived_structure_path))
            continue

        source_text = _resolve_path(root_dir, file.path).read_text()
        derived_text = _project_source_file_text(
            source_text,
            residues=residues,
            kept_residue_indices=kept_residue_indices,
            kept_polymer_indices=kept_polymer_indices,
        )
        derived_path = output_dir / file.name
        derived_path.write_text(derived_text)
        files.append(ViewerFile(name=file.name, path=str(derived_path)))

    return ViewerAsset(
        id=f"viewer-{derived_target_id}",
        artifact_id=derived_target_id,
        label=derived_label,
        files=files,
    )


def _project_source_file_text(
    source_text: str,
    *,
    residues: list[ResidueRecord],
    kept_residue_indices: list[int],
    kept_polymer_indices: list[int],
) -> str:
    try:
        payload = loads(source_text)
    except Exception:
        return source_text

    if _looks_like_af3_confidence_json(payload):
        return dumps(
            _project_af3_confidence_json(payload, residues, kept_residue_indices, kept_polymer_indices),
            separators=(",", ":"),
        )

    if _looks_like_af2_pae_json(payload):
        return dumps(
            _project_af2_pae_json(payload, kept_polymer_indices),
            separators=(",", ":"),
        )

    if _looks_like_colabfold_scores_json(payload):
        return dumps(
            _project_colabfold_scores_json(payload, kept_polymer_indices),
            separators=(",", ":"),
        )

    return source_text


def _project_af2_pae_json(payload: Any, kept_polymer_indices: list[int]) -> Any:
    pae_object = payload[0] if isinstance(payload, list) else payload
    pae_matrix = pae_object.get("predicted_aligned_error")
    if not isinstance(pae_matrix, list):
        return payload

    cropped_matrix = _project_square_matrix(pae_matrix, kept_polymer_indices)
    pae_object["predicted_aligned_error"] = cropped_matrix
    if "max_predicted_aligned_error" in pae_object:
        pae_object["max_predicted_aligned_error"] = _matrix_max(cropped_matrix)
    return payload


def _project_af3_confidence_json(
    payload: Any,
    residues: list[ResidueRecord],
    kept_residue_indices: list[int],
    kept_polymer_indices: list[int],
) -> Any:
    confidence_object = payload[0] if isinstance(payload, list) else payload
    pae_matrix = confidence_object.get("pae")
    if isinstance(pae_matrix, list):
        confidence_object["pae"] = _project_square_matrix(pae_matrix, kept_polymer_indices)

    atom_plddts = confidence_object.get("atom_plddts")
    if isinstance(atom_plddts, list):
        confidence_object["atom_plddts"] = _project_atom_values(atom_plddts, residues, kept_residue_indices)

    for key in ("token_chain_ids", "token_res_ids", "token_res_names"):
        value = confidence_object.get(key)
        if isinstance(value, list):
            confidence_object[key] = _project_residue_values(value, kept_polymer_indices)

    return payload


def _project_colabfold_scores_json(payload: Any, kept_polymer_indices: list[int]) -> Any:
    if not isinstance(payload, dict):
        return payload

    pae_matrix = payload.get("pae")
    if isinstance(pae_matrix, list):
        cropped_matrix = _project_square_matrix(pae_matrix, kept_polymer_indices)
        payload["pae"] = cropped_matrix
        if "max_pae" in payload:
            payload["max_pae"] = _matrix_max(cropped_matrix)

    predicted_aligned_error = payload.get("predicted_aligned_error")
    if isinstance(predicted_aligned_error, list):
        cropped_matrix = _project_square_matrix(predicted_aligned_error, kept_polymer_indices)
        payload["predicted_aligned_error"] = cropped_matrix
        if "max_predicted_aligned_error" in payload:
            payload["max_predicted_aligned_error"] = _matrix_max(cropped_matrix)

    plddt = payload.get("plddt")
    if isinstance(plddt, list):
        payload["plddt"] = _project_residue_values(plddt, kept_polymer_indices)

    return payload


def _project_square_matrix(matrix: list[Any], kept_indices: list[int]) -> list[list[float]]:
    return [
        [float(matrix[row_index][column_index]) for column_index in kept_indices]
        for row_index in kept_indices
    ]


def _project_residue_values(values: list[Any], kept_indices: list[int]) -> list[Any]:
    return [values[index] for index in kept_indices if index < len(values)]


def _project_atom_values(values: list[Any], residues: list[ResidueRecord], kept_residue_indices: list[int]) -> list[Any]:
    projected: list[Any] = []
    for residue_index in kept_residue_indices:
        residue = residues[residue_index]
        projected.extend(values[residue.atom_start : residue.atom_end + 1])
    return projected


def _matrix_max(matrix: list[list[float]]) -> float:
    if not matrix or not matrix[0]:
        return 0.0
    return max(max(row) for row in matrix if row)


def _looks_like_af2_pae_json(payload: Any) -> bool:
    pae_object = payload[0] if isinstance(payload, list) and payload else payload
    return bool(
        isinstance(pae_object, dict)
        and "predicted_aligned_error" in pae_object
        and isinstance(pae_object.get("predicted_aligned_error"), list)
    )


def _looks_like_af3_confidence_json(payload: Any) -> bool:
    return bool(isinstance(payload, dict) and "pae" in payload and "atom_plddts" in payload)


def _looks_like_colabfold_scores_json(payload: Any) -> bool:
    return bool(
        isinstance(payload, dict)
        and ("plddt" in payload or "pae" in payload or "predicted_aligned_error" in payload)
    )


def _parse_structure_residues(path: Path) -> list[ResidueRecord]:
    suffix = path.suffix.lower()
    if suffix in {".pdb", ".ent"}:
        return _parse_pdb_residues(path.read_text().splitlines())
    if suffix in {".cif", ".mmcif"}:
        return _parse_mmcif_residues(path)
    raise ValueError(f"Unsupported structure format for {path.name}")


def _parse_pdb_residues(lines: list[str]) -> list[ResidueRecord]:
    residues: list[ResidueRecord] = []
    current_key: tuple[str, int, str, str] | None = None
    current_residue: ResidueRecord | None = None
    atom_index = 0

    for line in lines:
        if not line.startswith(("ATOM", "HETATM")):
            continue
        comp_id = line[17:20].strip() or "?"
        chain_id = line[21:22].strip() or "A"
        auth_seq_raw = line[22:26].strip()
        auth_seq_id = int(auth_seq_raw) if auth_seq_raw.lstrip("-").isdigit() else atom_index + 1
        insertion_code = line[26:27].strip()
        key = (chain_id, auth_seq_id, insertion_code, comp_id)
        is_polymer = _classify_molecule_type(comp_id) != "ligand"
        if key != current_key:
            if current_residue is not None:
                residues.append(current_residue)
            current_key = key
            current_residue = ResidueRecord(
                chain_id=chain_id,
                auth_seq_id=auth_seq_id,
                comp_id=comp_id,
                atom_start=atom_index,
                atom_end=atom_index,
                is_polymer=is_polymer,
            )
        elif current_residue is not None:
            current_residue.atom_end = atom_index
        atom_index += 1

    if current_residue is not None:
        residues.append(current_residue)

    return residues


def _parse_mmcif_residues(path: Path) -> list[ResidueRecord]:
    if MMCIF2Dict is None:
        raise RuntimeError("Biopython is required to crop mmCIF confidence data. Run `uv sync` in backend/ first.")
    data = MMCIF2Dict(str(path))
    group_pdb = _as_list(data.get("_atom_site.group_PDB"))
    if not group_pdb:
        return []

    label_asym_id = _as_list(data.get("_atom_site.label_asym_id"))
    auth_asym_id = _as_list(data.get("_atom_site.auth_asym_id"))
    label_seq_id = _as_list(data.get("_atom_site.label_seq_id"))
    auth_seq_id = _as_list(data.get("_atom_site.auth_seq_id"))
    label_comp_id = _as_list(data.get("_atom_site.label_comp_id"))
    auth_comp_id = _as_list(data.get("_atom_site.auth_comp_id"))
    ins_code = _as_list(data.get("_atom_site.pdbx_PDB_ins_code"))

    current_key: tuple[str, int, str, str] | None = None
    current_residue: ResidueRecord | None = None
    residues: list[ResidueRecord] = []
    atom_index = 0

    for index, record in enumerate(group_pdb):
        if record not in {"ATOM", "HETATM"}:
            continue
        chain_id = _first_value(label_asym_id, index, _first_value(auth_asym_id, index, "A"))
        seq_raw = _first_value(auth_seq_id, index, _first_value(label_seq_id, index, str(atom_index + 1)))
        auth_seq_value = int(seq_raw) if seq_raw.lstrip("-").isdigit() else atom_index + 1
        comp_id = _first_value(label_comp_id, index, _first_value(auth_comp_id, index, "?"))
        insertion = _first_value(ins_code, index, "")
        key = (chain_id, auth_seq_value, insertion, comp_id)
        is_polymer = _classify_molecule_type(comp_id) != "ligand"
        if key != current_key:
            if current_residue is not None:
                residues.append(current_residue)
            current_key = key
            current_residue = ResidueRecord(
                chain_id=chain_id,
                auth_seq_id=auth_seq_value,
                comp_id=comp_id,
                atom_start=atom_index,
                atom_end=atom_index,
                is_polymer=is_polymer,
            )
        elif current_residue is not None:
            current_residue.atom_end = atom_index
        atom_index += 1

    if current_residue is not None:
        residues.append(current_residue)

    return residues


def _classify_molecule_type(comp_id: str) -> str:
    normalized = comp_id.strip().upper()
    if normalized in PROTEIN_CODES:
        return "protein"
    if normalized in NUCLEIC_CODES:
        return "dna" if normalized.startswith("D") else "rna"
    return "ligand"


def _residue_should_be_kept(
    residue: ResidueRecord,
    selection_ranges: list[ResidueRange],
    *,
    keep_selected: bool,
) -> bool:
    selected = any(
        residue.chain_id == selection_range.chain_id
        and selection_range.start <= residue.auth_seq_id <= selection_range.end
        for selection_range in selection_ranges
    )
    return selected if keep_selected else not selected


def _is_structure_file(name: str) -> bool:
    return Path(name).suffix.lower() in {".pdb", ".ent", ".cif", ".mmcif"}


def _resolve_path(root_dir: Path, path: str) -> Path:
    file_path = Path(path)
    if file_path.exists():
        return file_path
    return root_dir / path


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(entry) for entry in value]
    return [str(value)]


def _first_value(values: list[str], index: int, fallback: str) -> str:
    if index < len(values):
        value = values[index]
        if value not in {"", ".", "?"}:
            return value
    return fallback
