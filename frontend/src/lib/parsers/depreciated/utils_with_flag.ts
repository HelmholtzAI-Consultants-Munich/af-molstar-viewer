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
    .replace(/\.[^.]+$/, '')
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

// Formats a list of residue indices into compact chain ranges for display (e.g., "A6-11,B2").
// Notes on numbering vs. polymer continuity:
// - By default (mode: 'numbering'), we group ranges by continuity in displayed sequence numbers
//   (preferring authSeqId, falling back to labelSeqId). This reflects how users typically type
//   ranges (e.g., A6-11) and how AFDB shows selections when numbering is contiguous.
// - For Mol* Focus drags, the underlying polymer residues are contiguous even if the author-provided
//   residue numbering (authSeqId) has gaps or insertion codes. In that case, users expect the label to
//   show the first and last displayed numbers of the focused polymer span, not a count-based end, and
//   not split ranges on numbering gaps. To support this, use mode: 'polymer' to group by adjacency of
//   polymer indices within the same chain and still label with auth/label numbers.
export function formatResidueSelection(
  residues: PolymerResidue[],
  indices: number[],
  options: { emptyLabel?: string; mode?: 'numbering' | 'polymer' } = {},
): string {
  const normalized = summarizeResidueSelection(indices)
    .map((index) => residues[index])
    .filter((residue): residue is PolymerResidue => Boolean(residue));

  if (normalized.length === 0) {
    return options.emptyLabel ?? 'No Mol* selection';
  }

  const byNumbering = options.mode !== 'polymer';

  const segments: string[] = [];
  let currentChain = normalized[0].chainId;
  // We always display authSeqId when available, falling back to labelSeqId.
  let startDisplaySeq = normalized[0].authSeqId ?? normalized[0].labelSeqId;
  let prevDisplaySeq = startDisplaySeq;
  let prevPolymerIndex = normalized[0].index; // internal contiguous polymer index

  for (const residue of normalized.slice(1)) {
    const chainId = residue.chainId;
    const displaySeq = residue.authSeqId ?? residue.labelSeqId;
    const isSameChain = chainId === currentChain;
    const isContinuous = byNumbering
      ? displaySeq === prevDisplaySeq + 1
      : residue.index === prevPolymerIndex + 1; // polymer adjacency across numbering gaps

    if (isSameChain && isContinuous) {
      // Continue the current segment
      prevDisplaySeq = displaySeq;
      prevPolymerIndex = residue.index;
      continue;
    }

    // Close previous segment
    segments.push(
      startDisplaySeq === prevDisplaySeq
        ? `${currentChain}${startDisplaySeq}`
        : `${currentChain}${startDisplaySeq}-${prevDisplaySeq}`,
    );
    // Start new segment
    currentChain = chainId;
    startDisplaySeq = displaySeq;
    prevDisplaySeq = displaySeq;
    prevPolymerIndex = residue.index;
  }

  // Emit the last segment
  segments.push(
    startDisplaySeq === prevDisplaySeq
      ? `${currentChain}${startDisplaySeq}`
      : `${currentChain}${startDisplaySeq}-${prevDisplaySeq}`,
  );
  return segments.join(',');
}
