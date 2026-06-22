export type InputAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'cancel'
  | 'menu'
  | 'run'
  | 'talk';

const DEFAULT_BINDINGS: Record<InputAction, string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'KeyZ', 'Space'],
  cancel: ['Escape', 'KeyX'],
  menu: ['Tab', 'KeyM'],
  run: ['ShiftLeft', 'ShiftRight'],
  talk: ['KeyE'],
};

export class InputSystem {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private bindings = structuredClone(DEFAULT_BINDINGS);

  attach(target: Window = window): () => void {
    const down = (e: KeyboardEvent) => {
      if (!this.held.has(e.code)) this.pressed.add(e.code);
      this.held.add(e.code);
    };
    const up = (e: KeyboardEvent) => this.held.delete(e.code);
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
    };
  }

  isHeld(action: InputAction): boolean {
    return this.bindings[action].some((code) => this.held.has(code));
  }

  wasPressed(action: InputAction): boolean {
    return this.bindings[action].some((code) => this.pressed.has(code));
  }

  /** Call once per world tick after reading input */
  endFrame(): void {
    this.pressed.clear();
  }

  getAxis(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.isHeld('left')) x -= 1;
    if (this.isHeld('right')) x += 1;
    if (this.isHeld('up')) z -= 1;
    if (this.isHeld('down')) z += 1;
    if (x !== 0 && z !== 0) {
      const s = 1 / Math.SQRT2;
      x *= s;
      z *= s;
    }
    return { x, z };
  }
}
