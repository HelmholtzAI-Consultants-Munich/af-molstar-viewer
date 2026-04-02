export interface PaeInteractionPerformanceSettings {
  heatmapHoverScheduling: 'sync' | 'raf';
  molstarHoverScheduling: 'sync' | 'raf';
  molstarHoverFrameStride: number;
  suppressHoverWhileInteracting: boolean;
}

export const SYNC_PAE_INTERACTION_PERFORMANCE: PaeInteractionPerformanceSettings = {
  heatmapHoverScheduling: 'sync',
  molstarHoverScheduling: 'sync',
  molstarHoverFrameStride: 1,
  suppressHoverWhileInteracting: true,
};

export function resolvePaeInteractionPerformance(residueCount: number): PaeInteractionPerformanceSettings {
  if (residueCount > 800) {
    return {
      heatmapHoverScheduling: 'raf',
      molstarHoverScheduling: 'raf',
      molstarHoverFrameStride: 3,
      suppressHoverWhileInteracting: true,
    };
  }

  if (residueCount > 400) {
    return {
      heatmapHoverScheduling: 'raf',
      molstarHoverScheduling: 'raf',
      molstarHoverFrameStride: 2,
      suppressHoverWhileInteracting: true,
    };
  }

  return {
    heatmapHoverScheduling: 'raf',
    molstarHoverScheduling: 'raf',
    molstarHoverFrameStride: 1,
    suppressHoverWhileInteracting: true,
  };
}
