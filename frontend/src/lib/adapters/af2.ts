import { parseStructure } from '../parsers/structure';
import type { BundleChoice, DiscoveryGroup, PredictionBundle, WorkerInputFile } from '../types';
import { normalizeStem } from '../utils';
import { ensureSquareMatrix, makeBundle, requireFile, structureFormatFromName } from './helpers';

function looksLikeAf2Pae(json: unknown): json is { predicted_aligned_error: number[][]; max_predicted_aligned_error?: number } {
  return Boolean(
    json &&
      typeof json === 'object' &&
      'predicted_aligned_error' in json &&
      Array.isArray((json as { predicted_aligned_error: unknown }).predicted_aligned_error),
  );
}

export function canLoadAf2(group: DiscoveryGroup): boolean {
  return group.structureOptions.length > 0 && group.paeJsonOptions.length > 0 && group.suggestedSource === 'af2';
}

export function loadAf2Bundle(files: WorkerInputFile[], group: DiscoveryGroup, choice: BundleChoice): PredictionBundle {
  const structureName = choice.structure ?? group.structureOptions[0];
  const paeName = choice.paeJson ?? group.paeJsonOptions[0];
  if (!structureName || !paeName) throw new Error(`Group ${group.name} is missing AF2 files`);

  const structureFile = requireFile(files, structureName);
  const format = structureFormatFromName(structureFile.name);
  if (!format) throw new Error(`Unsupported structure format for ${structureFile.name}`);
  const parsedStructure = parseStructure(structureFile.text, format);

  const paeFile = requireFile(files, paeName);
  const parsedJson = JSON.parse(paeFile.text);
  const paeObject = Array.isArray(parsedJson) ? parsedJson[0] : parsedJson;
  if (!looksLikeAf2Pae(paeObject)) {
    throw new Error(`File ${paeName} is not an AF2/AFDB PAE JSON`);
  }
  const paeMatrix = ensureSquareMatrix(paeObject.predicted_aligned_error);

  return makeBundle({
    id: group.id,
    name: normalizeStem(group.name),
    source: 'af2',
    structure: { fileName: structureName, format },
    parsedStructure,
    paeMatrix,
    paeMax: Number(paeObject.max_predicted_aligned_error ?? Math.max(...paeMatrix.flat())),
    matchedFiles: [structureName, paeName],
    warnings: parsedStructure.residues.length !== paeMatrix.length ? ['Structure residue count and PAE size differ; residues were trimmed to polymer count.'] : [],
  });
}
