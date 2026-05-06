import type { LoadedViewerArtifact, ViewerArtifactSource } from '../../domain/project-types';
import { discoverGroups, loadBundle } from '../discovery';
import type { WorkerInputFile } from '../types';

export async function loadViewerArtifact(source: ViewerArtifactSource): Promise<LoadedViewerArtifact> {
  const files: WorkerInputFile[] = await Promise.all(
    source.files.map(async (file) => ({
      name: file.name,
      text:
        typeof file.text === 'string'
          ? file.text
          : await fetch(file.url ?? '').then(async (response) => {
              if (!response.ok) {
                throw new Error(`Unable to fetch ${file.name}`);
              }
              return response.text();
            }),
    })),
  );
  const groups = discoverGroups(files);
  const preferredGroup = groups.find((group) => !group.unresolved) ?? groups[0];
  if (!preferredGroup) {
    throw new Error(`No loadable viewer group found for ${source.label}`);
  }
  const bundle = loadBundle(files, preferredGroup);
  const structureText = files.find((file) => file.name === bundle.structure.fileName)?.text ?? '';
  if (!structureText) {
    throw new Error(`Missing structure text for ${bundle.structure.fileName}`);
  }
  console.debug('[ViewerArtifactLoaded]', {
    artifactId: source.artifact_id,
    label: source.label,
    structureFile: bundle.structure.fileName,
    format: bundle.structure.format,
    residueCount: bundle.residues.length,
    chainIds: bundle.chains.map((chain) => chain.chainId),
  });
  return {
    artifactId: source.artifact_id,
    label: source.label,
    bundle,
    structureText,
  };
}
