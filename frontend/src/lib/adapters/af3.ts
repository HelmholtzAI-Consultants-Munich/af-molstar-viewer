import { parseStructure } from '../parsers/structure';
import type { BundleChoice, DiscoveryGroup, ParsedResidue, PredictionBundle, WorkerInputFile } from '../types';
import { mean, normalizeStem } from '../utils';
import { ensureSquareMatrix, makeBundle, requireFile, structureFormatFromName } from './helpers';

interface Af3ConfidenceJson {
  atom_plddts?: number[];
  atom_chain_ids?: string[];
  token_chain_ids?: string[];
  token_res_ids?: number[];
  token_res_names?: string[];
  pae?: number[][];
}

function looksLikeAf3Confidence(json: unknown): json is Af3ConfidenceJson {
  return Boolean(json && typeof json === 'object' && 'pae' in (json as object) && 'atom_plddts' in (json as object));
}

function buildPolymerTokenProjection(confidenceJson: Af3ConfidenceJson, residues: ParsedResidue[]) {
  const tokenChainIds = confidenceJson.token_chain_ids ?? [];
  const tokenResIds = confidenceJson.token_res_ids ?? [];
  const tokenResNames = confidenceJson.token_res_names ?? [];

  const polymerResidues = residues.filter((residue) => residue.moleculeType !== 'ligand');
  const matchedTokenIndices: number[] = [];

  if (tokenChainIds.length > 0) {
    const seen = new Set<number>();
    for (const residue of polymerResidues) {
      let found = -1;
      for (let index = 0; index < tokenChainIds.length; index += 1) {
        if (seen.has(index)) continue;
        const sameChain = tokenChainIds[index] === residue.chainId;
        const sameSeq = tokenResIds.length === 0 || tokenResIds[index] === residue.labelSeqId || tokenResIds[index] === residue.authSeqId;
        const sameName = tokenResNames.length === 0 || tokenResNames[index] === residue.compId;
        if (sameChain && sameSeq && sameName) {
          found = index;
          break;
        }
      }
      if (found >= 0) {
        seen.add(found);
        matchedTokenIndices.push(found);
      }
    }
  }

  if (matchedTokenIndices.length === polymerResidues.length) {
    return matchedTokenIndices;
  }

  const pae = ensureSquareMatrix(confidenceJson.pae ?? []);
  if (pae.length === polymerResidues.length) {
    return polymerResidues.map((_, index) => index);
  }

  return polymerResidues.map((_, index) => index).filter((index) => index < pae.length);
}

function projectMatrix(matrix: number[][], indices: number[]): number[][] {
  return indices.map((rowIndex) => indices.map((columnIndex) => matrix[rowIndex]?.[columnIndex] ?? 0));
}

function residueConfidencesFromAtoms(atomPlddts: number[], residues: ParsedResidue[]): number[] {
  return residues
    .filter((residue) => residue.moleculeType !== 'ligand')
    .map((residue) => mean(atomPlddts.slice(residue.atomStart, residue.atomEnd + 1).map(Number)));
}

export function canLoadAf3(group: DiscoveryGroup): boolean {
  return group.structureOptions.length > 0 && group.confidenceJsonOptions.length > 0 && group.suggestedSource === 'af3';
}

export function loadAf3Bundle(files: WorkerInputFile[], group: DiscoveryGroup, choice: BundleChoice): PredictionBundle {
  const structureName = choice.structure ?? group.structureOptions[0];
  const confidenceName = choice.confidenceJson ?? group.confidenceJsonOptions[0];
  const summaryName = choice.summaryJson ?? group.summaryJsonOptions[0];
  if (!structureName || !confidenceName) throw new Error(`Group ${group.name} is missing AF3 files`);

  const structureFile = requireFile(files, structureName);
  const format = structureFormatFromName(structureFile.name);
  if (!format) throw new Error(`Unsupported structure format for ${structureFile.name}`);
  const parsedStructure = parseStructure(structureFile.text, format);

  const confidenceFile = requireFile(files, confidenceName);
  const parsedJson = JSON.parse(confidenceFile.text);
  if (!looksLikeAf3Confidence(parsedJson)) {
    throw new Error(`File ${confidenceName} is not a supported AlphaFold 3 confidence JSON`);
  }
  const pae = ensureSquareMatrix(parsedJson.pae ?? []);
  const tokenIndices = buildPolymerTokenProjection(parsedJson, parsedStructure.residues);
  const displayedMatrix = projectMatrix(pae, tokenIndices);
  const confidenceOverride = residueConfidencesFromAtoms(parsedJson.atom_plddts?.map(Number) ?? [], parsedStructure.residues);

  const summary = summaryName ? JSON.parse(requireFile(files, summaryName).text) : {};

  return makeBundle({
    id: group.id,
    name: normalizeStem(group.name),
    source: 'af3',
    structure: { fileName: structureName, format },
    parsedStructure,
    paeMatrix: displayedMatrix,
    paeMax: Math.max(...displayedMatrix.flat()),
    summary: Object.fromEntries(
      Object.entries(summary)
        .filter(([, value]) => typeof value === 'number')
        .map(([key, value]) => [key, Number(value)]),
    ),
    matchedFiles: [structureName, confidenceName, ...(summaryName ? [summaryName] : [])],
    confidenceOverride,
    tokenIndexMap: tokenIndices,
    warnings:
      tokenIndices.length !== parsedStructure.residues.filter((residue) => residue.moleculeType !== 'ligand').length
        ? ['AF3 token projection skipped some non-polymer or unmatched tokens in the 2D confidence view.']
        : [],
  });
}
