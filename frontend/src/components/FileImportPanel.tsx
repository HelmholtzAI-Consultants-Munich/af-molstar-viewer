import type { ChangeEvent, DragEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import type { DiscoveryGroup, WorkerInputFile } from '../lib/types';
import { EXAMPLES } from '../features/import/examples';

interface FileImportPanelProps {
  groups: DiscoveryGroup[];
  currentGroupId: string | null;
  onLoadFiles: (files: File[]) => Promise<void>;
  onLoadExample: (files: WorkerInputFile[]) => Promise<void>;
  onSelectGroup: (groupId: string) => void;
  loading: boolean;
}

async function walkDirectory(handle: FileSystemDirectoryHandle): Promise<File[]> {
  const files: File[] = [];
  // A tiny recursive walker keeps the browser-side folder picker useful without a backend.
  const values = (handle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
  for await (const entry of values) {
    if (entry.kind === 'file') {
      files.push(await (entry as FileSystemFileHandle).getFile());
    } else {
      files.push(...(await walkDirectory(entry as FileSystemDirectoryHandle)));
    }
  }
  return files;
}

export function FileImportPanel(props: FileImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const resolvedGroups = useMemo(() => props.groups.filter((group) => !group.unresolved), [props.groups]);

  const loadExample = async (exampleId: string) => {
    const example = EXAMPLES.find((entry) => entry.id === exampleId);
    if (!example) return;
    const files = await Promise.all(
      example.files.map(async (entry) => ({
        name: entry.name,
        text:
          typeof entry.text === 'string'
            ? entry.text
            : await fetch(entry.url ?? '').then(async (response) => response.text()),
      })),
    );
    await props.onLoadExample(files);
  };

  const handleFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? [...event.target.files] : [];
    if (files.length > 0) {
      await props.onLoadFiles(files);
    }
    event.target.value = '';
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length > 0) {
      await props.onLoadFiles(files);
    }
  };

  const openDirectory = async () => {
    if ('showDirectoryPicker' in window) {
      const handle = await window.showDirectoryPicker!();
      const files = await walkDirectory(handle);
      if (files.length > 0) await props.onLoadFiles(files);
      return;
    }
    folderInputRef.current?.click();
  };

  return (
    <section className="panel controls-panel">
      <div
        className={`dropzone ${isDragging ? 'dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setIsDragging(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="dropzone-copy">
          <p className="lede">
            Drop AlphaFold or ColabFold result files here, or load one of the bundled examples.
          </p>
        </div>
        <div className="control-grid">
          <button
            type="button"
            className="primary-button control-choose-files"
            onClick={() => fileInputRef.current?.click()}
            disabled={props.loading}
          >
            Choose files
          </button>
          <select
            aria-label="Load example"
            className="select-input control-load-example"
            onChange={(event) => {
              if (event.target.value) void loadExample(event.target.value);
              event.target.value = '';
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Load example…
            </option>
            {EXAMPLES.map((example) => (
              <option key={example.id} value={example.id}>
                {example.label}
              </option>
            ))}
          </select>
          <button type="button" className="secondary-button control-choose-folder" onClick={openDirectory} disabled={props.loading}>
            Choose folder
          </button>
          <select
            aria-label="Prediction chooser"
            className="select-input control-select-prediction"
            value={props.currentGroupId ?? ''}
            onChange={(event) => props.onSelectGroup(event.target.value)}
            disabled={resolvedGroups.length === 0}
          >
            <option value="" disabled>
              Select prediction…
            </option>
            {resolvedGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
        <input ref={fileInputRef} hidden multiple type="file" onChange={handleFileInput} />
        <input ref={folderInputRef} hidden multiple type="file" onChange={handleFileInput} {...({ webkitdirectory: 'true' } as object)} />
      </div>
    </section>
  );
}
