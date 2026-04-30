export type PredictionSource = 'af2' | 'colabfold' | 'af3' | 'structure';
export type MoleculeType = 'protein' | 'dna' | 'rna' | 'ligand' | 'unknown';
export type ConfidenceCategory = 'very-high' | 'high' | 'low' | 'very-low';
export type StructureFormat = 'cif' | 'pdb' ;

export interface WorkerInputFile {
  name: string;
  text: string;
}

export interface StructureFileRef {
  fileName: string;
  format: StructureFormat;
}

export interface PolymerResidue {
  index: number;
  chainId: string;
  entityId?: string;
  labelSeqId: number;
  authSeqId: number;
  compId: string;
  code: string;
  confidence: number;
  category: ConfidenceCategory;
  moleculeType: MoleculeType;
  atomStart: number;
  atomEnd: number;
  tokenIndex?: number;
}

export interface ChainTrack {
  chainId: string;
  entityId?: string;
  moleculeType: MoleculeType;
  sequence: string;
  residueStart: number;
  residueEnd: number;
}

export interface ChainRange {
  chainId: string;
  start: number;
  end: number;
}

export interface RangeResidueMatch {
  ranges: ChainRange[];
  residues: PolymerResidue[];
  authSeqIds: number[];
  residueIndices: number[];
  canonical: string;
}

export interface PredictionBundle {
  id: string;
  name: string;
  source: PredictionSource;
  structure: StructureFileRef;
  residues: PolymerResidue[];
  chains: ChainTrack[];
  paeMatrix: number[][];
  paeMax: number;
  summary: Record<string, number>;
  metadata: {
    warnings: string[];
    matchedFiles: string[];
    syntheticPae?: boolean;
    looksLikePLDDTs: boolean;
  };
}

export interface SelectionState {
  hoveredResidues: number[];
  pinnedResidues: number[];
  hoveredCell: { x: number; y: number } | null;
  viewport: MatrixViewport;
}

export interface MatrixViewport {
  xStart: number;
  xEnd: number;
  yStart: number;
  yEnd: number;
}

export interface DiscoveryGroup {
  id: string;
  name: string;
  suggestedSource: PredictionSource | null;
  structureOptions: string[];
  paeJsonOptions: string[];
  scoreJsonOptions: string[];
  confidenceJsonOptions: string[];
  summaryJsonOptions: string[];
  matchedFiles: string[];
  unresolved: boolean;
  reasons: string[];
}

export interface BundleChoice {
  structure?: string;
  paeJson?: string;
  scoreJson?: string;
  confidenceJson?: string;
  summaryJson?: string;
}

export interface DiscoveryResponse {
  groups: DiscoveryGroup[];
}

export interface LoadResponse {
  bundle: PredictionBundle;
}

export interface ParsedResidue {
  chainId: string;
  entityId?: string;
  labelSeqId: number;
  authSeqId: number;
  compId: string;
  moleculeType: MoleculeType;
  code: string;
  atomStart: number;
  atomEnd: number;
  confidenceFromStructure: number;
}

export interface ParsedStructure {
  residues: ParsedResidue[];
  looksLikePLDDTs: boolean;
}
