import { useEffect, useRef } from 'react';
import { useEditor } from './editorStore';

export function SliceEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);

  const doc = useEditor((s) => s.doc);
  const bump = useEditor((s) => s.bump);
  const depth = useEditor((s) => s.depth);
  const activeClip = useEditor((s) => s.activeClip);
  const activeFrame = useEditor((s) => s.activeFrame);
  const onion = useEditor((s) => s.onion);

  const [w, h] = doc.bounds;
  const cs = Math.max(6, Math.floor(520 / Math.max(w, h)));
  const cw = w * cs;
  const ch = h * cs;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0c0e16';
    ctx.fillRect(0, 0, cw, ch);

    const st = useEditor.getState();
    const clip = doc.animations[activeClip];
    const fid = clip?.frames[activeFrame];
    const frame = fid ? doc.frames[fid] : undefined;

    // onion skin: previous animation frame at same depth
    if (onion && clip && activeFrame > 0) {
      const prevFid = clip.frames[activeFrame - 1];
      const prev = prevFid ? doc.frames[prevFid] : undefined;
      if (prev) {
        ctx.globalAlpha = 0.22;
        for (const [k, ci] of prev) {
          const [x, y, z] = k.split(',').map(Number);
          if (z !== depth) continue;
          ctx.fillStyle = doc.palette[ci] ?? '#f0f';
          ctx.fillRect(x! * cs, (h - 1 - y!) * cs, cs, cs);
        }
        ctx.globalAlpha = 1;
      }
    }

    // current slice voxels
    if (frame) {
      for (const [k, ci] of frame) {
        const [x, y, z] = k.split(',').map(Number);
        if (z !== depth) continue;
        ctx.fillStyle = doc.palette[ci] ?? '#f0f';
        ctx.fillRect(x! * cs, (h - 1 - y!) * cs, cs, cs);
      }
    }

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cs + 0.5, 0);
      ctx.lineTo(x * cs + 0.5, ch);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cs + 0.5);
      ctx.lineTo(cw, y * cs + 0.5);
      ctx.stroke();
    }
    // mirror axis guide
    if (st.mirrorX) {
      ctx.strokeStyle = 'rgba(255,210,58,0.5)';
      ctx.beginPath();
      ctx.moveTo((w / 2) * cs + 0.5, 0);
      ctx.lineTo((w / 2) * cs + 0.5, ch);
      ctx.stroke();
    }
  }, [doc, bump, depth, activeClip, activeFrame, onion, w, h, cs, cw, ch]);

  const cellFromEvent = (e: React.PointerEvent): [number, number] | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x = Math.floor(px / cs);
    const y = h - 1 - Math.floor(py / cs);
    if (x < 0 || x >= w || y < 0 || y >= h) return null;
    return [x, y];
  };

  const paint = (e: React.PointerEvent, first: boolean) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    const [x, y] = cell;
    const st = useEditor.getState();
    if (st.tool === 'eyedropper') {
      const fid = st.frameId();
      const ci = st.doc.frames[fid]?.get(`${x},${y},${depth}`);
      if (ci !== undefined) st.setActiveColor(ci);
      return;
    }
    if (st.tool === 'fill') {
      st.fill(x, y, depth, st.activeColor);
      return;
    }
    if (first) st.beginStroke();
    st.setVoxel(x, y, depth, st.tool === 'eraser' ? null : st.activeColor);
  };

  return (
    <div className="slice-wrap">
      <canvas
        ref={canvasRef}
        width={cw}
        height={ch}
        className="slice-canvas"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          painting.current = true;
          paint(e, true);
        }}
        onPointerMove={(e) => {
          if (painting.current) paint(e, false);
        }}
        onPointerUp={() => (painting.current = false)}
        onPointerLeave={() => (painting.current = false)}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
