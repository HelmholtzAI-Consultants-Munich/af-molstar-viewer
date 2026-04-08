import { useEffect, useMemo, useRef } from 'react';
import { AF_CONFIDENCE_COLORS } from '../lib/constants';
import type { ChainTrack, PolymerResidue } from '../lib/types';

interface SequenceStripProps {
  residues: PolymerResidue[];
  chains: ChainTrack[];
  hoveredResidues: number[];
  pinnedResidues: number[];
  onHover: (index: number | null) => void;
  onClick: (index: number) => void;
}

export function SequenceStrip(props: SequenceStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredSet = useMemo(() => new Set(props.hoveredResidues), [props.hoveredResidues]);
  const pinnedSet = useMemo(() => new Set(props.pinnedResidues), [props.pinnedResidues]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = canvas.clientWidth;
    const height = 88;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    context.scale(window.devicePixelRatio, window.devicePixelRatio);
    context.clearRect(0, 0, width, height);

    const residueWidth = width / Math.max(props.residues.length, 1);
    context.fillStyle = '#f8f6ef';
    context.fillRect(0, 0, width, height);

    props.residues.forEach((residue, index) => {
      const x = index * residueWidth;
      context.fillStyle = AF_CONFIDENCE_COLORS[residue.category];
      context.fillRect(x, 26, Math.max(residueWidth, 1), 34);
      if (hoveredSet.has(index)) {
        context.strokeStyle = '#121212';
        context.lineWidth = 2;
        context.strokeRect(x, 24, Math.max(residueWidth, 1), 38);
      }
      if (pinnedSet.has(index)) {
        context.strokeStyle = '#d97706';
        context.lineWidth = 3;
        context.strokeRect(x, 22, Math.max(residueWidth, 1), 42);
      }
      if (residueWidth > 12) {
        context.fillStyle = residue.category === 'very-high' ? '#ffffff' : '#191919';
        context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
        context.textAlign = 'center';
        context.fillText(residue.code, x + residueWidth / 2, 48);
      }
    });

    context.fillStyle = '#5f5a52';
    context.font = '11px ui-sans-serif, system-ui, sans-serif';
    context.textAlign = 'left';
    props.chains.forEach((chain) => {
      const x = chain.residueStart * residueWidth;
      const spanWidth = (chain.residueEnd - chain.residueStart + 1) * residueWidth;
      context.fillText(`${chain.chainId} · ${chain.sequence.length} aa`, x + 6, 16);
      context.strokeStyle = '#c4b7a6';
      context.lineWidth = 1;
      context.strokeRect(x, 25, Math.max(spanWidth, 1), 36);
    });
  }, [hoveredSet, pinnedSet, props.chains, props.residues]);

  const mapEventToIndex = (clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || props.residues.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const index = Math.min(props.residues.length - 1, Math.max(0, Math.floor(ratio * props.residues.length)));
    return Number.isFinite(index) ? index : null;
  };

  return (
    <section className="panel sequence-panel">
      <div className="panel-heading">
        <h2>Residue confidence track</h2>
      </div>
      <canvas
        ref={canvasRef}
        className="sequence-canvas"
        onMouseMove={(event) => props.onHover(mapEventToIndex(event.clientX))}
        onMouseLeave={() => props.onHover(null)}
        onClick={(event) => {
          const index = mapEventToIndex(event.clientX);
          if (index !== null) props.onClick(index);
        }}
      />
    </section>
  );
}
