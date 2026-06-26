import { GameEngine } from '@voxelbound/engine';
import { DEFAULT_WORLD_SETTINGS } from '@voxelbound/shared';
import type { WorldSettings } from '@voxelbound/shared';
import { allArchetypes, allModels } from '@voxelbound/shared';
import './style.css';
import { GameController } from './game/GameController';
import { loadLibrary } from './editor/voxelDoc';

const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'game-canvas';
app.appendChild(canvas);

const settings = structuredClone(DEFAULT_WORLD_SETTINGS) as unknown as WorldSettings;
settings.camera.pitchDeg = 40;
settings.camera.viewHeightVoxels = 200;

const engine = new GameEngine({ canvas, settings });
engine.registerContent(allModels, allArchetypes);
// register any models the player created in the editor so they are placeable
for (const m of loadLibrary()) engine.animation.registerModel(m);
engine.initOverworld();
engine.paused = true; // wait on the title screen
engine.start();
requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

new GameController(engine);

// dev: expose engine for debugging/automation
(window as unknown as { __vb?: unknown }).__vb = engine;

// ---- World / Graphics live settings panel ----
const panel = document.getElementById('settings-panel')!;
const toggle = document.getElementById('settings-toggle')!;
toggle.addEventListener('click', () => panel.classList.toggle('open'));

function applySettingsFromUI(): void {
  settings.camera.pitchDeg = Number((document.getElementById('pitch') as HTMLInputElement).value);
  settings.camera.yawDeg = Number((document.getElementById('yaw') as HTMLInputElement).value);
  settings.camera.viewHeightVoxels = Number((document.getElementById('viewH') as HTMLInputElement).value);
  settings.timing.animStepRate = Number((document.getElementById('animRate') as HTMLInputElement).value);
  settings.timing.worldTickRate = Number((document.getElementById('worldRate') as HTMLInputElement).value);
  settings.render.ambientIntensity = Number((document.getElementById('ambient') as HTMLInputElement).value) / 100;
  engine.applySettings(settings);
  document.getElementById('pitch-val')!.textContent = `${settings.camera.pitchDeg}°`;
  document.getElementById('yaw-val')!.textContent = `${settings.camera.yawDeg}°`;
  document.getElementById('viewH-val')!.textContent = String(settings.camera.viewHeightVoxels);
}

['pitch', 'yaw', 'viewH', 'animRate', 'worldRate', 'ambient'].forEach((id) => {
  document.getElementById(id)!.addEventListener('input', applySettingsFromUI);
});
applySettingsFromUI();
