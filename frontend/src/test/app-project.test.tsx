import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { createProjectApi } from '../lib/project/project-api';
import { createToyBundle } from './helpers';

vi.mock('../components/project/ArtifactWorkspace', () => ({
  ArtifactWorkspace: ({ artifact }: { artifact: { artifactId: string } }) => (
    <div data-testid="artifact-workspace">{artifact.artifactId}</div>
  ),
}));

vi.mock('../lib/project/load-viewer-artifact', () => ({
  loadViewerArtifact: async (source: { artifact_id: string; label: string }) => ({
    artifactId: source.artifact_id,
    label: source.label,
    bundle: createToyBundle(),
    structureText: 'ATOM',
  }),
}));

describe('project app shell', () => {
  it('saves canonical target interface residue strings', async () => {
    const api = createProjectApi();
    render(<App api={api} />);

    await screen.findByText(/BindCraft Workspace Demo/i);
    const input = await screen.findByDisplayValue('A15-25');
    fireEvent.change(input, { target: { value: 'B20-22,A1-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('A1-10,B20-22')).toBeInTheDocument();
    });
  });
});
