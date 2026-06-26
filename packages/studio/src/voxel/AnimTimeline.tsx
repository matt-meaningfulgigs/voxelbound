import { useEffect, useRef } from 'react';
import { useEditor } from './editorStore';
import type { AnimationClip } from '@voxelbound/shared';

function FrameThumb({ frameId, selected, onClick }: { frameId: string; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const doc = useEditor((s) => s.doc);
  const bump = useEditor((s) => s.bump);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const [w, h] = doc.bounds;
    const cs = Math.max(1, Math.floor(48 / Math.max(w, h)));
    ctx.clearRect(0, 0, 48, 48);
    ctx.fillStyle = '#0c0e16';
    ctx.fillRect(0, 0, 48, 48);
    const frame = doc.frames[frameId];
    if (!frame) return;
    // flatten on Z (front-most wins): paint by descending z
    const byCell = new Map<string, { z: number; ci: number }>();
    for (const [k, ci] of frame) {
      const [x, y, z] = k.split(',').map(Number);
      const cell = `${x},${y}`;
      const cur = byCell.get(cell);
      if (!cur || z! > cur.z) byCell.set(cell, { z: z!, ci });
    }
    const ox = (48 - w * cs) / 2;
    const oy = (48 - h * cs) / 2;
    for (const [cell, { ci }] of byCell) {
      const [x, y] = cell.split(',').map(Number);
      ctx.fillStyle = doc.palette[ci] ?? '#f0f';
      ctx.fillRect(ox + x! * cs, oy + (h - 1 - y!) * cs, cs, cs);
    }
  }, [doc, bump, frameId]);
  return <canvas ref={ref} width={48} height={48} className={'frame-thumb' + (selected ? ' sel' : '')} onClick={onClick} />;
}

export function AnimTimeline() {
  const doc = useEditor((s) => s.doc);
  const activeClip = useEditor((s) => s.activeClip);
  const activeFrame = useEditor((s) => s.activeFrame);
  const setActiveClip = useEditor((s) => s.setActiveClip);
  const setActiveFrame = useEditor((s) => s.setActiveFrame);
  const addClip = useEditor((s) => s.addClip);
  const deleteClip = useEditor((s) => s.deleteClip);
  const setClipLoop = useEditor((s) => s.setClipLoop);
  const setClipTicks = useEditor((s) => s.setClipTicks);
  const addFrame = useEditor((s) => s.addFrame);
  const deleteFrame = useEditor((s) => s.deleteFrame);

  const clip = doc.animations[activeClip];
  const clipNames = Object.keys(doc.animations);

  return (
    <div className="anim-timeline">
      <div className="anim-controls">
        <select value={activeClip} onChange={(e) => setActiveClip(e.target.value)}>
          {clipNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          className="tool-btn"
          onClick={() => {
            const name = prompt('New clip name (e.g. walk, attack):');
            if (name) addClip(name.trim());
          }}
        >
          + Clip
        </button>
        <button className="tool-btn" onClick={() => deleteClip(activeClip)}>
          − Clip
        </button>
        <select value={clip?.loop ?? 'loop'} onChange={(e) => setClipLoop(e.target.value as AnimationClip['loop'])}>
          <option value="loop">loop</option>
          <option value="ping_pong">ping_pong</option>
          <option value="once">once</option>
          <option value="once_hold">once_hold</option>
        </select>
        <label className="muted">
          ticks/frame
          <input
            className="numin"
            type="number"
            min={0}
            value={clip?.ticksPerFrame ?? ''}
            placeholder="auto"
            onChange={(e) => setClipTicks(e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
      </div>
      <div className="frame-strip">
        {clip?.frames.map((fid, i) => (
          <FrameThumb key={fid + i} frameId={fid} selected={i === activeFrame} onClick={() => setActiveFrame(i)} />
        ))}
        <button className="tool-btn frame-add" onClick={() => addFrame(true)} title="Duplicate current frame">
          +dup
        </button>
        <button className="tool-btn frame-add" onClick={() => addFrame(false)} title="Add blank frame">
          +new
        </button>
        <button className="tool-btn frame-add" onClick={() => deleteFrame()} title="Delete current frame">
          −
        </button>
      </div>
    </div>
  );
}
