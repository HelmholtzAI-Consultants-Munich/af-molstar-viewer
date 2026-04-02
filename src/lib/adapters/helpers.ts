import { confidenceCategory } from '../constants';
import type {
  MatrixViewport,
  ParsedStructure,
  PolymerResidue,
  PredictionBundle,
  PredictionSource,
  StructureFileRef,
  WorkerInputFile,
} from '../types';
import { createChains, createDefaultViewport, mean, round } from '../utils';

export function structureFormatFromName(name: string): StructureFileRef['format'] | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdb')) return 'pdb';
  if (lower.endsWith('.cif')) return 'cif';
  if (lower.endsWith('.mmcif')) return 'mmcif';
  return null;
}

export function requireFile(files: WorkerInputFile[], fileName: string): WorkerInputFile {
  const file = files.find((entry) => entry.name === fileName);
  if (!file) throw new Error(`Missing file ${fileName}`);
  return file;
}

export function makeBundle(params: {
  id: string;
  name: string;
  source: PredictionSource;
  structure: StructureFileRef;
  parsedStructure: ParsedStructure;
  paeMatrix: number[][];
  paeMax: number;
  summary?: Record<string, number>;
  matchedFiles: string[];
  warnings?: string[];
  confidenceOverride?: number[];
  tokenIndexMap?: number[];
}): PredictionBundle {
  const polymerResidues = params.parsedStructure.residues.filter((residue) => residue.moleculeType !== 'ligand');
  const residues: PolymerResidue[] = polymerResidues.map((residue, index) => {
    const confidence = params.confidenceOverride?.[index] ?? residue.confidenceFromStructure;
    return {
      index,
      chainId: residue.chainId,
      entityId: residue.entityId,
      labelSeqId: residue.labelSeqId,
      authSeqId: residue.authSeqId,
      compId: residue.compId,
      code: residue.code,
      confidence,
      category: confidenceCategory(confidence),
      moleculeType: residue.moleculeType,
      atomStart: residue.atomStart,
      atomEnd: residue.atomEnd,
      tokenIndex: params.tokenIndexMap?.[index],
    };
  });

  const summary = {
    meanConfidence: round(mean(residues.map((residue) => residue.confidence))),
    ...params.summary,
  };

  return {
    id: params.id,
    name: params.name,
    source: params.source,
    structure: params.structure,
    residues,
    chains: createChains(residues),
    paeMatrix: params.paeMatrix,
    paeMax: params.paeMax,
    summary,
    metadata: {
      warnings: params.warnings ?? [],
      matchedFiles: params.matchedFiles,
    },
  };
}

export function ensureSquareMatrix(matrix: unknown): number[][] {
  if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0])) {
    throw new Error('Expected square PAE matrix');
  }
  const values = matrix as number[][];
  const size = values.length;
  if (!values.every((row) => Array.isArray(row) && row.length === size)) {
    throw new Error('PAE matrix is not square');
  }
  return values.map((row) => row.map((value) => Number(value)));
}

export function defaultViewportForBundle(bundle: PredictionBundle): MatrixViewport {
  return createDefaultViewport(bundle.paeMatrix.length);
}
