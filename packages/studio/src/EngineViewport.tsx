import { useEffect, useRef } from 'react';
import { GameEngine } from '@voxelbound/engine';
import { useStudioStore } from './store';
import { allArchetypes, allModels } from '@voxelbound/shared';

export function EngineViewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const settings = useStudioStore((s) => s.settings);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine({ canvas, settings: structuredClone(settings) });
    engine.registerContent(allModels, allArchetypes);
    engine.initOverworld();
    engine.start();
    engineRef.current = engine;
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.applySettings(settings);
  }, [settings]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }}
    />
  );
}
