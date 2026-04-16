import type { ConfidenceCategory, MoleculeType } from './types';

export const AF_CONFIDENCE_COLORS: Record<ConfidenceCategory, string> = {
  'very-high': '#0053d6',
  high: '#65cbf3',
  low: '#ffdb13',
  'very-low': '#ff7d45',
};

export const PAE_COLOR_STOPS = [
  { stop: 0, color: '#0d5b24' },
  { stop: 0.35, color: '#2f8e43' },
  { stop: 0.65, color: '#8cc68f' },
  { stop: 1, color: '#edf4eb' },
];

export const PAE_SELECTION_COLORS = {
  xRange: '#f6ea2a',
  yRange: '#f3a019',
  overlap: '#8fd9c2',
  dimmed: '#8b8f94',
} as const;

export const PAE_PAIR_SELECTION_COLOR = '#ff6699';

export const PROTEIN_CODES: Record<string, string> = {
  ALA: 'A',
  ARG: 'R',
  ASN: 'N',
  ASP: 'D',
  CYS: 'C',
  GLN: 'Q',
  GLU: 'E',
  GLY: 'G',
  HIS: 'H',
  ILE: 'I',
  LEU: 'L',
  LYS: 'K',
  MET: 'M',
  PHE: 'F',
  PRO: 'P',
  SER: 'S',
  THR: 'T',
  TRP: 'W',
  TYR: 'Y',
  VAL: 'V',
  SEC: 'U',
  PYL: 'O',
};

export const NUCLEIC_CODES: Record<string, string> = {
  A: 'A',
  C: 'C',
  G: 'G',
  U: 'U',
  T: 'T',
  DA: 'A',
  DC: 'C',
  DG: 'G',
  DT: 'T',
  DU: 'U',
};

export function confidenceCategory(value: number): ConfidenceCategory {
  if (value > 90) return 'very-high';
  if (value > 70) return 'high';
  if (value > 50) return 'low';
  return 'very-low';
}

export function residueCode(compId: string, moleculeType: MoleculeType): string {
  const normalized = compId.trim().toUpperCase();
  if (moleculeType === 'protein') return PROTEIN_CODES[normalized] ?? 'X';
  if (moleculeType === 'dna' || moleculeType === 'rna') return NUCLEIC_CODES[normalized] ?? 'N';
  return '·';
}

export function classifyChemCompType(type: string | undefined, compId: string): MoleculeType {
  const upperType = type?.toUpperCase() ?? '';
  if (upperType.includes('PEPTIDE')) return 'protein';
  if (upperType.includes('DNA')) return 'dna';
  if (upperType.includes('RNA')) return 'rna';
  const upperComp = compId.toUpperCase();
  if (upperComp in PROTEIN_CODES) return 'protein';
  if (upperComp in NUCLEIC_CODES) return upperComp.startsWith('D') ? 'dna' : 'rna';
  return 'ligand';
}
