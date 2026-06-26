import { useEffect, useRef, useState } from 'react';
import { allModels } from '@voxelbound/shared';
import type { VoxelModel } from '@voxelbound/shared';

type Layer = 'ground' | 'prop' | 'collision';

const GROUND_MODELS = allModels.filter((m) => m.kind === 'tile');
const PROP_MODELS = allModels.filter((m) => m.kind === 'prop' || m.id.startsWith('tree') || m.id.startsWith('pine') || m.id.startsWith('house'));

function repColor(m: VoxelModel): string {
  return m.palette[1] ?? m.palette[0] ?? '#888';
}

function makeGrid<T>(w: number, h: number, v: T): T[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => v));
}

export function WorldBuilder() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const [w, setW] = useState(20);
  const [h, setH] = useState(20);
  const [layer, setLayer] = useState<Layer>('ground');
  const [groundId, setGroundId] = useState(GROUND_MODELS[0]?.id ?? '');
  const [propId, setPropId] = useState(PROP_MODELS[0]?.id ?? '');
  const [ground, setGround] = useState<(string | null)[][]>(() => makeGrid<string | null>(20, 20, null));
  const [props, setProps] = useState<(string | null)[][]>(() => makeGrid<string | null>(20, 20, null));
  const [coll, setColl] = useState<boolean[][]>(() => makeGrid(20, 20, false));
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState('');

  const cs = Math.max(10, Math.min(28, Math.floor(560 / Math.max(w, h))));

  const resize = (nw: number, nh: number) => {
    setW(nw);
    setH(nh);
    setGround(makeGrid<string | null>(nw, nh, null));
    setProps(makeGrid<string | null>(nw, nh, null));
    setColl(makeGrid(nw, nh, false));
    setVersion((v) => v + 1);
  };

  const colorOf = (id: string | null): string | null => {
    if (!id) return null;
    const m = allModels.find((mm) => mm.id === id);
    return m ? repColor(m) : '#888';
  };

  useEffect(() => {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0c0e16';
    ctx.fillRect(0, 0, w * cs, h * cs);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gc = colorOf(ground[y]![x]!);
        if (gc) {
          ctx.fillStyle = gc;
          ctx.fillRect(x * cs, y * cs, cs, cs);
        }
        const pc = colorOf(props[y]![x]!);
        if (pc) {
          ctx.fillStyle = pc;
          ctx.beginPath();
          ctx.arc(x * cs + cs / 2, y * cs + cs / 2, cs * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (coll[y]![x]) {
          ctx.strokeStyle = 'rgba(232,69,60,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x * cs + 3, y * cs + 3);
          ctx.lineTo((x + 1) * cs - 3, (y + 1) * cs - 3);
          ctx.moveTo((x + 1) * cs - 3, y * cs + 3);
          ctx.lineTo(x * cs + 3, (y + 1) * cs - 3);
          ctx.stroke();
        }
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cs + 0.5, 0);
      ctx.lineTo(x * cs + 0.5, h * cs);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cs + 0.5);
      ctx.lineTo(w * cs, y * cs + 0.5);
      ctx.stroke();
    }
  }, [ground, props, coll, w, h, cs, version]);

  const paint = (e: React.PointerEvent, erase: boolean) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / cs);
    const y = Math.floor((e.clientY - rect.top) / cs);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    if (layer === 'ground') setGround((g) => g.map((row, ry) => (ry === y ? row.map((v, rx) => (rx === x ? (erase ? null : groundId) : v)) : row)));
    else if (layer === 'prop') setProps((g) => g.map((row, ry) => (ry === y ? row.map((v, rx) => (rx === x ? (erase ? null : propId) : v)) : row)));
    else setColl((g) => g.map((row, ry) => (ry === y ? row.map((v, rx) => (rx === x ? !erase : v)) : row)));
  };

  const exportMap = () => {
    const map = {
      id: 'custom_map',
      size: { w, h },
      tilePalette: [...new Set([...ground.flat(), ...props.flat()].filter(Boolean))],
      ground,
      props,
      collision: coll,
    };
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'map.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Exported map.json');
  };

  return (
    <div className="world-builder">
      <aside className="wb-left">
        <div className="panel-block">
          <div className="panel-title">Map</div>
          <div className="field">
            <span>Size</span>
            <div className="triple">
              <input type="number" min={4} max={48} value={w} onChange={(e) => resize(Number(e.target.value), h)} />
              <input type="number" min={4} max={48} value={h} onChange={(e) => resize(w, Number(e.target.value))} />
            </div>
          </div>
        </div>
        <div className="panel-block">
          <div className="panel-title">Layer</div>
          <div className="btn-row">
            {(['ground', 'prop', 'collision'] as Layer[]).map((l) => (
              <button key={l} className={'tool-btn' + (layer === l ? ' sel' : '')} onClick={() => setLayer(l)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {layer === 'ground' && (
          <div className="panel-block">
            <div className="panel-title">Ground tile</div>
            <div className="tile-list">
              {GROUND_MODELS.map((m) => (
                <button key={m.id} className={'tile-opt' + (groundId === m.id ? ' sel' : '')} onClick={() => setGroundId(m.id)}>
                  <span className="dot" style={{ background: repColor(m) }} />
                  {m.id}
                </button>
              ))}
            </div>
          </div>
        )}
        {layer === 'prop' && (
          <div className="panel-block">
            <div className="panel-title">Prop</div>
            <div className="tile-list">
              {PROP_MODELS.map((m) => (
                <button key={m.id} className={'tile-opt' + (propId === m.id ? ' sel' : '')} onClick={() => setPropId(m.id)}>
                  <span className="dot" style={{ background: repColor(m) }} />
                  {m.id}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="panel-block">
          <button className="tool-btn" onClick={exportMap}>
            Download map.json
          </button>
          {status && <div className="status-line">{status}</div>}
        </div>
      </aside>
      <main className="wb-center">
        <div className="muted small" style={{ marginBottom: 8 }}>
          Left-click paint · right-click erase · current layer: <b>{layer}</b>
        </div>
        <canvas
          ref={canvasRef}
          width={w * cs}
          height={h * cs}
          className="wb-canvas"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            painting.current = true;
            paint(e, e.button === 2);
          }}
          onPointerMove={(e) => {
            if (painting.current) paint(e, (e.buttons & 2) === 2);
          }}
          onPointerUp={() => (painting.current = false)}
          onContextMenu={(e) => e.preventDefault()}
        />
      </main>
    </div>
  );
}
