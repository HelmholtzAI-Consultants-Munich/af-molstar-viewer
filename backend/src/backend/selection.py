from __future__ import annotations

from dataclasses import dataclass
import re


SELECTION_PATTERN = re.compile(r"^(?P<chain>[A-Za-z]+)(?P<start>\d+)(?:-(?:(?P<end_chain>[A-Za-z]+))?(?P<end>\d+))?$")


@dataclass(frozen=True, slots=True)
class ResidueRange:
    chain_id: str
    start: int
    end: int


def parse_target_interface_residues(selection: str) -> list[ResidueRange]:
    parts = [part.strip() for part in selection.split(",") if part.strip()]
    if not parts:
        raise ValueError("Selection cannot be empty")

    ranges: list[ResidueRange] = []
    for part in parts:
        match = SELECTION_PATTERN.match(part)
        if not match:
            raise ValueError(f"Invalid residue selection segment: {part}")
        end_chain = match.group("end_chain")
        if end_chain and end_chain != match.group("chain"):
            raise ValueError(f"Selection range crosses chains: {part}")
        start = int(match.group("start"))
        end = int(match.group("end") or start)
        if end < start:
            raise ValueError(f"Selection end precedes start: {part}")
        ranges.append(ResidueRange(chain_id=match.group("chain"), start=start, end=end))
    return ranges


def canonicalize_target_interface_residues(selection: str) -> str:
    ranges = parse_target_interface_residues(selection)
    ranges.sort(key=lambda residue_range: (residue_range.chain_id, residue_range.start, residue_range.end))
    return ",".join(
        f"{residue_range.chain_id}{residue_range.start}"
        if residue_range.start == residue_range.end
        else f"{residue_range.chain_id}{residue_range.start}-{residue_range.end}"
        for residue_range in ranges
    )
