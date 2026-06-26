import { useState } from 'react';
import { ITEMS, ENEMIES, PSI, QUESTS, SHOPS, DIALOGUES } from '@voxelbound/shared';

type Col = { key: string; label: string; type: 'text' | 'number' | 'bool' };

function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function TableEditor({ title, file, cols, initial, blank }: { title: string; file: string; cols: Col[]; initial: Record<string, unknown>[]; blank: Record<string, unknown> }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>(() => structuredClone(initial));
  const setCell = (i: number, key: string, value: unknown) => {
    setRows((r) => r.map((row, ri) => (ri === i ? { ...row, [key]: value } : row)));
  };
  return (
    <div className="data-table-wrap">
      <div className="ab-head">
        <h2>{title}</h2>
        <div className="btn-row">
          <button className="tool-btn" onClick={() => setRows((r) => [...r, structuredClone(blank)])}>
            + Add
          </button>
          <button className="tool-btn" onClick={() => download(file, rows)}>
            Download JSON
          </button>
        </div>
      </div>
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key}>
                    {c.type === 'bool' ? (
                      <input type="checkbox" checked={!!row[c.key]} onChange={(e) => setCell(i, c.key, e.target.checked)} />
                    ) : (
                      <input
                        type={c.type === 'number' ? 'number' : 'text'}
                        value={(row[c.key] ?? '') as string | number}
                        onChange={(e) => setCell(i, c.key, c.type === 'number' ? Number(e.target.value) : e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td>
                  <button className="asset-del" onClick={() => setRows((r) => r.filter((_, ri) => ri !== i))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JsonEditor({ title, file, initial }: { title: string; file: string; initial: unknown }) {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [error, setError] = useState('');
  const validate = (t: string) => {
    setText(t);
    try {
      JSON.parse(t);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="data-table-wrap">
      <div className="ab-head">
        <h2>{title}</h2>
        <button
          className="tool-btn"
          disabled={!!error}
          onClick={() => download(file, JSON.parse(text))}
        >
          Download JSON
        </button>
      </div>
      {error && <div className="status-line error">Invalid JSON: {error}</div>}
      <textarea className="json-area" spellCheck={false} value={text} onChange={(e) => validate(e.target.value)} />
    </div>
  );
}

const TABS = ['Items', 'Enemies', 'PSI', 'Quests', 'Shops', 'Dialogue'] as const;
type Tab = (typeof TABS)[number];

export function DataEditor() {
  const [tab, setTab] = useState<Tab>('Items');
  return (
    <div className="data-editor">
      <div className="subtabs">
        {TABS.map((t) => (
          <button key={t} className={'subtab' + (t === tab ? ' sel' : '')} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Items' && (
        <TableEditor
          title="Items"
          file="items.json"
          initial={ITEMS as unknown as Record<string, unknown>[]}
          blank={{ id: 'new_item', name: 'New Item', desc: '', category: 'goods', price: 10 }}
          cols={[
            { key: 'id', label: 'ID', type: 'text' },
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'category', label: 'Category', type: 'text' },
            { key: 'price', label: 'Price', type: 'number' },
            { key: 'hpHeal', label: 'HP+', type: 'number' },
            { key: 'ppHeal', label: 'PP+', type: 'number' },
            { key: 'offense', label: 'OFF', type: 'number' },
            { key: 'defense', label: 'DEF', type: 'number' },
            { key: 'equipSlot', label: 'Slot', type: 'text' },
            { key: 'desc', label: 'Description', type: 'text' },
          ]}
        />
      )}
      {tab === 'Enemies' && (
        <TableEditor
          title="Enemies"
          file="enemies.json"
          initial={ENEMIES as unknown as Record<string, unknown>[]}
          blank={{ id: 'new_enemy', name: 'New Enemy', modelId: 'enemy_spud', maxHp: 20, offense: 8, defense: 3, speed: 6, exp: 10, money: 8 }}
          cols={[
            { key: 'id', label: 'ID', type: 'text' },
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'modelId', label: 'Model', type: 'text' },
            { key: 'maxHp', label: 'HP', type: 'number' },
            { key: 'offense', label: 'OFF', type: 'number' },
            { key: 'defense', label: 'DEF', type: 'number' },
            { key: 'speed', label: 'SPD', type: 'number' },
            { key: 'exp', label: 'EXP', type: 'number' },
            { key: 'money', label: '$', type: 'number' },
            { key: 'isBoss', label: 'Boss', type: 'bool' },
          ]}
        />
      )}
      {tab === 'PSI' && (
        <TableEditor
          title="PSI"
          file="psi.json"
          initial={PSI as unknown as Record<string, unknown>[]}
          blank={{ id: 'new_psi', name: 'New PSI', tier: 'α', ppCost: 4, target: 'enemy', kind: 'damage', power: 20, desc: '' }}
          cols={[
            { key: 'id', label: 'ID', type: 'text' },
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'tier', label: 'Tier', type: 'text' },
            { key: 'ppCost', label: 'PP', type: 'number' },
            { key: 'target', label: 'Target', type: 'text' },
            { key: 'kind', label: 'Kind', type: 'text' },
            { key: 'power', label: 'Power', type: 'number' },
            { key: 'desc', label: 'Description', type: 'text' },
          ]}
        />
      )}
      {tab === 'Quests' && <JsonEditor title="Quests" file="quests.json" initial={QUESTS} />}
      {tab === 'Shops' && <JsonEditor title="Shops" file="shops.json" initial={SHOPS} />}
      {tab === 'Dialogue' && <JsonEditor title="Dialogue" file="dialogues.json" initial={DIALOGUES} />}
    </div>
  );
}
