/// <reference types="vite/client" />

interface Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

declare module 'pdbe-molstar/lib/viewer.js' {
  export class PDBeMolstarPlugin {
    plugin: any;
    static UIComponents: {
      SequenceView: any;
      PDBeViewport: any;
    };
    render(
      target: HTMLElement | string | Array<{ target: HTMLElement | string; component: any; props?: Record<string, unknown> }>,
      options: {
        customData?: {
          url: string;
          format: 'cif' | 'mmcif' | 'pdb' | 'ent';
          binary?: boolean;
        };
        alphafoldView?: boolean;
        visualStyle?: string | Record<string, unknown>;
        bgColor?: { r: number; g: number; b: number };
        hideCanvasControls?: string[];
        leftPanel?: boolean;
        rightPanel?: boolean;
        logPanel?: boolean;
        sequencePanel?: boolean;
        hideControls?: boolean;
        selectInteraction?: boolean;
      },
    ): Promise<void>;
    clear(): Promise<void>;
    visual: {
      highlight(params: { data: Array<Record<string, unknown>>; focus?: boolean; color?: unknown }): Promise<void>;
      clearHighlight(): Promise<void>;
      interactivityFocus(params: {
        data: Array<Record<string, unknown>>;
        structureId?: string;
        structureNumber?: number;
      }): Promise<void>;
      select(params: {
        data: Array<Record<string, unknown> & { focus?: boolean; color?: unknown }>;
        nonSelectedColor?: unknown;
      }): Promise<void>;
      clearSelection(): Promise<void>;
      sequenceColor(params: {
        data: Array<Record<string, unknown> & { color?: unknown }>;
        nonSelectedColor?: unknown;
        theme?: {
          name: string;
          params?: Record<string, unknown>;
          themeStrength?: number;
          dilutionColor?: unknown;
        };
      }): Promise<void>;
      reset(params: {
        camera?: boolean;
        theme?: boolean;
        highlightColor?: boolean;
        selectColor?: boolean;
      }): Promise<void>;
    };
    selectionMode?:boolean;
  }
}
