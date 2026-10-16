# I Kept Hitting My Claude Limit Mid-Task. So I Put It in My Status Bar.

## A tiny VS Code extension that shows your 5-hour and weekly Claude usage, warns you before you run out, and coaches you to spend fewer tokens.

![Claude Quota Bar: never hit your Claude limit by surprise](https://raw.githubusercontent.com/marifali2000/claude-quota-bar/main/article/images/cover.png)

It always happens at the worst moment. I'm three files into a refactor, Claude is halfway through a migration, and the limit hits. Back in two hours.

Claude's Pro and Max plans meter usage in two rolling windows: a **5-hour session** and a **week**. When either runs out, you wait. Claude Code will tell you where you stand, but only if you stop and type `/usage`. Nobody does that mid-flow.

So I built **Claude Quota Bar**: both limits, always visible, right where I already look.

## Two numbers, always in view

![The full and compact views in the VS Code status bar](https://raw.githubusercontent.com/marifali2000/claude-quota-bar/main/article/images/views.png)

*The full view shows usage and time to reset for both limits. Click it for the compact view.*

`5h ▰▰▰▱▱ 64% 1h40m` means 64% of the 5-hour window is used, and it resets in 1 hour 40 minutes. The `7d` item does the same for the week.

Colour does the rest:

- **Green** below 60%: carry on.
- **Yellow** from 60%: pace yourself.
- **Red** from 90%: wrap up.

You set both thresholds, separately for each window. A small 🔥 appears when your current pace will run out before the reset. That's the signal I wished I'd had all along.

## A warning you can't miss

![Green, yellow and red states, and the alert](https://raw.githubusercontent.com/marifali2000/claude-quota-bar/main/article/images/states.png)

*Crossing a threshold flashes the meter and tells you how long you have left.*

Each threshold fires once per window, and only once across all your VS Code windows. At red, a quiet chime plays too. All of it can be configured, including turning it off.

## The hover is a coach, not a dashboard

![The hover: pace, burn rate, room left and a tip](https://raw.githubusercontent.com/marifali2000/claude-quota-bar/main/article/images/hover.png)

*Hover for pace, burn rate, room left and a tip that fits the moment.*

Hovering answers the questions I actually have:

- **Pace:** am I ahead of or behind an even spend?
- **Burn:** how fast am I using it, this hour and on average?
- **Room:** how much can I use per hour, or per day, and still last until the reset?
- **Outlook:** will this pace last?

It also shows the last conversation's context fill and estimated cost, plus a tip. When the context is 67% full, the tip says so and suggests `/compact`. When the week runs hot, it suggests saving Opus for the hard problems.

## Five habits that stretch your limits

These are among the tips the extension rotates through. They work with or without it.

1. **`/clear` between unrelated tasks.** Every message resends the whole conversation, so a fresh start makes each reply cheaper.
2. **`/compact` long conversations**, ideally with a focus: `/compact keep the API decisions`.
3. **Match the model to the job.** Use Sonnet or Haiku for routine edits and tests, and save Opus for the hard problems.
4. **Point, don't search.** `@src/billing/refunds.ts` costs far less than "find where we handle refunds".
5. **Keep CLAUDE.md lean and unused MCP servers off.** Both ride along on every request.

## Change settings by asking Claude

The extension ships with a Claude Code skill, so you never need the settings page. Just ask:

```
make the quota bar red from 85% and yellow from 50%
use the colour-blind palette and turn the pulse off
how much of my weekly limit have I used?
```

Claude edits your VS Code settings, and the meter updates instantly.

## How it works: no network, no tokens

![Claude Code writes the numbers to a file; the extension watches it](https://raw.githubusercontent.com/marifali2000/claude-quota-bar/main/article/images/architecture.png)

*Claude Code already knows your limits. The extension just listens.*

Claude Code receives your rate-limit figures with every reply. A small plugin hook (for the VS Code chat panel) and a status line script (for the terminal) save them to a JSON file in `~/.claude`. The extension watches that file.

There are no API keys, no login tokens, and no calls home. The trade-off is that the numbers update when Claude replies, so usage elsewhere, such as claude.ai or another machine, shows up after your next message.

One lesson worth sharing: **the VS Code chat panel never runs Claude Code's status line command.** I watched it through an hour of replies. Plugin hooks do run there, which is why the extension carries both paths.

It's light, too. Animation runs only while something moves and pauses when VS Code is in the background, and each frame sends only what changed.

## Try it in two minutes

You need a Claude Pro or Max plan, VS Code 1.90 or later, and Claude Code 2.1.300 or later.

```
curl -LO https://github.com/marifali2000/claude-quota-bar/releases/latest/download/claude-quota-bar.vsix
code --install-extension claude-quota-bar.vsix
```

Then, in VS Code:

1. Run **Claude Quota: Connect to Claude Code**.
2. Start a new Claude chat.
3. Run **Claude Quota: Play Demo** to see the whole thing in ten seconds.

The code is open on GitHub at [github.com/marifali2000/claude-quota-bar](https://github.com/marifali2000/claude-quota-bar). Issues and pull requests are welcome.

---

*If this saves you one "limit reached" moment, give it a clap, and pass it to the teammate who keeps asking whether Claude is down.*
