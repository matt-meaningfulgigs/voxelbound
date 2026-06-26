import { useState } from 'react';
import { allModels } from '@voxelbound/shared';
import type { VoxelModel } from '@voxelbound/shared';
import {
  useEditor,
  docFromModel,
  emptyDoc,
  loadLibrary,
  deleteFromLibrary,
  PRESETS,
  type VoxelKind,
} from './voxel/editorStore';

const PRESET_KIND: Record<string, VoxelKind> = {
  Character: 'character',
  Item: 'item',
  Prop: 'prop',
  Tile: 'tile',
  Boss: 'character',
};

export function AssetBrowser({ onOpen }: { onOpen: () => void }) {
  const load = useEditor((s) => s.load);
  const [filter, setFilter] = useState('');
  const [libVersion, setLibVersion] = useState(0);
  const library = loadLibrary();

  const open = (m: VoxelModel) => {
    load(docFromModel(m));
    onOpen();
  };

  const byKind = new Map<string, VoxelModel[]>();
  for (const m of allModels) {
    if (filter && !m.id.toLowerCase().includes(filter.toLowerCase())) continue;
    if (!byKind.has(m.kind)) byKind.set(m.kind, []);
    byKind.get(m.kind)!.push(m);
  }

  return (
    <div className="asset-browser">
      <div className="ab-head">
        <h2>Asset Library</h2>
        <input className="search" placeholder="search models…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <section>
        <div className="panel-title">New from preset</div>
        <div className="btn-row wrap">
          {Object.entries(PRESETS).map(([name, bounds]) => (
            <button
              key={name}
              className="tool-btn"
              onClick={() => {
                const doc = emptyDoc(PRESET_KIND[name] ?? 'character', [...bounds] as [number, number, number]);
                doc.id = `new_${name.toLowerCase()}`;
                load(doc);
                onOpen();
              }}
            >
              {name} <span className="muted">{bounds.join('×')}</span>
            </button>
          ))}
        </div>
      </section>

      {library.length > 0 && (
        <section>
          <div className="panel-title">My Library (saved in browser)</div>
          <div className="asset-grid">
            {library.map((m) => (
              <div key={m.id} className="asset-card">
                <button className="asset-open" onClick={() => open(m)}>
                  <span className="asset-name">{m.id}</span>
                  <span className="muted">{m.kind} · {m.bounds.join('×')}</span>
                </button>
                <button
                  className="asset-del"
                  title="Delete"
                  onClick={() => {
                    deleteFromLibrary(m.id);
                    setLibVersion(libVersion + 1);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {[...byKind.entries()].map(([kind, models]) => (
        <section key={kind}>
          <div className="panel-title">{kind} ({models.length})</div>
          <div className="asset-grid">
            {models.map((m) => (
              <button key={m.id} className="asset-card asset-open" onClick={() => open(m)}>
                <span className="asset-name">{m.id}</span>
                <span className="muted">{m.bounds.join('×')}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
