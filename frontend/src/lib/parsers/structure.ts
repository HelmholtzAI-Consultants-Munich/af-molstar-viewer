import type { ParsedStructure, StructureFormat } from '../types';
import { parseMmCifStructure } from './mmcif';
import { parsePdbStructure } from './pdb';

export function parseStructure(text: string, format: StructureFormat): ParsedStructure {
  return format === 'pdb' ? parsePdbStructure(text) : parseMmCifStructure(text);
}
