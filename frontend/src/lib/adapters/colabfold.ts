import { parseStructure } from '../parsers/structure';
import type { BundleChoice, DiscoveryGroup, PredictionBundle, WorkerInputFile } from '../types';
import { normalizeStem } from '../utils';
import { ensureSquareMatrix, makeBundle, requireFile, structureFormatFromName } from './helpers';

interface ColabFoldScores {
  plddt?: number[];
  pae?: number[][];
  predicted_aligned_error?: number[][];
  max_pae?: number;
  max_predicted_aligned_error?: number;
  ptm?: number;
  iptm?: number;
}

function looksLikeColabFoldScores(json: unknown): json is ColabFoldScores {
  return Boolean(
    json &&
      typeof json === 'object' &&
      ('plddt' in (json as object) || 'pae' in (json as object) || 'predicted_aligned_error' in (json as object)),
  );
}

export function canLoadColabFold(group: DiscoveryGroup): boolean {
  return group.structureOptions.length > 0 && group.scoreJsonOptions.length > 0 && group.suggestedSource === 'colabfold';
}

export function loadColabFoldBundle(files: WorkerInputFile[], group: DiscoveryGroup, choice: BundleChoice): PredictionBundle {
  const structureName = choice.structure ?? group.structureOptions[0];
  const scoreName = choice.scoreJson ?? group.scoreJsonOptions[0];
  if (!structureName || !scoreName) throw new Error(`Group ${group.name} is missing ColabFold files`);

  const structureFile = requireFile(files, structureName);
  const format = structureFormatFromName(structureFile.name);
  if (!format) throw new Error(`Unsupported structure format for ${structureFile.name}`);
  const parsedStructure = parseStructure(structureFile.text, format);

  const scoreFile = requireFile(files, scoreName);
  const parsedJson = JSON.parse(scoreFile.text);
  if (!looksLikeColabFoldScores(parsedJson)) {
    throw new Error(`File ${scoreName} is not a supported ColabFold scores JSON`);
  }

  const polymerCount = parsedStructure.residues.filter((residue) => residue.moleculeType !== 'ligand').length;
  const paeMatrix =
    parsedJson.pae || parsedJson.predicted_aligned_error
      ? ensureSquareMatrix(parsedJson.pae ?? parsedJson.predicted_aligned_error ?? [])
      : Array.from({ length: polymerCount }, () => Array.from({ length: polymerCount }, () => 0));
  const warnings: string[] = [];
  if (!parsedJson.pae && !parsedJson.predicted_aligned_error) {
    warnings.push('No PAE matrix was present in the ColabFold JSON; a zero-filled matrix was synthesized for the viewer.');
  }

  return makeBundle({
    id: group.id,
    name: normalizeStem(group.name),
    source: 'colabfold',
    structure: { fileName: structureName, format },
    parsedStructure,
    paeMatrix,
    paeMax: Number(parsedJson.max_pae ?? parsedJson.max_predicted_aligned_error ?? Math.max(...paeMatrix.flat())),
    summary: {
      ...(typeof parsedJson.ptm === 'number' ? { pTM: parsedJson.ptm } : {}),
      ...(typeof parsedJson.iptm === 'number' ? { ipTM: parsedJson.iptm } : {}),
    },
    matchedFiles: [structureName, scoreName],
    confidenceOverride: parsedJson.plddt?.map(Number),
    warnings:
      parsedJson.plddt && parsedJson.plddt.length !== polymerCount
        ? warnings.concat('pLDDT length does not match parsed polymer residue count; structure confidence was used where needed.')
        : warnings,
  });
}
