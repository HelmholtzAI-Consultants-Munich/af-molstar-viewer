import { discoverGroups, loadBundle } from '../discovery';
import type { BundleChoice, DiscoveryResponse, LoadResponse, WorkerInputFile } from '../types';

type DiscoverMessage = {
  type: 'discover';
  files: WorkerInputFile[];
};

type LoadMessage = {
  type: 'load';
  files: WorkerInputFile[];
  groupId: string;
  choice?: BundleChoice;
};

self.onmessage = (event: MessageEvent<DiscoverMessage | LoadMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'discover') {
      const response: DiscoveryResponse = {
        groups: discoverGroups(message.files),
      };
      self.postMessage({ ok: true, ...response });
      return;
    }

    const groups = discoverGroups(message.files);
    const group = groups.find((entry) => entry.id === message.groupId);
    if (!group) throw new Error(`Unknown group ${message.groupId}`);
    const response: LoadResponse = {
      bundle: loadBundle(message.files, group, message.choice),
    };
    self.postMessage({ ok: true, ...response });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Unknown worker error' });
  }
};
