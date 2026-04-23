import { classifyChemCompType, residueCode } from '../constants';
import type { ParsedResidue, ParsedStructure } from '../types';
import { mean } from '../utils';

interface LoopTable {
  columns: string[];
  rows: string[][];
}

function tokenizeLine(line: string): string[] {
  const tokens = line.match(/'(?:[^']*)'|"(?:[^"]*)"|\S+/g) ?? [];
  return tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));
}

function parseLoops(text: string): Map<string, LoopTable> {
  const lines = text.split(/\r?\n/);
  const loops = new Map<string, LoopTable>();
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed !== 'loop_') {
      index += 1;
      continue;
    }

    index += 1;
    const columns: string[] = [];
    while (index < lines.length && lines[index].trim().startsWith('_')) {
      columns.push(lines[index].trim());
      index += 1;
    }

    const tokens: string[] = [];
    while (index < lines.length) {
      const line = lines[index];
      const next = line.trim();
      if (!next || next === '#') {
        index += 1;
        if (next === '#') break;
        continue;
      }
      if (next === 'loop_' || next.startsWith('_') || next.startsWith('data_')) break;
      tokens.push(...tokenizeLine(line));
      index += 1;
    }

    const rows: string[][] = [];
    for (let offset = 0; offset < tokens.length; offset += columns.length) {
      rows.push(tokens.slice(offset, offset + columns.length));
    }
    if (columns[0]) {
      const prefix = columns[0].split('.').shift() ?? columns[0];
      loops.set(prefix, { columns, rows });
    }
  }

  return loops;
}

function getValue(row: string[], table: LoopTable, column: string): string {
  const index = table.columns.indexOf(column);
  return index >= 0 ? row[index] : '?';
}

export function parseMmCifStructure(text: string): ParsedStructure {
  const loops = parseLoops(text);
  const chemComp = loops.get('_chem_comp');
  const chemType = new Map<string, string>();
  if (chemComp) {
    for (const row of chemComp.rows) {
      chemType.set(getValue(row, chemComp, '_chem_comp.id'), getValue(row, chemComp, '_chem_comp.type'));
    }
  }

  const qaMetric = loops.get('_ma_qa_metric');
  const localMetricIds = new Set<string>();
  if (qaMetric) {
    for (const row of qaMetric.rows) {
      const mode = getValue(row, qaMetric, '_ma_qa_metric.mode');
      const name = getValue(row, qaMetric, '_ma_qa_metric.name');
      if (mode === 'local' && name.toLowerCase() === 'plddt') {
        localMetricIds.add(getValue(row, qaMetric, '_ma_qa_metric.id'));
      }
    }
  }
  const looksLikePLDDTs = localMetricIds.size > 0;

  const localQa = loops.get('_ma_qa_metric_local');
  const localConfidence = new Map<string, number>();
  if (localQa) {
    for (const row of localQa.rows) {
      const metricId = getValue(row, localQa, '_ma_qa_metric_local.metric_id');
      if (localMetricIds.size > 0 && !localMetricIds.has(metricId)) continue;
      const chainId = getValue(row, localQa, '_ma_qa_metric_local.label_asym_id');
      const seqId = Number(getValue(row, localQa, '_ma_qa_metric_local.label_seq_id'));
      const value = Number(getValue(row, localQa, '_ma_qa_metric_local.metric_value'));
      localConfidence.set(`${chainId}:${seqId}`, value);
    }
  }

  const atomSite = loops.get('_atom_site');
  if (!atomSite) {
    throw new Error('mmCIF file does not contain _atom_site loop');
  }

  const residues: ParsedResidue[] = [];
  let currentKey = '';
  let currentAtoms: number[] = [];

  const pushResidue = (row: string[] | null) => {
    if (!row || currentKey === '') return;
    const chainId = getValue(row, atomSite, '_atom_site.label_asym_id') || getValue(row, atomSite, '_atom_site.auth_asym_id');
    const entityId = getValue(row, atomSite, '_atom_site.label_entity_id');
    const labelSeqId = Number(getValue(row, atomSite, '_atom_site.label_seq_id'));
    const authSeqIdRaw = getValue(row, atomSite, '_atom_site.auth_seq_id');
    const authSeqId = authSeqIdRaw === '?' ? undefined : Number(authSeqIdRaw);
    const compId = getValue(row, atomSite, '_atom_site.label_comp_id') || getValue(row, atomSite, '_atom_site.auth_comp_id');
    const moleculeType = classifyChemCompType(chemType.get(compId), compId);
    const atomStart = currentAtoms[0] ?? 0;
    const atomEnd = currentAtoms.at(-1) ?? atomStart;
    const confidenceFallback = mean(currentAtoms.map((atomIndex) => {
      const atomRow = atomSite.rows[atomIndex];
      return Number(getValue(atomRow, atomSite, '_atom_site.B_iso_or_equiv'));
    }));

    residues.push({
      chainId,
      entityId: entityId === '?' ? undefined : entityId,
      labelSeqId,
      authSeqId,
      compId,
      moleculeType,
      code: residueCode(compId, moleculeType),
      atomStart,
      atomEnd,
      confidenceFromStructure: localConfidence.get(`${chainId}:${labelSeqId}`) ?? confidenceFallback,
    });
  };

  for (let atomIndex = 0; atomIndex < atomSite.rows.length; atomIndex += 1) {
    const row = atomSite.rows[atomIndex];
    const chainId = getValue(row, atomSite, '_atom_site.label_asym_id') || getValue(row, atomSite, '_atom_site.auth_asym_id');
    const labelSeqId = getValue(row, atomSite, '_atom_site.label_seq_id');
    const compId = getValue(row, atomSite, '_atom_site.label_comp_id') || getValue(row, atomSite, '_atom_site.auth_comp_id');
    const key = `${chainId}:${labelSeqId}:${compId}`;
    if (key !== currentKey && currentKey) {
      pushResidue(atomSite.rows[atomIndex - 1]);
      currentAtoms = [];
    }
    currentKey = key;
    currentAtoms.push(atomIndex);
  }

  pushResidue(atomSite.rows[atomSite.rows.length - 1] ?? null);

  return { residues, looksLikePLDDTs };
}
