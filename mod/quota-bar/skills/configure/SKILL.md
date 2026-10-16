---
name: configure
description: Change or explain the Claude Quota Bar VS Code status bar meter, which shows your 5-hour session and weekly Claude usage. Covers thresholds (when it turns green, yellow or red), colour palettes and custom colours, meter style and glyphs, animation, and alert sounds and notifications. Also answers what the current usage is. Use when the person asks to change the quota bar, usage meter, status bar colours, limits warning, alert sound or animation, or asks how much of their Claude session or weekly limit is used.
---

# Configure Claude Quota Bar

The extension reads its settings from VS Code's **user** `settings.json`, under keys that
start with `claudeQuota.`. It applies changes live: there is no reload and nothing to restart.

## 1. Find the source of truth

The full list of settings comes from the installed extension's manifest. Read it; do not
rely on memory:

```bash
ls -d ~/.vscode/extensions/tidal.claude-quota-bar-* | sort -V | tail -1
```

Read `contributes.configuration.properties` in that folder's `package.json`. It holds every
key, its type, its allowed `enum` values, its `minimum`/`maximum`, and its default.

Find the user settings file. Use the first one that exists:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Code/User/settings.json` |
| Linux | `~/.config/Code/User/settings.json` |
| Windows | `%APPDATA%\Code\User\settings.json` |

For VS Code Insiders, use `Code - Insiders` in place of `Code`.

## 2. Turn the request into settings

- **Thresholds** are per limit: `claudeQuota.session.*` is the 5-hour window and
  `claudeQuota.weekly.*` is the week. `warnAt` is where yellow starts and `criticalAt` is
  where red starts. When the person names neither limit, change both. `warnAt` must stay
  below `criticalAt`. If a request would break that, say so and ask.
- **Colours**: `claudeQuota.colors.palette` picks a preset. `claudeQuota.colors.ok`, `.warn`
  and `.critical` override single colours as `#RRGGBB`. Map colour names to hex yourself
  (for example, "soft green" becomes `#8FBC8F`) and say which hex you chose. An empty string
  goes back to the palette's colour.
- **Calmer** or **less distracting** usually means: `animation.pulse` set to `off`,
  `colors.background` set to `none`, the `subtle` palette, and maybe `alerts.sound` set to
  `criticalOnly` or `off`.
- **More colourful** or **more lively** usually means: the `vivid` or `neon` palette,
  `colors.mode` set to `gradient`, and `animation.pulse` set to `warnAndCritical`.
- **Smaller**, **slimmer** or **collapse** means `display.collapsed` set to `true` (only
  `5h 19%  7d 38%`), and **expand** sets it back to `false`. A shorter bar is
  `display.barWidth`, and hiding the week is `display.showWeekly`.
- **Colour-blind friendly** means the `colorblind` palette.
- Change only what was asked. Use a value from the manifest's `enum` and stay inside its
  `minimum`/`maximum`. If a request matches no setting, say so instead of inventing a key.

## 3. Edit the file

`settings.json` is JSONC: it can contain comments and trailing commas. Edit it with the Edit
tool. Never rewrite the whole file and never reformat it.

- If the key exists, replace only its value.
- If it does not exist, add the key just before the closing `}` of the top-level object, and
  make sure the entry before it ends with a comma.
- A setting changed back to its default can simply be removed.

## 4. Confirm

Re-read the lines you changed. Then tell the person what changed as `setting: old → new`,
where `old` is the default when the key was not set before. Mention that the status bar has
already updated. For colour, threshold or alert changes, suggest **Claude Quota: Play Demo**
from the command palette. It runs the meter through green, yellow and red, with the alert, in
about 10 seconds.

## Current usage

When asked how much is used, read `~/.claude/quota-bar/state.json`. `rate_limits.five_hour`
is the session window and `rate_limits.seven_day` is the week. Each has `used_percentage`,
and `resets_at` in Unix epoch seconds. `updatedAt` says when Claude Code last reported, also
in epoch seconds. Give the percentages, the time left until each reset, and how old the
reading is. The numbers come from Claude Code's most recent reply, so they can trail the
`/usage` command slightly.
