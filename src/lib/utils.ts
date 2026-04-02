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
