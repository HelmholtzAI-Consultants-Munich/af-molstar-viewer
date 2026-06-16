import { ensureSquareMatrix } from '../adapters/helpers';

export interface ParsedPaeJson {
  matrix: number[][];
  maxValue: number;
}

type PaeJsonObject = {
  pae?: unknown;
  predicted_aligned_error?: unknown;
  max_pae?: unknown;
  max_predicted_aligned_error?: unknown;
} | null;

function isMatrixCandidate(value: unknown): value is number[][] {
  return Array.isArray(value) && Array.isArray(value[0]);
}

function extractMatrix(json: unknown): unknown {
  if (isMatrixCandidate(json)) {
    return json;
  }

  const candidate = Array.isArray(json) ? json[0] : json;
  if (candidate && typeof candidate === 'object') {
    const paeObject = candidate as PaeJsonObject;
    if (paeObject?.predicted_aligned_error !== undefined) return paeObject.predicted_aligned_error;
    if (paeObject?.pae !== undefined) return paeObject.pae;
  }

  if (candidate && typeof candidate === 'object') {
    const paeObject = candidate as PaeJsonObject;
    if (paeObject?.predicted_aligned_error !== undefined) return paeObject.predicted_aligned_error;
    if (paeObject?.pae !== undefined) return paeObject.pae;
  }

  throw new Error('Expected PAE JSON with a square matrix');
}

function extractMaxValue(json: unknown, matrix: number[][]): number {
  const candidate = Array.isArray(json) ? json[0] : json;
  if (candidate && typeof candidate === 'object') {
    const paeObject = candidate as PaeJsonObject;
    const maxValue = Number(paeObject?.max_predicted_aligned_error ?? paeObject?.max_pae);
    if (Number.isFinite(maxValue) && maxValue > 0) {
      return maxValue;
    }
  }

  const flattened = matrix.flat().map(Number).filter((value) => Number.isFinite(value));
  return flattened.length > 0 ? Math.max(...flattened) : 0;
}

export function parsePaeJson(text: string): ParsedPaeJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Unable to parse pAE JSON');
  }

  const matrix = ensureSquareMatrix(extractMatrix(parsed));
  return {
    matrix,
    maxValue: extractMaxValue(parsed, matrix),
  };
}
