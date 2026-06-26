import { useEditor } from './editorStore';

export function PalettePanel() {
  const palette = useEditor((s) => s.doc.palette);
  const active = useEditor((s) => s.activeColor);
  const setActiveColor = useEditor((s) => s.setActiveColor);
  const setPaletteColor = useEditor((s) => s.setPaletteColor);
  const addPaletteColor = useEditor((s) => s.addPaletteColor);

  return (
    <div className="panel-block">
      <div className="panel-title">Palette</div>
      <div className="palette-grid">
        {palette.map((c, i) => (
          <button
            key={i}
            className={'swatch' + (i === active ? ' sel' : '')}
            style={{ background: c }}
            title={`#${i} ${c}`}
            onClick={() => setActiveColor(i)}
          />
        ))}
        <button className="swatch add" onClick={addPaletteColor} title="Add color">
          +
        </button>
      </div>
      <div className="palette-edit">
        <input
          type="color"
          value={palette[active] ?? '#ffffff'}
          onChange={(e) => setPaletteColor(active, e.target.value)}
        />
        <input
          className="hexin"
          value={palette[active] ?? ''}
          onChange={(e) => setPaletteColor(active, e.target.value)}
        />
        <span className="muted">slot #{active}</span>
      </div>
    </div>
  );
}
