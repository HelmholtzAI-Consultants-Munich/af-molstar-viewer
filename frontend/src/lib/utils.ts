import type { ChainTrack, MatrixViewport, PolymerResidue } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createDefaultViewport(size: number): MatrixViewport {
  return { xStart: 0, xEnd: size - 1, yStart: 0, yEnd: size - 1 };
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function createChains(residues: PolymerResidue[]): ChainTrack[] {
  const chains: ChainTrack[] = [];
  for (const residue of residues) {
    const last = chains.at(-1);
    if (last && last.chainId === residue.chainId) {
      last.sequence += residue.code;
      last.residueEnd = residue.index;
      continue;
    }
    chains.push({
      chainId: residue.chainId,
      entityId: residue.entityId,
      moleculeType: residue.moleculeType,
      sequence: residue.code,
      residueStart: residue.index,
      residueEnd: residue.index,
    });
  }
  return chains;
}

export function normalizeStem(name: string): string {
  return name
    // .replace(/\.[^.]+$/, '') // do not remove file extensions, as they can contain useful information (e.g. .pdb vs .cif)
    .replace(/(?:[-_])summary_confidences$/i, '')
    .replace(/(?:[-_])predicted_aligned_error(?:_v\d+)?(?:[-_].*)?$/i, '')
    .replace(/(?:[-_])model(?:_v\d+)?$/i, '')
    .replace(/(?:[-_])confidences$/i, '')
    .replace(/(?:[-_])(?:scores?|unrelaxed|relaxed|result_model_\d+|full_data_\d+|data_\d+)(?:[-_].*)?$/i, '')
    .replace(/(?:[-_])ranked_\d+$/i, '')
    .replace(/(?:[-_])pae$/i, '');
}

export function summarizeResidueSelection(indices: number[]): number[] {
  return [...new Set(indices)].sort((a, b) => a - b);
}

// Format a selection of residues as a human-readable string, e.g. "A1-10,B5,C3-4". Optionally provide an emptyLabel to show when no residues are selected.
// This also translates from the internal residue indexing (residues array) to the author residue numbering (chainId + authSeqId) for better readability, and collapses consecutive residues into ranges (e.g. A1-10 instead of A1,A2,...,A10).
export function formatResidueSelection(
  residues: PolymerResidue[],
  indices: number[],
  options: { emptyLabel?: string } = {},
): string {
  const sorted = summarizeResidueSelection(indices);
  const normalized  = sorted.map((index) => residues[index])
    .filter((r): r is PolymerResidue & { authSeqId: number } => r.authSeqId != null);

  if (normalized.length === 0) {
    return options.emptyLabel ?? 'No Mol* selection';
  }

  const segments: string[] = [];
  let currentChain = normalized[0].chainId;
  let startSeq = normalized[0].authSeqId; // ?? normalized[0].labelSeqId;
  let previousSeq = startSeq;

  for (const residue of normalized.slice(1)) {
    const chainId = residue.chainId;
    const sequenceId = residue.authSeqId; // ?? residue.labelSeqId;
    if (chainId === currentChain && sequenceId === previousSeq + 1) {
      previousSeq = sequenceId;
      continue;
    }

    segments.push(startSeq === previousSeq ? `${currentChain}${startSeq}` : `${currentChain}${startSeq}-${previousSeq}`);
    currentChain = chainId;
    startSeq = sequenceId;
    previousSeq = sequenceId;
  }

  segments.push(startSeq === previousSeq ? `${currentChain}${startSeq}` : `${currentChain}${startSeq}-${previousSeq}`);
  console.debug('formatResidueSelection turned indices', indices, 'and residues', residues, 'into segments', segments);
  return segments.join(',');
}
