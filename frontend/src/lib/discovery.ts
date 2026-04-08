import type { BundleChoice, DiscoveryGroup, PredictionBundle, PredictionSource, WorkerInputFile } from './types';
import { structureFormatFromName } from './adapters/helpers';
import { normalizeStem } from './utils';
import { canLoadAf2, loadAf2Bundle } from './adapters/af2';
import { canLoadAf3, loadAf3Bundle } from './adapters/af3';
import { canLoadColabFold, loadColabFoldBundle } from './adapters/colabfold';
import { canLoadStructure, loadStructureBundle } from './adapters/structure';
import { parseStructure } from './parsers/structure';

function guessSource(group: Omit<DiscoveryGroup, 'suggestedSource' | 'unresolved' | 'reasons'>): PredictionSource | null {
  if (group.confidenceJsonOptions.length > 0) return 'af3';
  if (group.scoreJsonOptions.length > 0) return 'colabfold';
  if (group.paeJsonOptions.length > 0) return 'af2';
  if (group.structureOptions.length > 0) return 'structure';
  return null;
}

function isStructureFile(name: string): boolean {
  return /\.(?:pdb|cif|mmcif)$/i.test(name);
}

function isConfidenceJson(name: string): boolean {
  return /confidences\.json$/i.test(name) && !isSummaryJson(name);
}

function isSummaryJson(name: string): boolean {
  return /summary_confidences\.json$/i.test(name);
}

function isPaeJson(name: string): boolean {
  return /predicted_aligned_error/i.test(name);
}

function isScoreJson(name: string): boolean {
  return /(scores?|result_model_\d+|full_data_\d+)\.json$/i.test(name) && !isPaeJson(name) && !isConfidenceJson(name);
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function looksLikeAf2PaeJson(json: unknown): boolean {
  const paeObject = Array.isArray(json) ? json[0] : json;
  return Boolean(
    paeObject &&
      typeof paeObject === 'object' &&
      'predicted_aligned_error' in paeObject &&
      Array.isArray((paeObject as { predicted_aligned_error: unknown }).predicted_aligned_error),
  );
}

function looksLikeAf3ConfidenceJson(json: unknown): boolean {
  return Boolean(json && typeof json === 'object' && 'pae' in (json as object) && 'atom_plddts' in (json as object));
}

function looksLikeColabFoldScoreJson(json: unknown): boolean {
  return Boolean(
    json &&
      typeof json === 'object' &&
      ('plddt' in (json as object) || 'pae' in (json as object) || 'predicted_aligned_error' in (json as object)),
  );
}

interface GroupDraft {
  id: string;
  name: string;
  structureOptions: string[];
  paeJsonOptions: string[];
  scoreJsonOptions: string[];
  confidenceJsonOptions: string[];
  summaryJsonOptions: string[];
  matchedFiles: string[];
}

interface CandidateMatch<TJson extends JsonCandidate> {
  structure: StructureCandidate;
  json: TJson;
  score: number;
}

interface StructureCandidate {
  file: WorkerInputFile;
  stem: string;
  polymerCount: number;
  atomCount: number;
  residueKeys: string[];
  residueConfidence: number[];
}

type JsonCandidate =
  | {
      file: WorkerInputFile;
      stem: string;
      kind: 'af2';
      paeSize: number | null;
    }
  | {
      file: WorkerInputFile;
      stem: string;
      kind: 'colabfold';
      paeSize: number | null;
      plddt: number[] | null;
    }
  | {
      file: WorkerInputFile;
      stem: string;
      kind: 'af3';
      paeSize: number | null;
      atomPlddtCount: number | null;
      tokenResidueKeys: string[] | null;
    }
  | {
      file: WorkerInputFile;
      stem: string;
      kind: 'summary';
    }
  | {
      file: WorkerInputFile;
      stem: string;
      kind: 'unknown';
    };

function createDraft(id: string, name: string): GroupDraft {
  return {
    id,
    name,
    structureOptions: [],
    paeJsonOptions: [],
    scoreJsonOptions: [],
    confidenceJsonOptions: [],
    summaryJsonOptions: [],
    matchedFiles: [],
  };
}

function finalizeGroup(group: GroupDraft): DiscoveryGroup {
  const suggestedSource = guessSource(group);
  const reasons: string[] = [];
  if (suggestedSource === null) reasons.push('No supported metadata file found');
  if (suggestedSource === 'af2' && group.structureOptions.length === 0) reasons.push('Missing structure file');
  if (suggestedSource === 'colabfold' && group.structureOptions.length === 0) reasons.push('Missing structure file');
  if (suggestedSource === 'af3' && group.structureOptions.length === 0) reasons.push('Missing structure file');

  return {
    ...group,
    suggestedSource,
    unresolved: reasons.length > 0,
    reasons,
  };
}

function getPaeSize(matrix: unknown): number | null {
  return Array.isArray(matrix) && Array.isArray(matrix[0]) ? matrix.length : null;
}

function meanAbsoluteDifference(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs(Number(left[index]) - Number(right[index]));
  }
  return total / length;
}

function sameResidueKeys(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function structureCandidate(file: WorkerInputFile): StructureCandidate | null {
  const format = structureFormatFromName(file.name);
  if (!format) return null;
  const parsed = parseStructure(file.text, format);
  const polymerResidues = parsed.residues.filter((residue) => residue.moleculeType !== 'ligand');
  const atomCount = parsed.residues.length === 0 ? 0 : Math.max(...parsed.residues.map((residue) => residue.atomEnd)) + 1;

  return {
    file,
    stem: normalizeStem(file.name),
    polymerCount: polymerResidues.length,
    atomCount,
    residueKeys: polymerResidues.map((residue) => `${residue.chainId}:${residue.labelSeqId}:${residue.compId}`),
    residueConfidence: polymerResidues.map((residue) => residue.confidenceFromStructure),
  };
}

function jsonCandidate(file: WorkerInputFile): JsonCandidate {
  const stem = normalizeStem(file.name);
  if (isSummaryJson(file.name)) return { file, stem, kind: 'summary' };

  const parsedJson = tryParseJson(file.text);
  if (isConfidenceJson(file.name) || looksLikeAf3ConfidenceJson(parsedJson)) {
    const json = parsedJson as {
      pae?: unknown;
      atom_plddts?: unknown;
      token_chain_ids?: unknown;
      token_res_ids?: unknown;
      token_res_names?: unknown;
    } | null;
    const tokenChainIds = Array.isArray(json?.token_chain_ids) ? json?.token_chain_ids.map(String) : null;
    const tokenResIds = Array.isArray(json?.token_res_ids) ? json?.token_res_ids.map(Number) : null;
    const tokenResNames = Array.isArray(json?.token_res_names) ? json?.token_res_names.map(String) : null;
    const tokenResidueKeys =
      tokenChainIds && tokenResIds && tokenResNames && tokenChainIds.length === tokenResIds.length && tokenResIds.length === tokenResNames.length
        ? tokenChainIds.map((chainId, index) => `${chainId}:${tokenResIds[index]}:${tokenResNames[index]}`)
        : null;
    return {
      file,
      stem,
      kind: 'af3',
      paeSize: getPaeSize(json?.pae),
      atomPlddtCount: Array.isArray(json?.atom_plddts) ? json.atom_plddts.length : null,
      tokenResidueKeys,
    };
  }

  if (isPaeJson(file.name) || looksLikeAf2PaeJson(parsedJson)) {
    const paeObject = Array.isArray(parsedJson) ? parsedJson[0] : parsedJson;
    return {
      file,
      stem,
      kind: 'af2',
      paeSize: getPaeSize((paeObject as { predicted_aligned_error?: unknown } | null)?.predicted_aligned_error),
    };
  }

  if (isScoreJson(file.name) || looksLikeColabFoldScoreJson(parsedJson)) {
    const json = parsedJson as { plddt?: unknown; pae?: unknown; predicted_aligned_error?: unknown } | null;
    return {
      file,
      stem,
      kind: 'colabfold',
      paeSize: getPaeSize(json?.pae) ?? getPaeSize(json?.predicted_aligned_error),
      plddt: Array.isArray(json?.plddt) ? json.plddt.map(Number) : null,
    };
  }

  return { file, stem, kind: 'unknown' };
}

function compatibilityScore(structure: StructureCandidate, json: JsonCandidate): number | null {
  const stemBonus = structure.stem === json.stem ? 0.01 : 0;

  if (json.kind === 'af2') {
    return json.paeSize === structure.polymerCount ? 1 + stemBonus : null;
  }

  if (json.kind === 'colabfold') {
    const countCompatible =
      (json.plddt?.length ?? null) === structure.polymerCount ||
      (json.paeSize ?? null) === structure.polymerCount;
    if (!countCompatible) return null;

    if (json.plddt && json.plddt.length === structure.residueConfidence.length) {
      const difference = meanAbsoluteDifference(structure.residueConfidence, json.plddt);
      if (difference > 0.5) return null;
      return 10 - difference + stemBonus;
    }

    return 1 + stemBonus;
  }

  if (json.kind === 'af3') {
    if (json.tokenResidueKeys && sameResidueKeys(structure.residueKeys, json.tokenResidueKeys)) {
      return 10 + stemBonus;
    }
    if ((json.atomPlddtCount ?? null) === structure.atomCount) {
      return 5 + stemBonus;
    }
    if ((json.paeSize ?? null) === structure.polymerCount) {
      return 1 + stemBonus;
    }
    return null;
  }

  return null;
}

function buildMatches<TJson extends JsonCandidate>(
  structures: StructureCandidate[],
  jsons: TJson[],
): CandidateMatch<TJson>[] {
  return structures
    .flatMap((structure) =>
      jsons
        .map((json) => ({ structure, json, score: compatibilityScore(structure, json) }))
        .filter((entry): entry is CandidateMatch<TJson> => entry.score !== null),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.structure.file.name.localeCompare(right.structure.file.name) ||
        left.json.file.name.localeCompare(right.json.file.name),
    );
}

function assignBestMatches<TJson extends JsonCandidate>(
  structures: StructureCandidate[],
  jsons: TJson[],
): Map<string, TJson> {
  const assignments = new Map<string, TJson>();
  const usedStructures = new Set<string>();
  const usedJsons = new Set<string>();

  for (const match of buildMatches(structures, jsons)) {
    const structureName = match.structure.file.name;
    const jsonName = match.json.file.name;
    if (usedStructures.has(structureName) || usedJsons.has(jsonName)) continue;
    usedStructures.add(structureName);
    usedJsons.add(jsonName);
    assignments.set(structureName, match.json);
  }

  return assignments;
}

export function discoverGroups(files: WorkerInputFile[]): DiscoveryGroup[] {
  const structures = files.map(structureCandidate).filter((entry): entry is StructureCandidate => entry !== null);
  const jsons = files
    .filter((file) => !isStructureFile(file.name))
    .map(jsonCandidate);
  const af2Jsons = jsons.filter((json): json is Extract<JsonCandidate, { kind: 'af2' }> => json.kind === 'af2');
  const colabfoldJsons = jsons.filter((json): json is Extract<JsonCandidate, { kind: 'colabfold' }> => json.kind === 'colabfold');
  const af3ConfidenceJsons = jsons.filter((json): json is Extract<JsonCandidate, { kind: 'af3' }> => json.kind === 'af3');
  const summaryJsons = jsons.filter((json): json is Extract<JsonCandidate, { kind: 'summary' }> => json.kind === 'summary');

  const matchedJsonFiles = new Set<string>();
  const assignedAf2 = assignBestMatches(structures, af2Jsons);
  const assignedColabFold = assignBestMatches(structures, colabfoldJsons);
  const assignedAf3 = assignBestMatches(structures, af3ConfidenceJsons);
  const groups: DiscoveryGroup[] = [];

  for (const structure of structures) {
    const draft = createDraft(structure.stem, structure.stem);
    draft.structureOptions.push(structure.file.name);
    draft.matchedFiles.push(structure.file.name);

    const af2Json = assignedAf2.get(structure.file.name);
    if (af2Json) {
      matchedJsonFiles.add(af2Json.file.name);
      draft.paeJsonOptions.push(af2Json.file.name);
      draft.matchedFiles.push(af2Json.file.name);
    }

    const colabfoldJson = assignedColabFold.get(structure.file.name);
    if (colabfoldJson) {
      matchedJsonFiles.add(colabfoldJson.file.name);
      draft.scoreJsonOptions.push(colabfoldJson.file.name);
      draft.matchedFiles.push(colabfoldJson.file.name);
    }

    const af3Json = assignedAf3.get(structure.file.name);
    if (af3Json) {
      matchedJsonFiles.add(af3Json.file.name);
      draft.confidenceJsonOptions.push(af3Json.file.name);
      draft.matchedFiles.push(af3Json.file.name);

      const summaryMatch =
        summaryJsons.find((summary) => summary.stem === af3Json.stem) ??
        (summaryJsons.length === 1 ? summaryJsons[0] : undefined);
      if (summaryMatch) {
        matchedJsonFiles.add(summaryMatch.file.name);
        draft.summaryJsonOptions.push(summaryMatch.file.name);
        draft.matchedFiles.push(summaryMatch.file.name);
      }
    }

    groups.push(finalizeGroup(draft));
  }

  const leftovers = new Map<string, GroupDraft>();
  for (const json of jsons) {
    if (matchedJsonFiles.has(json.file.name)) continue;
    const existing = leftovers.get(json.stem) ?? createDraft(json.stem, json.stem);
    existing.matchedFiles.push(json.file.name);
    if (json.kind === 'summary') existing.summaryJsonOptions.push(json.file.name);
    else if (json.kind === 'af2') existing.paeJsonOptions.push(json.file.name);
    else if (json.kind === 'colabfold') existing.scoreJsonOptions.push(json.file.name);
    else if (json.kind === 'af3') existing.confidenceJsonOptions.push(json.file.name);
    leftovers.set(json.stem, existing);
  }

  return [...groups, ...[...leftovers.values()].map(finalizeGroup)];
}

export function loadBundle(files: WorkerInputFile[], group: DiscoveryGroup, choice: BundleChoice = {}): PredictionBundle {
  if (canLoadAf3(group)) return loadAf3Bundle(files, group, choice);
  if (canLoadColabFold(group)) return loadColabFoldBundle(files, group, choice);
  if (canLoadAf2(group)) return loadAf2Bundle(files, group, choice);
  if (canLoadStructure(group)) return loadStructureBundle(files, group, choice);
  throw new Error(`Unable to determine adapter for ${group.name}`);
}
