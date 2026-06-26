import { useEffect, useState } from 'react';
import { useEditor, modelFromDoc, saveToLibrary, type VoxelKind } from './editorStore';
import { SliceEditor } from './SliceEditor';
import { PalettePanel } from './PalettePanel';
import { Toolbar } from './Toolbar';
import { AnimTimeline } from './AnimTimeline';
import { VoxelPreview3D } from './VoxelPreview3D';

const KINDS: VoxelKind[] = ['character', 'item', 'prop', 'tile', 'interactive'];

export function VoxelCreator({ onSaved }: { onSaved?: () => void }) {
  const doc = useEditor((s) => s.doc);
  const setId = useEditor((s) => s.setId);
  const setKind = useEditor((s) => s.setKind);
  const setBounds = useEditor((s) => s.setBounds);
  const setPivot = useEditor((s) => s.setPivot);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  const [playing, setPlaying] = useState(false);
  const [animRate, setAnimRate] = useState(3);
  const [status, setStatus] = useState('');

  // keyboard shortcuts: tools + undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const st = useEditor.getState();
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (e.code === 'KeyB') st.setTool('pencil');
      else if (e.code === 'KeyE') st.setTool('eraser');
      else if (e.code === 'KeyG') st.setTool('fill');
      else if (e.code === 'KeyI') st.setTool('eyedropper');
      else if (e.code === 'KeyM') st.toggleMirror();
      else if (e.code === 'BracketLeft') st.setDepth(Math.max(0, st.depth - 1));
      else if (e.code === 'BracketRight') st.setDepth(Math.min(st.doc.bounds[2] - 1, st.depth + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const voxelCount = Object.values(doc.frames).reduce((n, m) => n + m.size, 0);

  const exportJson = () => {
    const model = modelFromDoc(doc);
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.id}.vxl.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`Exported ${doc.id}.vxl.json`);
  };

  const saveLib = () => {
    saveToLibrary(modelFromDoc(doc));
    setStatus(`Saved "${doc.id}" to library`);
    onSaved?.();
  };

  return (
    <div className="voxel-creator">
      <aside className="vc-left">
        <div className="panel-block">
          <div className="panel-title">Model</div>
          <label className="field">
            <span>ID</span>
            <input value={doc.id} onChange={(e) => setId(e.target.value.replace(/\s+/g, '_'))} />
          </label>
          <label className="field">
            <span>Kind</span>
            <select value={doc.kind} onChange={(e) => setKind(e.target.value as VoxelKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Bounds</span>
            <div className="triple">
              {([0, 1, 2] as const).map((i) => (
                <input
                  key={i}
                  type="number"
                  min={1}
                  max={64}
                  value={doc.bounds[i]}
                  onChange={(e) => {
                    const b = [...doc.bounds] as [number, number, number];
                    b[i] = Math.max(1, Math.min(64, Number(e.target.value)));
                    setBounds(b);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <span>Pivot</span>
            <div className="triple">
              {([0, 1, 2] as const).map((i) => (
                <input
                  key={i}
                  type="number"
                  value={doc.pivot[i]}
                  onChange={(e) => {
                    const p = [...doc.pivot] as [number, number, number];
                    p[i] = Number(e.target.value);
                    setPivot(p);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="muted small">{voxelCount} voxels · {Object.keys(doc.frames).length} frames</div>
        </div>
        <Toolbar />
        <PalettePanel />
      </aside>

      <main className="vc-center">
        <SliceEditor />
        <AnimTimeline />
      </main>

      <aside className="vc-right">
        <div className="panel-block">
          <div className="panel-title">Preview</div>
          <VoxelPreview3D playing={playing} animRate={animRate} />
          <div className="btn-row">
            <button className={'tool-btn' + (playing ? ' sel' : '')} onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <label className="muted">
              {animRate} Hz
              <input type="range" min={1} max={12} step={1} value={animRate} onChange={(e) => setAnimRate(Number(e.target.value))} />
            </label>
          </div>
          <div className="muted small">drag to orbit · wheel to zoom</div>
        </div>
        <div className="panel-block">
          <div className="panel-title">Export</div>
          <div className="btn-row">
            <button className="tool-btn" onClick={saveLib}>
              Save to Library
            </button>
            <button className="tool-btn" onClick={exportJson}>
              Download JSON
            </button>
          </div>
          {status && <div className="status-line">{status}</div>}
          <div className="muted small" style={{ marginTop: 8 }}>
            Shortcuts: B pencil · E eraser · G fill · I pick · M mirror · [ ] depth · Ctrl/⌘+Z undo
          </div>
        </div>
      </aside>
    </div>
  );
}
