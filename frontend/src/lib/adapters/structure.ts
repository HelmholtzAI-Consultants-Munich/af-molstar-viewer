import { parseStructure } from '../parsers/structure';
import type { BundleChoice, DiscoveryGroup, PredictionBundle, WorkerInputFile } from '../types';
import { normalizeStem } from '../utils';
import { makeBundle, requireFile, structureFormatFromName } from './helpers';

const SYNTHETIC_PAE_MAX = 30;

function createSyntheticPaeMatrix(size: number): number[][] {
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => (x === y ? 0 : SYNTHETIC_PAE_MAX)),
  );
}

export function canLoadStructure(group: DiscoveryGroup): boolean {
  return group.structureOptions.length > 0 && group.suggestedSource === 'structure';
}

export function loadStructureBundle(files: WorkerInputFile[], group: DiscoveryGroup, choice: BundleChoice): PredictionBundle {
  const structureName = choice.structure ?? group.structureOptions[0];
  if (!structureName) throw new Error(`Group ${group.name} is missing a structure file`);

  const structureFile = requireFile(files, structureName);
  const format = structureFormatFromName(structureFile.name);
  if (!format) throw new Error(`Unsupported structure format for ${structureFile.name}`);

  const parsedStructure = parseStructure(structureFile.text, format);
  const polymerCount = parsedStructure.residues.filter((residue) => residue.moleculeType !== 'ligand').length;
  if (polymerCount === 0) {
    throw new Error(`File ${structureName} does not contain a polymer chain that can be shown in the viewer`);
  }

  return makeBundle({
    id: group.id,
    name: normalizeStem(group.name),
    source: 'structure',
    structure: { fileName: structureName, format },
    parsedStructure,
    paeMatrix: createSyntheticPaeMatrix(polymerCount),
    paeMax: SYNTHETIC_PAE_MAX,
    matchedFiles: [structureName],
    syntheticPae: true,
  });
}
