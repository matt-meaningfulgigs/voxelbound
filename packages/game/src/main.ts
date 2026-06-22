import { GameEngine } from '@voxelbound/engine';
import { DEFAULT_WORLD_SETTINGS } from '@voxelbound/shared';
import { allArchetypes, allModels } from '@voxelbound/shared';

const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
app.appendChild(canvas);

const settings = structuredClone(DEFAULT_WORLD_SETTINGS);

const engine = new GameEngine({ canvas, settings });
engine.registerContent(allModels, allArchetypes);
engine.initOverworld();
engine.start();

// World Settings UI
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
  // Recreate scheduler timing — for demo, update readout only
  document.getElementById('tick-readout')!.textContent =
    `anim: ${settings.timing.animStepRate} Hz · sim: ${settings.timing.worldTickRate} Hz`;
}

['pitch', 'yaw', 'viewH', 'animRate', 'worldRate', 'ambient'].forEach((id) => {
  document.getElementById(id)!.addEventListener('input', applySettingsFromUI);
});

applySettingsFromUI();

console.log('VoxelBound engine running — milestone 1-8 foundation');
