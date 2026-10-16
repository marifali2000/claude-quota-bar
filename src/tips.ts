// Token-saving tips and best practices for the hover. Pure: no vscode import.

import { Level } from './quota';

export const GENERAL_TIPS: readonly string[] = [
  'Run `/clear` when you switch to an unrelated task. Every message resends the conversation so far, so a fresh start makes each reply cheaper.',
  'Run `/compact` in long conversations. It summarises the history, so later replies resend less. Add a focus, like `/compact keep the API decisions`.',
  'Switch to Sonnet or Haiku with `/model` for routine edits, lookups and tests. Opus uses your limits faster.',
  'Name the files you mean with `@path/to/file` instead of asking Claude to search the repo. Exploring costs tokens.',
  'Keep CLAUDE.md short. It is loaded into every conversation, so each line is paid for on every request.',
  'Turn off MCP servers you are not using in `/mcp`. Their tool definitions take up context in every request.',
  'Run `/context` to see what fills your context window: system prompt, tools, memory files and conversation.',
  'Press Esc as soon as Claude heads the wrong way. A quick correction costs less than a long reply you throw away.',
  'For bigger changes, ask for a plan first (Shift+Tab for plan mode). Agreeing on the approach is cheaper than redoing the work.',
  'Paste only the relevant lines of a log or stack trace, or point Claude at the file. A huge paste stays in the context for the rest of the conversation.',
  'Put related questions in one message instead of several. Each message resends the whole conversation.',
  'Hand broad searches to a subagent. It explores in its own context and returns a summary, so your main conversation stays small.',
  'Run `/usage` for exact, up-to-the-minute limit numbers. This meter updates after each reply.',
  'Start long tasks right after your 5-hour window resets, so they do not hit the limit halfway.',
];

export interface TipContext {
  sessionLevel?: Level;
  weeklyLevel?: Level;
  sessionRunsOut?: boolean;
  /** Context window fill of the session that last replied, 0 to 100. */
  contextPercent?: number;
  /** Prompt cache hit ratio, 0 to 1 (terminal sessions only). */
  cacheHitRatio?: number;
  /** When the 5-hour window resets, already formatted. */
  sessionResetsIn?: string;
}

/** Tips that apply to the moment, most urgent first. */
export function situationalTips(c: TipContext): string[] {
  const tips: string[] = [];
  if (c.sessionLevel === 'critical' || c.sessionRunsOut) {
    tips.push(
      `You are close to the 5-hour limit${c.sessionResetsIn ? ` (it resets in ${c.sessionResetsIn})` : ''}. Ask Claude to write a short handoff note to a file, then \`/clear\` and pick up from the note.`,
    );
  }
  if (c.contextPercent !== undefined && c.contextPercent >= 60) {
    tips.push(
      `The last conversation's context is ${Math.round(c.contextPercent)}% full, and every reply resends it. Run \`/compact\` now, or \`/clear\` if you are starting something new.`,
    );
  }
  if (c.weeklyLevel === 'warn' || c.weeklyLevel === 'critical') {
    tips.push('Weekly usage is high. Save Opus for the hard problems and use Sonnet for everything else this week.');
  }
  if (c.cacheHitRatio !== undefined && c.cacheHitRatio < 0.5) {
    tips.push(
      `Prompt cache hits are low (${Math.round(c.cacheHitRatio * 100)}%). A long pause lets the cache expire, so the first reply after a break costs more. Batch questions while you are in flow.`,
    );
  }
  return tips;
}

/**
 * The tip for this hover. `turn` advances on every rotation; situational tips
 * take every other turn so the general ones still come round.
 */
export function pickTip(c: TipContext, turn: number): string {
  const urgent = situationalTips(c);
  if (urgent.length && turn % 2 === 0) return urgent[(turn / 2) % urgent.length];
  return GENERAL_TIPS[turn % GENERAL_TIPS.length];
}
