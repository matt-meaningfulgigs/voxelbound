import {
  DIALOGUE_BY_ID,
  type DialogueNode,
  type DialogueScript,
  type ScriptAction,
} from '@voxelbound/shared';
import type { GameState } from '../state/GameState';
import { applyAction, evalCondition, type ScriptHooks } from './ScriptEngine';

export type DialogueMode = 'text' | 'choices' | 'suspended' | 'done';

export interface DialogueView {
  mode: DialogueMode;
  speaker?: string;
  text: string;
  choices: Array<{ label: string; index: number }>;
}

interface Continuation {
  actions: ScriptAction[];
  index: number;
  then: () => void;
}

/**
 * Runs a structured dialogue script. UI handles the typewriter and calls
 * advance()/choose(). Pausing actions (battle/shop/warp) suspend the runner;
 * resume() continues afterward (e.g. give the reward after a boss fight).
 */
export class DialogueRunner {
  private gs: GameState;
  private hooks: ScriptHooks;
  private script: DialogueScript | null = null;
  private node: DialogueNode | null = null;
  private page = 0;
  private mode: DialogueMode = 'done';
  private filteredChoices: Array<{ label: string; index: number }> = [];
  private continuation: Continuation | null = null;
  private onEnd: (() => void) | null = null;

  constructor(gs: GameState, hooks: ScriptHooks) {
    this.gs = gs;
    this.hooks = hooks;
  }

  get active(): boolean {
    return this.mode !== 'done';
  }

  start(scriptId: string, onEnd?: () => void): boolean {
    const script = DIALOGUE_BY_ID.get(scriptId);
    if (!script) return false;
    this.script = script;
    this.onEnd = onEnd ?? null;
    const rule = script.start.find((r) => evalCondition(this.gs, r.condition));
    const startNode = rule?.node ?? script.start[script.start.length - 1]?.node;
    if (!startNode) return false;
    this.loadNode(startNode);
    return true;
  }

  view(): DialogueView {
    return {
      mode: this.mode,
      speaker: this.node?.speaker,
      text: this.mode === 'text' ? this.node?.lines[this.page] ?? '' : '',
      choices: this.mode === 'choices' ? this.filteredChoices : [],
    };
  }

  /** Advance past the current text page (UI calls when page fully typed + confirm). */
  advance(): void {
    if (this.mode !== 'text' || !this.node) return;
    if (this.page < this.node.lines.length - 1) {
      this.page += 1;
      return;
    }
    this.finishText();
  }

  choose(index: number): void {
    if (this.mode !== 'choices' || !this.node?.choices) return;
    const choice = this.node.choices[index];
    if (!choice) return;
    this.mode = 'suspended';
    this.runActions(choice.actions ?? [], () => {
      if (choice.goto) this.loadNode(choice.goto);
      else this.end();
    });
  }

  /** Called by the game controller after a pausing action (battle won, shop closed). */
  resume(): void {
    if (!this.continuation) {
      if (this.mode === 'suspended') this.end();
      return;
    }
    const cont = this.continuation;
    this.continuation = null;
    this.runActionsFrom(cont.actions, cont.index, cont.then);
  }

  cancel(): void {
    this.continuation = null;
    this.end();
  }

  // -- internals ------------------------------------------------------------

  private loadNode(id: string): void {
    const node = this.script?.nodes[id];
    if (!node) {
      this.end();
      return;
    }
    this.node = node;
    this.page = 0;
    this.mode = 'text';
    if (node.lines.length === 0) this.finishText();
  }

  private finishText(): void {
    const node = this.node!;
    this.mode = 'suspended';
    this.runActions(node.actions ?? [], () => {
      const choices = (node.choices ?? []).filter((c) => evalCondition(this.gs, c.condition));
      if (choices.length > 0) {
        this.filteredChoices = choices.map((c) => ({
          label: c.label,
          index: (node.choices ?? []).indexOf(c),
        }));
        this.mode = 'choices';
      } else if (node.goto) {
        this.loadNode(node.goto);
      } else {
        this.end();
      }
    });
  }

  private runActions(actions: ScriptAction[], then: () => void): void {
    this.runActionsFrom(actions, 0, then);
  }

  private runActionsFrom(actions: ScriptAction[], start: number, then: () => void): void {
    for (let i = start; i < actions.length; i++) {
      const paused = applyAction(this.gs, actions[i]!, this.hooks);
      if (paused) {
        this.continuation = { actions, index: i + 1, then };
        this.mode = 'suspended';
        return;
      }
    }
    then();
  }

  private end(): void {
    this.mode = 'done';
    this.node = null;
    this.script = null;
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.();
  }
}
