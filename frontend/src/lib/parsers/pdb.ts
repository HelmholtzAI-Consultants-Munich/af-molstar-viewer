import { classifyChemCompType, residueCode } from '../constants';
import type { ParsedResidue, ParsedStructure } from '../types';
import { mean } from '../utils';

export function parsePdbStructure(text: string): ParsedStructure {
  const lines = text.split(/\r?\n/);
  const residues: ParsedResidue[] = [];
  let currentKey = '';
  let current: ParsedResidue | null = null;
  let atomBFactors: number[] = [];
  let atomIndex = 0;

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
    residues.push(current);
  }

  return { residues };
}
