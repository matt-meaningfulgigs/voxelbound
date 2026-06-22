import type { CSSProperties } from 'react';
import { useStudioStore } from './store';

export function WorldSettingsPanel() {
  const settings = useStudioStore((s) => s.settings);
  const setSettings = useStudioStore((s) => s.setSettings);

  const updateTiming = (key: 'worldTickRate' | 'animStepRate', value: number) => {
    setSettings({
      ...settings,
      timing: { ...settings.timing, [key]: value },
    });
  };

  const updateCamera = (key: keyof typeof settings.camera, value: number) => {
    setSettings({
      ...settings,
      camera: { ...settings.camera, [key]: value },
    });
  };

  return (
    <div style={{ padding: 16, width: 280, background: '#16213e', borderRight: '1px solid #333' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>World Settings</h2>
      <label style={labelStyle}>
        Camera pitch
        <input
          type="range"
          min={10}
          max={70}
          value={settings.camera.pitchDeg}
          onChange={(e) => updateCamera('pitchDeg', Number(e.target.value))}
        />
        <span>{settings.camera.pitchDeg}°</span>
      </label>
      <label style={labelStyle}>
        Camera yaw
        <input
          type="range"
          min={0}
          max={360}
          value={settings.camera.yawDeg}
          onChange={(e) => updateCamera('yawDeg', Number(e.target.value))}
        />
        <span>{settings.camera.yawDeg}°</span>
      </label>
      <label style={labelStyle}>
        View height
        <input
          type="range"
          min={80}
          max={240}
          value={settings.camera.viewHeightVoxels}
          onChange={(e) => updateCamera('viewHeightVoxels', Number(e.target.value))}
        />
      </label>
      <label style={labelStyle}>
        Anim step rate
        <input
          type="range"
          min={1}
          max={12}
          step={0.5}
          value={settings.timing.animStepRate}
          onChange={(e) => updateTiming('animStepRate', Number(e.target.value))}
        />
        <span>{settings.timing.animStepRate} Hz</span>
      </label>
      <label style={labelStyle}>
        World tick rate
        <input
          type="range"
          min={30}
          max={120}
          value={settings.timing.worldTickRate}
          onChange={(e) => updateTiming('worldTickRate', Number(e.target.value))}
        />
        <span>{settings.timing.worldTickRate} Hz</span>
      </label>
      <p style={{ fontSize: 11, opacity: 0.7, marginTop: 16 }}>
        Voxel Creator, World Builder, and data editors coming next — engine foundation is live.
      </p>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 12,
  fontSize: 12,
};
