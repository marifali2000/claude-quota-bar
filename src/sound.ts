import { execFile } from 'child_process';
import * as fs from 'fs';

// The extension host has no audio API, so play through the OS's own player.
// Fire-and-forget: a missing player or file must never break the extension.

const MAC_DEFAULT = '/System/Library/Sounds/Glass.aiff';
const WIN_DEFAULT = 'C:\\Windows\\Media\\chimes.wav';
const LINUX_DEFAULTS = [
  '/usr/share/sounds/freedesktop/stereo/message.oga',
  '/usr/share/sounds/freedesktop/stereo/complete.oga',
];

export function playSound(file: string, volume: number): void {
  const quiet = () => undefined;
  const v = Math.min(1, Math.max(0, volume));

  if (process.platform === 'darwin') {
    execFile('afplay', ['-v', String(v), file || MAC_DEFAULT], quiet);
  } else if (process.platform === 'win32') {
    const path = (file || WIN_DEFAULT).replace(/'/g, "''");
    execFile('powershell', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${path}').PlaySync()`], quiet);
  } else {
    const target = file || LINUX_DEFAULTS.find((f) => fs.existsSync(f));
    if (target) {
      execFile('paplay', [target], (err) => {
        if (err) execFile('aplay', ['-q', target], quiet);
      });
    } else {
      execFile('canberra-gtk-play', ['-i', 'message'], quiet);
    }
  }
}
