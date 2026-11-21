import { spawn } from 'node:child_process';
import type { BinaryStatus, SystemStatus } from './types.ts';

function checkBinary(command: string, args: string[]): Promise<BinaryStatus> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(command, args, { shell: false });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve({ installed: false, version: null, error: `${command} check timed out.` });
      }
    }, 5000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        installed: false,
        version: null,
        error: err.code === 'ENOENT' ? `${command} not found in PATH.` : err.message,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        const firstLine = stdout.split(/\r?\n/)[0]?.trim() || 'installed';
        const versionMatch = firstLine.match(/(?:ffmpeg version\s+)?([^\s,]+)/i);
        const version = command === 'ffmpeg' ? (firstLine.match(/ffmpeg version\s+([^\s]+)/i)?.[1] ?? firstLine) : (versionMatch?.[1] ?? firstLine);
        resolve({ installed: true, version });
      } else {
        resolve({
          installed: false,
          version: null,
          error: stderr.trim() || `${command} exited with code ${code}.`,
        });
      }
    });
  });
}

export async function getSystemStatus(
  online: boolean,
  lastNetworkCheck: number,
  downloadsDir: string
): Promise<SystemStatus> {
  const [ytdlp, ffmpeg] = await Promise.all([
    checkBinary('yt-dlp', ['--version']),
    checkBinary('ffmpeg', ['-version']),
  ]);

  return {
    ytdlp,
    ffmpeg,
    online,
    lastNetworkCheck,
    downloadsDir,
  };
}

export function updateYtDlp(): Promise<{ ok: boolean; output: string; version: string | null }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn('yt-dlp', ['-U'], { shell: false });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve({
          ok: false,
          output: 'yt-dlp update timed out after 60 seconds.',
          version: null,
        });
      }
    }, 60000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        output:
          err.code === 'ENOENT'
            ? 'yt-dlp is not installed on this machine. Follow the setup instructions first.'
            : err.message,
        version: null,
      });
    });

    child.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      const status = await checkBinary('yt-dlp', ['--version']);
      resolve({
        ok: code === 0,
        output: combined || (code === 0 ? 'yt-dlp updated successfully.' : `yt-dlp -U exited with code ${code}.`),
        version: status.version,
      });
    });
  });
}
