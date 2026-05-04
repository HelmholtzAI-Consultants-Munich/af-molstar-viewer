import { canonicalizeChainRanges } from '../../domain/target-interface';
import { ChainRange } from '../types';
import type { PolymerResidue } from '../types';
import { uniqueSortedNumbers } from '../utils';

export interface MolstarResidueSelection {
  [key: string]: unknown;
  label_asym_id: string;
  beg_label_seq_id: number;
  end_label_seq_id: number;
  beg_auth_seq_id: number;
  end_auth_seq_id: number;
  color?: string | null;
  focus?: boolean;
}

function queryToChainRange(query: MolstarResidueSelection) : ChainRange {
  return {
    chainId: query.label_asym_id,
    start: query.beg_auth_seq_id,
    end: query.end_auth_seq_id, }}

export function canonicalizeQueries(queries: MolstarResidueSelection[]) : string {
  return canonicalizeChainRanges(queries.map((query) => queryToChainRange(query))) }

export function residueIndicesToQueries(
  residues: PolymerResidue[],
  indices: number[],
  options: { focus?: boolean; colorNull?: boolean } = {},
): MolstarResidueSelection[] {
  const unique = uniqueSortedNumbers(indices);
  if (unique.length === 0) return [];

  const queries: MolstarResidueSelection[] = [];
  let startResidue = residues[unique[0]];
  let previousResidue = startResidue;

  for (let position = 1; position < unique.length; position += 1) {
    const residue = residues[unique[position]];
    const isContinuation =
      residue.chainId === previousResidue.chainId && 
      residue.labelSeqId === previousResidue.labelSeqId + 1 && 
      residue.authSeqId === previousResidue.authSeqId + 1;
    if (isContinuation) {
      previousResidue = residue;
      continue;
    }
    queries.push({
      label_asym_id: startResidue.chainId,
      beg_label_seq_id: startResidue.labelSeqId,
      end_label_seq_id: previousResidue.labelSeqId,
      beg_auth_seq_id: startResidue.authSeqId,
      end_auth_seq_id: previousResidue.authSeqId,
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
    beg_auth_seq_id: startResidue.authSeqId,
    end_auth_seq_id: previousResidue.authSeqId,
    ...(options.colorNull ? { color: null } : {}),
    ...(options.focus ? { focus: true } : {}),
  });

  // console.debug('residueIndicesToQueries:', indices, 'to queries', canonicalizeQueries(queries))
  return queries;
}

export function findResidueIndexFromMolstarEvent(
  residues: PolymerResidue[],
  eventData: Record<string, unknown> | undefined,
): number | null {
  if (!eventData) return null;
  const chainId = String(eventData.label_asym_id ?? eventData.auth_asym_id ?? '');
  if (!chainId) return null;

  const residuesInChain = residues.filter((entry) => entry.chainId === chainId);
  if (residuesInChain.length === 0) return null;

  const parseSequenceId = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const matchByLabel = (sequenceId: number | null) =>
    sequenceId === null ? undefined : residuesInChain.find((entry) => entry.labelSeqId === sequenceId);
  const matchByAuth = (sequenceId: number | null) =>
    sequenceId === null ? undefined : residuesInChain.find((entry) => entry.authSeqId === sequenceId);

  const labelSeqId = parseSequenceId(eventData.label_seq_id);
  const residueNumber = parseSequenceId(eventData.residueNumber);
  const seqId = parseSequenceId(eventData.seq_id);
  const authSeqId = parseSequenceId(eventData.auth_seq_id);

  const residue =
    matchByLabel(labelSeqId) ??
    matchByLabel(residueNumber) ??
    matchByAuth(authSeqId) ??
    matchByLabel(seqId) ??
    matchByAuth(residueNumber) ??
    matchByAuth(seqId);

  // console.log('findResidueIndexFromMolstarEvent', residue?.index, 'on chain', chainId, 'with', residuesInChain.length, 'aa');
  return residue?.index ?? null;
}
