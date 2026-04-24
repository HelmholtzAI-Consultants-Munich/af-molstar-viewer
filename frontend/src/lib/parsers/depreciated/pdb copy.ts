import { classifyChemCompType, residueCode } from '../constants';
import type { ParsedResidue, ParsedStructure, MoleculeType } from '../types';
import { mean } from '../utils';

export function parsePdbStructure(text: string): ParsedStructure {
  const lines = text.split(/\r?\n/);

  // 1) Collect SEQRES polymer definitions (chain → full intended sequence of compIds)
  const seqresByChain = new Map<string, string[]>();
  const chainOrder: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('SEQRES')) continue;
    const chainId = line.slice(11, 12).trim() || 'A';
    const residuesSection = line.length >= 20 ? line.slice(19).trim() : '';
    const compIds = residuesSection ? residuesSection.split(/\s+/g).filter(Boolean) : [];
    if (compIds.length === 0) continue;
    const existing = seqresByChain.get(chainId) ?? [];
    if (!seqresByChain.has(chainId)) chainOrder.push(chainId);
    existing.push(...compIds);
    seqresByChain.set(chainId, existing);
  }

  // 2) Parse observed residues from ATOM/HETATM. Group by (chainId, resSeq, iCode, compId).
  interface ObservedResidue {
    chainId: string;
    authSeqId?: number;
    compId: string;
    moleculeType: ParsedResidue['moleculeType'];
    code: string;
    atomStart: number;
    atomEnd: number;
    confidenceFromStructure: number;
  }
  const observedByChain = new Map<string, ObservedResidue[]>();
  const perResidueStd: number[] = [];

  let currentKey = '';
  let currentChain = '';
  let currentObserved: ObservedResidue | null = null;
  let atomBFactors: number[] = [];
  let atomIndex = 0;

  function std(values: number[]) {
    if (values.length === 0) return 0;
    const m = mean(values);
    return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
  }

  const ensureChainOrder = (chainId: string) => {
    if (!chainOrder.includes(chainId)) chainOrder.push(chainId);
  };

  for (const line of lines) {
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const compId = line.slice(17, 20).trim();
    const chainId = line.slice(21, 22).trim() || 'A';
    // PDB columns 23-26: resSeq (author residue number), column 27: insertion code
    const authResSeq = Number(line.slice(22, 26).trim());
    const iCode = line.slice(26, 27).trim();
    const bFactor = Number(line.slice(60, 66).trim()) || 0;
    const key = `${chainId}:${Number.isFinite(authResSeq) ? authResSeq : '?'}:${iCode || '-'}:${compId}`;

    if (key !== currentKey) {
      if (currentObserved) {
        currentObserved.confidenceFromStructure = mean(atomBFactors);
        currentObserved.atomEnd = atomIndex - 1;
        perResidueStd.push(std(atomBFactors));
        const list = observedByChain.get(currentChain) ?? [];
        list.push(currentObserved);
        observedByChain.set(currentChain, list);
      }
      const moleculeType = classifyChemCompType(line.startsWith('ATOM') ? 'PEPTIDE LINKING' : undefined, compId);
      currentObserved = {
        chainId,
        authSeqId: Number.isFinite(authResSeq) ? authResSeq : undefined,
        compId,
        moleculeType,
        code: residueCode(compId, moleculeType),
        atomStart: atomIndex,
        atomEnd: atomIndex, // will finalize when key changes
        confidenceFromStructure: bFactor, // temp, will be replaced with mean
      };
      currentKey = key;
      currentChain = chainId;
      atomBFactors = [];
      ensureChainOrder(chainId);
    }

    atomBFactors.push(bFactor);
    atomIndex += 1;
  }

  if (currentObserved) {
    currentObserved.confidenceFromStructure = mean(atomBFactors);
    currentObserved.atomEnd = atomIndex - 1;
    perResidueStd.push(std(atomBFactors));
    const list = observedByChain.get(currentChain) ?? [];
    list.push(currentObserved);
    observedByChain.set(currentChain, list);
  }

  // Include chains that only exist in observed but not in SEQRES, in the order first seen.
  for (const chainId of observedByChain.keys()) ensureChainOrder(chainId);

  // 3) Merge SEQRES and observed per chain to build final residues with contiguous labelSeqId (1..N).
  const residues: ParsedResidue[] = [];
  const labelSeqCounter = new Map<string, number>();

  const emitPlaceholder = (chainId: string, compId: string, idx: number) => {
    const nextLabel = (labelSeqCounter.get(chainId) ?? 0) + 1;
    labelSeqCounter.set(chainId, nextLabel);
    // const moleculeType = classifyChemCompType('PEPTIDE LINKING', compId);
    const moleculeType = 'protein';
    const code = residueCode(compId, moleculeType);
    residues.push({
      chainId,
      labelSeqId: nextLabel,
      // authSeqId: undefined, // do not invent author numbers for unobserved residues
      authSeqId: idx, // use SEQRES index as authSeqId for placeholders to keep them in sync with observed authSeqIds where possible
      compId,
      moleculeType: moleculeType,
      code: code,
      atomStart: atomIndex, // no atoms
      atomEnd: atomIndex,
      confidenceFromStructure: 0,
    });
  };

  const emitObserved = (chainId: string, obs: ObservedResidue) => {
    const nextLabel = (labelSeqCounter.get(chainId) ?? 0) + 1;
    labelSeqCounter.set(chainId, nextLabel);
    residues.push({
      chainId,
      labelSeqId: nextLabel,
      authSeqId: obs.authSeqId,
      compId: obs.compId,
      moleculeType: obs.moleculeType,
      code: obs.code,
      atomStart: obs.atomStart,
      atomEnd: obs.atomEnd,
      confidenceFromStructure: obs.confidenceFromStructure,
    });
  };

  for (const chainId of chainOrder) {
    labelSeqCounter.set(chainId, 0);
    const seq = seqresByChain.get(chainId) ?? null;
    const observed = observedByChain.get(chainId) ?? [];

    if (seq && seq.length > 0) {
      let j = 0; // observed pointer
      for (let i = 0; i < seq.length; i += 1) {
        const compId = seq[i];
        if (j < observed.length && observed[j].compId === compId) {
          emitObserved(chainId, observed[j]);
          j += 1;
        } else {
          // Missing residue in observed → placeholder
          emitPlaceholder(chainId, compId, i + 1);
        }
      }
      // Any trailing observed residues not represented in SEQRES are ignored to keep alignment with SEQRES.
    } else {
      // No SEQRES for this chain → fall back to emitting observed only, keeping order
      for (const obs of observed) emitObserved(chainId, obs);
    }
  }

  // 4) Guess the B-Factor source from observed residues only
  const globalStdMean = mean(perResidueStd);
  let looksLikePLDDTs: ParsedStructure['looksLikePLDDTs'] = false;
  if (globalStdMean < 1.0) {
    looksLikePLDDTs = true;
  } else if (globalStdMean > 2.0) {
    looksLikePLDDTs = false;
  }

  return { residues, looksLikePLDDTs };
}