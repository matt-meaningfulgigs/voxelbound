import { useEditor, type Tool } from './editorStore';

const TOOLS: Array<{ id: Tool; label: string; key: string }> = [
  { id: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'eyedropper', label: 'Pick', key: 'I' },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const mirrorX = useEditor((s) => s.mirrorX);
  const toggleMirror = useEditor((s) => s.toggleMirror);
  const onion = useEditor((s) => s.onion);
  const toggleOnion = useEditor((s) => s.toggleOnion);
  const depth = useEditor((s) => s.depth);
  const setDepth = useEditor((s) => s.setDepth);
  const bounds = useEditor((s) => s.doc.bounds);
  const clearFrame = useEditor((s) => s.clearFrame);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  return (
    <div className="panel-block">
      <div className="panel-title">Tools</div>
      <div className="btn-row">
        {TOOLS.map((t) => (
          <button key={t.id} className={'tool-btn' + (tool === t.id ? ' sel' : '')} onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="btn-row">
        <button className={'tool-btn' + (mirrorX ? ' sel' : '')} onClick={toggleMirror}>
          Mirror X
        </button>
        <button className={'tool-btn' + (onion ? ' sel' : '')} onClick={toggleOnion}>
          Onion
        </button>
      </div>
      <div className="btn-row">
        <button className="tool-btn" onClick={undo}>
          Undo
        </button>
        <button className="tool-btn" onClick={redo}>
          Redo
        </button>
        <button className="tool-btn" onClick={clearFrame}>
          Clear
        </button>
      </div>
      <div className="depth-row">
        <span className="muted">Depth Z</span>
        <input
          type="range"
          min={0}
          max={bounds[2] - 1}
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
        />
        <span className="num">
          {depth} / {bounds[2] - 1}
        </span>
      </div>
    </div>
  );
}
