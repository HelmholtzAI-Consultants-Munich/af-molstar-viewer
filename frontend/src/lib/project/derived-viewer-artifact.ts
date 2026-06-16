import { discoverGroups, loadBundle } from '../discovery';
import { canonicalizeSelectionDraft, selectionDraftToChainRanges } from '../../domain/target-interface';
import type { ViewerArtifactSource, ViewerFileRef } from '../../domain/project-types';

type DerivedOperation = 'cropped' | 'cut';

export function buildDerivedViewerArtifactSource(
  sourceArtifact: ViewerArtifactSource,
  operation: DerivedOperation,
  selection: string,
  derivedStructureName: string,
): ViewerArtifactSource {
  const files = sourceArtifact.files.map((file) => {
    if (typeof file.text !== 'string') {
      throw new Error(`Missing in-memory text for ${file.name}`);
    }
    return {
      name: file.name,
      text: file.text,
    };
  });
  const groups = discoverGroups(files);
  const preferredGroup = groups.find((group) => !group.unresolved) ?? groups[0];
  if (!preferredGroup) {
    throw new Error(`No loadable viewer group found for ${sourceArtifact.label}`);
  }
  const bundle = loadBundle(files, preferredGroup);
  const structureFile = files.find((file) => file.name === bundle.structure.fileName);
  if (!structureFile) {
    throw new Error(`Missing structure file ${bundle.structure.fileName}`);
  }

  const canonicalSelection = canonicalizeSelectionDraft(selection);
  const ranges = selectionDraftToChainRanges(canonicalSelection);
  const keepSelected = operation === 'cropped';
  const keptResidueIndices = bundle.residues
    .map((residue, index) => ({ residue, index }))
    .filter(({ residue }) =>
      ranges.some(
        (range) =>
          residue.chainId === range.chainId &&
          residue.authSeqId >= range.start &&
          residue.authSeqId <= range.end,
      ) === keepSelected,
    )
    .map(({ index }) => index);

  const structureText = cropStructureText(
    structureFile.text,
    bundle.structure.format,
    ranges,
    keepSelected,
  );

  const derivedFiles: ViewerFileRef[] = [];
  for (const file of sourceArtifact.files) {
    if (file.name === bundle.structure.fileName) {
      derivedFiles.push({
        name: derivedStructureName,
        text: structureText,
      });
      continue;
    }

    const text = typeof file.text === 'string' ? file.text : undefined;
    if (!text) {
      derivedFiles.push({ ...file });
      continue;
    }

    const derivedText = cropConfidenceFile(text, keptResidueIndices, bundle.residues);
    derivedFiles.push({
      name: file.name,
      text: derivedText,
    });
  }

  return {
    artifact_id: sourceArtifact.artifact_id,
    label: sourceArtifact.label,
    files: derivedFiles,
  };
}

function cropConfidenceFile(text: string, keptResidueIndices: number[], residues: { atomStart: number; atomEnd: number }[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }

  if (isAf3Confidence(parsed)) {
    const payload = (Array.isArray(parsed) ? parsed[0] : parsed) as any;
    payload.pae = projectMatrix(payload.pae ?? [], keptResidueIndices);
    payload.atom_plddts = projectAtomValues(payload.atom_plddts ?? [], keptResidueIndices, residues);
    if (Array.isArray(payload.token_chain_ids)) payload.token_chain_ids = projectResidueValues(payload.token_chain_ids, keptResidueIndices);
    if (Array.isArray(payload.token_res_ids)) payload.token_res_ids = projectResidueValues(payload.token_res_ids, keptResidueIndices);
    if (Array.isArray(payload.token_res_names)) payload.token_res_names = projectResidueValues(payload.token_res_names, keptResidueIndices);
    return JSON.stringify(parsed);
  }

  if (isAf2Pae(parsed)) {
    const payload = (Array.isArray(parsed) ? parsed[0] : parsed) as any;
    payload.predicted_aligned_error = projectMatrix(payload.predicted_aligned_error, keptResidueIndices);
    if (typeof payload.max_predicted_aligned_error === 'number') {
      payload.max_predicted_aligned_error = matrixMax(payload.predicted_aligned_error);
    }
    return JSON.stringify(parsed);
  }

  if (isColabFoldScores(parsed)) {
    const payload = parsed as any;
    if (Array.isArray(payload.pae)) {
      payload.pae = projectMatrix(payload.pae, keptResidueIndices);
      if (typeof payload.max_pae === 'number') payload.max_pae = matrixMax(payload.pae);
    }
    if (Array.isArray(payload.predicted_aligned_error)) {
      payload.predicted_aligned_error = projectMatrix(payload.predicted_aligned_error, keptResidueIndices);
      if (typeof payload.max_predicted_aligned_error === 'number') {
        payload.max_predicted_aligned_error = matrixMax(payload.predicted_aligned_error);
      }
    }
    if (Array.isArray(payload.plddt)) {
      payload.plddt = projectResidueValues(payload.plddt, keptResidueIndices);
    }
    return JSON.stringify(parsed);
  }

  return text;
}

function cropStructureText(
  text: string,
  format: 'pdb' | 'cif',
  ranges: ReturnType<typeof selectionDraftToChainRanges>,
  keepSelected: boolean,
): string {
  return format === 'pdb'
    ? cropPdbText(text, ranges, keepSelected)
    : cropMmCifText(text, ranges, keepSelected);
}

function cropPdbText(text: string, ranges: ReturnType<typeof selectionDraftToChainRanges>, keepSelected: boolean): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];
  for (const line of lines) {
    const record = line.slice(0, 6).trim();
    if (record === 'ATOM' || record === 'HETATM') {
      const chainId = line.slice(21, 22).trim() || 'A';
      const seq = Number(line.slice(22, 26).trim());
      const selected = ranges.some((range) => range.chainId === chainId && seq >= range.start && seq <= range.end);
      if (selected === keepSelected) {
        output.push(line);
      }
      continue;
    }
    if (record === 'TER') continue;
    output.push(line);
  }
  if (!output.some((line) => line.startsWith('END'))) {
    output.push('END');
  }
  return `${output.join('\n')}\n`;
}

function cropMmCifText(text: string, ranges: ReturnType<typeof selectionDraftToChainRanges>, keepSelected: boolean): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() !== 'loop_') {
      output.push(line);
      index += 1;
      continue;
    }

    const loopStart = index;
    index += 1;
    const columns: string[] = [];
    while (index < lines.length && lines[index].trim().startsWith('_')) {
      columns.push(lines[index].trim());
      index += 1;
    }

    const rowLines: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index].trim();
      if (!candidate || candidate === '#' || candidate === 'loop_' || candidate.startsWith('_') || candidate.startsWith('data_')) {
        break;
      }
      rowLines.push(lines[index]);
      index += 1;
    }

    const prefix = columns[0]?.split('.')[0];
    const filteredRows =
      prefix === '_atom_site'
        ? rowLines.filter((row) => _keepAtomSiteRow(row, columns, ranges, keepSelected))
        : rowLines;

    output.push(lines[loopStart]);
    output.push(...lines.slice(loopStart + 1, loopStart + 1 + columns.length));
    output.push(...filteredRows);

    if (index < lines.length && lines[index].trim() === '#') {
      output.push(lines[index]);
      index += 1;
    }
  }

  return `${output.join('\n')}\n`;
}

function _keepAtomSiteRow(
  row: string,
  columns: string[],
  ranges: ReturnType<typeof selectionDraftToChainRanges>,
  keepSelected: boolean,
): boolean {
  const tokens = row.match(/'(?:[^']*)'|"(?:[^"]*)"|\S+/g) ?? [];
  if (tokens.length !== columns.length) {
    return true;
  }
  const chainIndex = columns.findIndex((column) => column === '_atom_site.label_asym_id' || column === '_atom_site.auth_asym_id');
  const seqIndex = columns.findIndex((column) =>
    column === '_atom_site.auth_seq_id' ||
    column === '_atom_site.label_seq_id',
  );
  if (chainIndex < 0 || seqIndex < 0) {
    return true;
  }
  const chainId = tokens[chainIndex].replace(/^['"]|['"]$/g, '');
  const seq = Number(tokens[seqIndex].replace(/^['"]|['"]$/g, ''));
  if (!Number.isFinite(seq)) {
    return true;
  }
  const selected = ranges.some((range) => range.chainId === chainId && seq >= range.start && seq <= range.end);
  return selected === keepSelected;
}

function projectMatrix(matrix: number[][], keptIndices: number[]): number[][] {
  return keptIndices.map((rowIndex) => keptIndices.map((columnIndex) => Number(matrix[rowIndex]?.[columnIndex] ?? 0)));
}

function projectResidueValues<T>(values: T[], keptIndices: number[]): T[] {
  return keptIndices.map((index) => values[index]).filter((value): value is T => value !== undefined);
}

function projectAtomValues<T>(values: T[], keptIndices: number[], residues: { atomStart: number; atomEnd: number }[]): T[] {
  const projected: T[] = [];
  for (const residueIndex of keptIndices) {
    const residue = residues[residueIndex];
    projected.push(...values.slice(residue.atomStart, residue.atomEnd + 1));
  }
  return projected;
}

function matrixMax(matrix: number[][]): number {
  return matrix.length === 0 ? 0 : Math.max(...matrix.flat());
}

function isAf3Confidence(value: unknown): value is { pae: number[][]; atom_plddts: number[]; token_chain_ids?: string[]; token_res_ids?: number[]; token_res_names?: string[] } | Array<{ pae: number[][]; atom_plddts: number[]; token_chain_ids?: string[]; token_res_ids?: number[]; token_res_names?: string[] }> {
  const candidate = Array.isArray(value) ? value[0] : value;
  return Boolean(candidate && typeof candidate === 'object' && 'pae' in candidate && 'atom_plddts' in candidate);
}

function isAf2Pae(value: unknown): value is Array<{ predicted_aligned_error: number[][]; max_predicted_aligned_error?: number }> | { predicted_aligned_error: number[][]; max_predicted_aligned_error?: number } {
  const candidate = Array.isArray(value) ? value[0] : value;
  return Boolean(candidate && typeof candidate === 'object' && 'predicted_aligned_error' in candidate);
}

function isColabFoldScores(value: unknown): value is {
  plddt?: number[];
  pae?: number[][];
  predicted_aligned_error?: number[][];
  max_pae?: number;
  max_predicted_aligned_error?: number;
} {
  return Boolean(value && typeof value === 'object' && ('plddt' in value || 'pae' in value || 'predicted_aligned_error' in value));
}
