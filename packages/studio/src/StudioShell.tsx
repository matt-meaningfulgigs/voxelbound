import { useState } from 'react';
import { AssetBrowser } from './AssetBrowser';
import { VoxelCreator } from './voxel/VoxelCreator';
import { WorldBuilder } from './WorldBuilder';
import { DataEditor } from './DataEditor';
import { EngineViewport } from './EngineViewport';
import { WorldSettingsPanel } from './WorldSettingsPanel';

type Tab = 'assets' | 'creator' | 'world' | 'data' | 'play';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'assets', label: 'Assets' },
  { id: 'creator', label: 'Voxel Creator' },
  { id: 'world', label: 'World Builder' },
  { id: 'data', label: 'Data Editors' },
  { id: 'play', label: 'Play / Settings' },
];

export function StudioShell() {
  const [tab, setTab] = useState<Tab>('assets');
  const [libVersion, setLibVersion] = useState(0);

  return (
    <div className="studio-root">
      <header className="studio-header">
        <div className="studio-logo">VOXELBOUND <span>STUDIO</span></div>
        <nav className="studio-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={'studio-tab' + (tab === t.id ? ' sel' : '')} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <a className="studio-playlink" href="http://localhost:5173/" target="_blank" rel="noreferrer">
          ▶ Open Game
        </a>
      </header>

      <div className="studio-body">
        {tab === 'assets' && <AssetBrowser key={libVersion} onOpen={() => setTab('creator')} />}
        {tab === 'creator' && <VoxelCreator onSaved={() => setLibVersion((v) => v + 1)} />}
        {tab === 'world' && <WorldBuilder />}
        {tab === 'data' && <DataEditor />}
        {tab === 'play' && (
          <div className="play-view">
            <WorldSettingsPanel />
            <div className="play-canvas">
              <EngineViewport />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
