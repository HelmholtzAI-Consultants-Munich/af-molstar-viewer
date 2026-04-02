import type { PolymerResidue } from '../types';
import { summarizeResidueSelection } from '../utils';

export interface MolstarResidueSelection {
  [key: string]: unknown;
  label_asym_id: string;
  beg_label_seq_id: number;
  end_label_seq_id: number;
  color?: string | null;
  focus?: boolean;
}

export function residueIndicesToQueries(
  residues: PolymerResidue[],
  indices: number[],
  options: { focus?: boolean; colorNull?: boolean } = {},
): MolstarResidueSelection[] {
  const unique = summarizeResidueSelection(indices);
  if (unique.length === 0) return [];

  const queries: MolstarResidueSelection[] = [];
  let startResidue = residues[unique[0]];
  let previousResidue = startResidue;

  for (let position = 1; position < unique.length; position += 1) {
    const residue = residues[unique[position]];
    const isContinuation =
      residue.chainId === previousResidue.chainId && residue.labelSeqId === previousResidue.labelSeqId + 1;
    if (isContinuation) {
      previousResidue = residue;
      continue;
    }
    queries.push({
      label_asym_id: startResidue.chainId,
      beg_label_seq_id: startResidue.labelSeqId,
      end_label_seq_id: previousResidue.labelSeqId,
      ...(options.colorNull ? { color: null } : {}),
      ...(options.focus ? { focus: true } : {}),
    });
    startResidue = residue;
    previousResidue = residue;
  }

  queries.push({
    label_asym_id: startResidue.chainId,
    beg_label_seq_id: startResidue.labelSeqId,
    end_label_seq_id: previousResidue.labelSeqId,
    ...(options.colorNull ? { color: null } : {}),
    ...(options.focus ? { focus: true } : {}),
  });

  return queries;
}

export function findResidueIndexFromMolstarEvent(
  residues: PolymerResidue[],
  eventData: Record<string, unknown> | undefined,
): number | null {
  if (!eventData) return null;
  const chainId = String(eventData.label_asym_id ?? eventData.auth_asym_id ?? '');
  const sequenceId = Number(eventData.seq_id ?? eventData.auth_seq_id ?? eventData.residueNumber);
  if (!chainId || !Number.isFinite(sequenceId)) return null;

  const residue = residues.find(
    (entry) =>
      entry.chainId === chainId &&
      (entry.labelSeqId === sequenceId || (entry.authSeqId !== undefined && entry.authSeqId === sequenceId)),
  );
  return residue?.index ?? null;
}
