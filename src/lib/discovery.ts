import type { BundleChoice, DiscoveryGroup, PredictionBundle, PredictionSource, WorkerInputFile } from './types';
import { normalizeStem } from './utils';
import { canLoadAf2, loadAf2Bundle } from './adapters/af2';
import { canLoadAf3, loadAf3Bundle } from './adapters/af3';
import { canLoadColabFold, loadColabFoldBundle } from './adapters/colabfold';

function guessSource(group: Omit<DiscoveryGroup, 'suggestedSource' | 'unresolved' | 'reasons'>): PredictionSource | null {
  if (group.confidenceJsonOptions.length > 0) return 'af3';
  if (group.scoreJsonOptions.length > 0) return 'colabfold';
  if (group.paeJsonOptions.length > 0) return 'af2';
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

export function discoverGroups(files: WorkerInputFile[]): DiscoveryGroup[] {
  const grouped = new Map<string, Omit<DiscoveryGroup, 'suggestedSource' | 'unresolved' | 'reasons'>>();

  for (const file of files) {
    const stem = normalizeStem(file.name);
    const existing =
      grouped.get(stem) ??
      {
        id: stem,
        name: stem,
        structureOptions: [],
        paeJsonOptions: [],
        scoreJsonOptions: [],
        confidenceJsonOptions: [],
        summaryJsonOptions: [],
        matchedFiles: [],
      };
    existing.matchedFiles.push(file.name);
    if (isStructureFile(file.name)) existing.structureOptions.push(file.name);
    else if (isConfidenceJson(file.name)) existing.confidenceJsonOptions.push(file.name);
    else if (isSummaryJson(file.name)) existing.summaryJsonOptions.push(file.name);
    else if (isPaeJson(file.name)) existing.paeJsonOptions.push(file.name);
    else if (isScoreJson(file.name)) existing.scoreJsonOptions.push(file.name);
    grouped.set(stem, existing);
  }

  return [...grouped.values()].map((group) => {
    const suggestedSource = guessSource(group);
    const reasons: string[] = [];
    if (group.structureOptions.length > 1) reasons.push('Multiple structure files');
    if (group.paeJsonOptions.length > 1) reasons.push('Multiple AF2 PAE JSON files');
    if (group.scoreJsonOptions.length > 1) reasons.push('Multiple ColabFold score JSON files');
    if (group.confidenceJsonOptions.length > 1) reasons.push('Multiple AF3 confidence JSON files');
    if (suggestedSource === 'af2' && group.structureOptions.length === 0) reasons.push('Missing structure file');
    if (suggestedSource === 'colabfold' && group.scoreJsonOptions.length === 0) reasons.push('Missing ColabFold scores JSON');
    if (suggestedSource === 'af3' && group.confidenceJsonOptions.length === 0) reasons.push('Missing AF3 confidences JSON');

    return {
      ...group,
      suggestedSource,
      unresolved: reasons.length > 0,
      reasons,
    };
  });
}

export function loadBundle(files: WorkerInputFile[], group: DiscoveryGroup, choice: BundleChoice = {}): PredictionBundle {
  if (canLoadAf3(group)) return loadAf3Bundle(files, group, choice);
  if (canLoadColabFold(group)) return loadColabFoldBundle(files, group, choice);
  if (canLoadAf2(group)) return loadAf2Bundle(files, group, choice);
  throw new Error(`Unable to determine adapter for ${group.name}`);
}
