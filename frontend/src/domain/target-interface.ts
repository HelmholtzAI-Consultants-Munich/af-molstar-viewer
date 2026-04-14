const SEGMENT_PATTERN = /^(?<chain>[A-Za-z]+)(?<start>\d+)(?:-(?:(?<endChain>[A-Za-z]+))?(?<end>\d+))?$/;

export interface TargetInterfaceRange {
  chainId: string;
  start: number;
  end: number;
}

export function parseTargetInterfaceResidues(input: string): TargetInterfaceRange[] {
  const segments = input
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    throw new Error('Selection cannot be empty');
  }

  return segments.map((segment) => {
    const match = SEGMENT_PATTERN.exec(segment);
    if (!match?.groups) {
      throw new Error(`Invalid selection segment: ${segment}`);
    }
    const endChain = match.groups.endChain;
    if (endChain && endChain !== match.groups.chain) {
      throw new Error(`Selection range crosses chains: ${segment}`);
    }
    const start = Number(match.groups.start);
    const end = Number(match.groups.end ?? match.groups.start);
    if (end < start) {
      throw new Error(`Selection end precedes start: ${segment}`);
    }
    return {
      chainId: match.groups.chain,
      start,
      end,
    };
  });
}

export function canonicalizeTargetInterfaceResidues(input: string): string {
  return parseTargetInterfaceResidues(input)
    .sort((left, right) =>
      left.chainId.localeCompare(right.chainId) ||
      left.start - right.start ||
      left.end - right.end,
    )
    .map((segment) => (segment.start === segment.end ? `${segment.chainId}${segment.start}` : `${segment.chainId}${segment.start}-${segment.end}`))
    .join(',');
}
