import type { LoadedViewerArtifact } from "./project-types";
import type { PolymerResidue, ChainRange, RangeResidueMatch } from '../lib/types';

const SEGMENT_PATTERN = /^(?<chain>[A-Za-z]+)(?<start>\d+)(?:-(?:(?<endChain>[A-Za-z]+))?(?<end>\d+))?$/;


export function sortResidues(residues: PolymerResidue[]): PolymerResidue[] {
  // Sorts the incoming residues by their chainId and authSeqId, make sure output is unique in that way
  if (!residues.every(r => Number.isFinite(r.authSeqId))) {
    throw new Error('All residues must have a numeric authSeqId');
  }
  // derive uniqueness from chainId + numbering combination
  const unique = Array.from(
    new Map(residues.map(r => [`${r.chainId}:${r.authSeqId}`, r])).values());
  // sort by chainId first, authSeqId second
  return unique.sort((a, b) => a.chainId.localeCompare(b.chainId) || a.authSeqId - b.authSeqId );
}


export function sortMergeChainRanges(ranges: ChainRange[]): ChainRange[] {
  // Sort the ranges by chain and start position for easier merging and consistent canonicalization
  const sorted = ranges.sort((left, right) =>
      left.chainId.localeCompare(right.chainId) ||
      left.start - right.start ||
      left.end - right.end,
    )
  // Merge overlapping or adjacent ranges for the same chain, tolerant to singleton ranges (e.g. A5)
  const merged: ChainRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.chainId === range.chainId && last.end >= range.start - 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

export function canonicalizeChainRanges(ranges: ChainRange[]): string {
  // This takes an array of chain ranges and formats it into a canonical string, e.g. "A1-10,B20-22,B40". 
  return sortMergeChainRanges(ranges).map((segment) => (segment.start === segment.end ? `${segment.chainId}${segment.start}` : `${segment.chainId}${segment.start}-${segment.end}`))
    .join(',');
}

export function selectionDraftToChainRanges(input: string): ChainRange[] {
  // This takes a selection draft string like "A1-10,B20-22" and parses it 
  // into an array of chain ranges, e.g. [{ chainId: 'A', start: 1, end: 10 }, 
  // { chainId: 'B', start: 20, end: 22 }]. 
  // A bit more lenient than the canonical form, allowing whitespace and ignoring 
  // empty segments, but still validates the format and semantics of each segment.
  // For parsing user input in the selection draft, which is likely to be messy, 
  // while the canonical form is for storing and communicating a clean, validated selection.
  // Does not resolve the selection to actual residue indices or author residue numbers.

  // TODO maybe add a guard for the initialization stage so this doesn't fire before the viewer is ready
  
  const segments = input
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    // throw new Error('Selection cannot be empty');
    return [];
  }

  // Parse each segment into a chain range, validating the format and semantics of each segment. 
  // This also allows for more specific error messages for invalid input.
  const ranges = segments.map((segment) => {
    const match = SEGMENT_PATTERN.exec(segment);
    if (!match?.groups) {
      throw new Error(`Invalid selection segment: ${segment}`);
    }
    const endChain = match.groups.endChain;
    if (endChain && endChain !== match.groups.chain) {
      throw new Error(`Selection range crosses chains: ${segment}`);
    }
    const start = Number(match.groups.start);
    const end = Number(match.groups.end ?? match.groups.start);
    if (end < start) {
      throw new Error(`Selection end precedes start: ${segment}`);
    }
    return {
      chainId: match.groups.chain,
      start,
      end,
    };
  });
  return sortMergeChainRanges(ranges);
}

export function canonicalizeSelectionDraft(input: string): string {
  const ranges = selectionDraftToChainRanges(input);
  return canonicalizeChainRanges(ranges);
}

export function residuesToChainRanges(residues: PolymerResidue[]): ChainRange[] {
  // This takes an array of residues and converts it to an array of chain ranges, 
  // e.g. [{ chainId: 'A', start: 1, end: 1 }, { chainId: 'B', start: 20, end: 22 }]. 
  const ranges: ChainRange[] = [];
  for (const residue of residues) {
    if (residue.authSeqId == null) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.chainId === residue.chainId && last.end >= residue.authSeqId - 1) {
      last.end = Math.max(last.end, residue.authSeqId);
    } else {
      ranges.push({
        chainId: residue.chainId,
        start: residue.authSeqId,
        end: residue.authSeqId,
      });
    }
  }
  return ranges;
}


export function matchChainRangesAndResidues(
  ranges: ChainRange[], 
  residues: PolymerResidue[]): RangeResidueMatch {
  // This takes an array of chain ranges and an array of residues, and returns the indices of the residues that match any of the chain ranges. This is used for resolving a parsed selection draft to actual residue indices based on the residues available in the artifact.
  
  // filter the residues and track the indices and authSeqIds of the ones that we keep
  const filtered_residues: PolymerResidue[] = [];
  const residue_indices: number[] = [];
  const auth_seq_ids: number[] = [];
  for (let i = 0; i < residues.length; i++) {
    const residue = residues[i];
    if (residue.authSeqId == null) continue;
    if (ranges.some(
      (range) => residue.chainId === range.chainId &&
        residue.authSeqId !== undefined &&
        residue.authSeqId >= range.start &&
        residue.authSeqId <= range.end
    )) {
      filtered_residues.push(residue);
      residue_indices.push(i);
      auth_seq_ids.push(residue.authSeqId!);
    }
  }
  // TODO should already be in the correct order

  // now re-build ranges and canonical string based on the filtered residues
  const filtered_ranges = residuesToChainRanges(filtered_residues);
  const canonical = canonicalizeChainRanges(filtered_ranges);

  return {
    ranges: filtered_ranges,
    residues: filtered_residues,
    authSeqIds: auth_seq_ids,
    residueIndices: residue_indices,
    canonical: canonical,
  };
}


export function matchSelectionDraftAndResidues(
  input: string,
  residues: PolymerResidue[],
): RangeResidueMatch {
  const ranges = selectionDraftToChainRanges(input)
  return matchChainRangesAndResidues(ranges, residues)
}


export function indicesAndResiduesToMatch(
  indices: number[],
  residues: PolymerResidue[],
): RangeResidueMatch {
  // Validate indices and ensure they are within bounds
  for (const index of indices) {
    if (index < 0 || index >= residues.length) {
      throw new Error(`indicesAndResiduesToMatch: Index out of bounds: ${index}`);
    }
  }
  // Filter residues based on the provided indices
  const filtered_residues = indices.map(index => residues[index]);
  const auth_seq_ids = filtered_residues.map(residue => residue.authSeqId);
  // Rebuild ranges and canonical string based on the filtered residues
  const ranges = sortMergeChainRanges(residuesToChainRanges(filtered_residues));
  const canonical = canonicalizeChainRanges(ranges);
  return {
    ranges: ranges,
    residues: filtered_residues,
    authSeqIds: auth_seq_ids,
    residueIndices: indices,
    canonical: canonical,
  };
}


export function selectionDraftAndArtifactToMatch(
  input: string,
  artifact: LoadedViewerArtifact | null, 
): RangeResidueMatch | null {

  if (!artifact) return null;
  if (!input.trim()) return null;

  const ranges = selectionDraftToChainRanges(input);
  const match = matchChainRangesAndResidues(ranges, artifact.bundle.residues)
  console.debug('selectionDraftAndArtifactToMatch turned input', input, 'to ranges', ranges, 'and output', match.residueIndices);
  return match
}
