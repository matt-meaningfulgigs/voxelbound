import { useEditor } from './editorStore';
import type { EmitterKind } from '@voxelbound/shared';

export function PalettePanel() {
  const palette = useEditor((s) => s.doc.palette);
  const emitters = useEditor((s) => s.doc.paletteEmitters);
  const active = useEditor((s) => s.activeColor);
  const setActiveColor = useEditor((s) => s.setActiveColor);
  const setPaletteColor = useEditor((s) => s.setPaletteColor);
  const setPaletteEmitter = useEditor((s) => s.setPaletteEmitter);
  const addPaletteColor = useEditor((s) => s.addPaletteColor);
  const emitterKind = emitters?.[active] ?? 'solid';

  return (
    <div className="panel-block">
      <div className="panel-title">Palette</div>
      <div className="palette-grid">
        {palette.map((c, i) => (
          <button
            key={i}
            className={'swatch' + (i === active ? ' sel' : '')}
            style={{ background: c }}
            title={`#${i} ${c}${emitters?.[i] && emitters[i] !== 'solid' ? ` (${emitters[i]})` : ''}`}
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
      <div className="palette-edit">
        <span className="muted">Emitter</span>
        <select
          className="hexin"
          value={emitterKind}
          onChange={(e) => setPaletteEmitter(active, e.target.value as EmitterKind)}
        >
          <option value="solid">solid</option>
          <option value="fire">fire</option>
          <option value="smoke">smoke</option>
          <option value="water">water</option>
        </select>
      </div>
    </div>
  );
}
