import { classifyChemCompType, residueCode } from '../constants';
import type { ParsedResidue, ParsedStructure } from '../types';
import { mean } from '../utils';

export function parsePdbStructure(text: string): ParsedStructure {
  const lines = text.split(/\r?\n/);
  const residues: ParsedResidue[] = [];
  let currentKey = '';
  let current: ParsedResidue | null = null;
  let atomBFactors: number[] = [];
  let perResidueStd: number[] = [];
  let atomIndex = 0;
  // Maintain a contiguous polymer counter per chain for labelSeqId (1..N)
  const labelSeqCounter = new Map<string, number>();

  function std(values: number[]) {
    if (values.length === 0) return 0;
    const m = mean(values);
    return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
  }

  for (const line of lines) {
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const compId = line.slice(17, 20).trim();
    const chainId = line.slice(21, 22).trim() || 'A';
    // PDB columns 23-26: resSeq (author residue number), column 27: insertion code
    const authResSeq = Number(line.slice(22, 26).trim());
    const iCode = line.slice(26, 27).trim();
    const bFactor = Number(line.slice(60, 66).trim()) || 0;
    // Group atoms by (chainId, authResSeq, iCode, compId) to preserve inserted residues (10, 10A, 10B, ...)
    const key = `${chainId}:${Number.isFinite(authResSeq) ? authResSeq : '?'}:${iCode || '-'}:${compId}`;

    if (key !== currentKey) {
      if (current) {
        current.confidenceFromStructure = mean(atomBFactors);
        current.atomEnd = atomIndex - 1;
        perResidueStd.push(std(atomBFactors));
        residues.push(current);
      }
      const moleculeType = classifyChemCompType(line.startsWith('ATOM') ? 'PEPTIDE LINKING' : undefined, compId);
      const nextLabel = (labelSeqCounter.get(chainId) ?? 0) + 1;
      labelSeqCounter.set(chainId, nextLabel);
      current = {
        chainId,
        // Assign a contiguous polymer index for labelSeqId (1..N)
        labelSeqId: nextLabel,
        // Preserve author numbering (resSeq) as authSeqId; do not expose iCode outside the parser
        authSeqId: Number.isFinite(authResSeq) ? authResSeq : undefined,
        compId,
        moleculeType,
        code: residueCode(compId, moleculeType),
        atomStart: atomIndex,
        atomEnd: atomIndex,
        confidenceFromStructure: bFactor,
      };
      atomBFactors = [];
      currentKey = key;
    }

    atomBFactors.push(bFactor);
    atomIndex += 1;
  }

  if (current) {
    current.confidenceFromStructure = mean(atomBFactors);
    current.atomEnd = atomIndex - 1;
    perResidueStd.push(std(atomBFactors));
    residues.push(current);
  }

  // guess the B-Factor source
  const globalStdMean = mean(perResidueStd);
  let looksLikePLDDTs: ParsedStructure['looksLikePLDDTs'] = false;

  if (globalStdMean < 1.0) {
    // atoms within residues are almost identical → pLDDT-like
    looksLikePLDDTs = true;
  } else if (globalStdMean > 2.0) {
    // noticeable variation within residues → experimental-like
    looksLikePLDDTs = false;
  }

  return { residues, looksLikePLDDTs };
}