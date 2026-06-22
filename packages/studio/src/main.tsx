import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EngineViewport } from './EngineViewport';
import { WorldSettingsPanel } from './WorldSettingsPanel';

function App() {
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <WorldSettingsPanel />
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 1,
            background: 'rgba(0,0,0,0.6)',
            padding: '4px 8px',
            fontSize: 12,
          }}
        >
          VoxelBound Studio — live preview
        </div>
        <EngineViewport />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
