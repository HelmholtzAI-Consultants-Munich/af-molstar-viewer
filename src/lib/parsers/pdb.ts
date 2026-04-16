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

  function std(values: number[]) {
    if (values.length === 0) return 0;
    const m = mean(values);
    return Math.sqrt(mean(values.map(v => (v - m) ** 2)));
  }

  for (const line of lines) {
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const compId = line.slice(17, 20).trim();
    const chainId = line.slice(21, 22).trim() || 'A';
    const labelSeqId = Number(line.slice(22, 26).trim());
    const bFactor = Number(line.slice(60, 66).trim()) || 0;
    const key = `${chainId}:${labelSeqId}:${compId}`;

    if (key !== currentKey) {
      if (current) {
        current.confidenceFromStructure = mean(atomBFactors);
        current.atomEnd = atomIndex - 1;
        perResidueStd.push(std(atomBFactors));
        residues.push(current);
      }
      const moleculeType = classifyChemCompType(line.startsWith('ATOM') ? 'PEPTIDE LINKING' : undefined, compId);
      current = {
        chainId,
        labelSeqId,
        authSeqId: labelSeqId,
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