import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const simulation = spawn(process.env.POSTMAN_BIN || 'postman', [
  'simulation', 'run', 'postman/simulations/docker.sim.yaml',
  '--port', '41743', '--no-history', '--output', 'ndjson',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const stdout: string[] = [];
const stderr: string[] = [];
const lines = createInterface({ input: simulation.stdout });
simulation.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));

async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
  child.kill('SIGINT');
  const soft = setTimeout(() => child.kill('SIGTERM'), 3000);
  const hard = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(soft); clearTimeout(hard); }
}

let testProcess: ChildProcess | undefined;
const interrupt = (): void => { simulation.kill('SIGINT'); testProcess?.kill('SIGINT'); };
process.once('SIGINT', interrupt);
try {
  await new Promise<void>((ready, failed) => {
    const timeout = setTimeout(() => failed(new Error('Postman simulation did not start within 20 seconds. Check port 41743.')), 20000);
    const reject = (error: Error): void => { clearTimeout(timeout); failed(error); };
    simulation.once('error', () => reject(new Error('Postman CLI is required. Install it and add it to PATH, or set POSTMAN_BIN. See README.md.')));
    simulation.once('exit', code => reject(new Error(`Postman simulation exited before readiness (${code}): ${stderr.join('').slice(-2000)}`)));
    lines.on('line', (line: string) => {
      stdout.push(line);
      try {
        const event: unknown = JSON.parse(line);
        if (typeof event === 'object' && event !== null && 'event' in event && event.event === 'listening') {
          clearTimeout(timeout);
          ready();
        }
      } catch { /* Non-event CLI output is retained in the local test log. */ }
    });
  });
  console.log('Postman simulation ready on localhost:41743. Running proxy checks.');
  testProcess = spawn(process.execPath, ['--test', '--test-reporter=spec', 'verify.mjs'], { cwd: root, stdio: 'inherit' });
  process.exitCode = await new Promise<number>((finished, failed) => {
    testProcess?.once('error', failed);
    testProcess?.once('exit', (code, signal) => finished(signal ? 1 : code ?? 1));
  });
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await stop(simulation);
  lines.close();
  process.removeListener('SIGINT', interrupt);
  await mkdir(resolve(root, '.test-output'), { recursive: true });
  await writeFile(resolve(root, '.test-output/simulation.ndjson'), stdout.join('\n') + '\n');
  if (stderr.length) await writeFile(resolve(root, '.test-output/simulation.stderr.log'), stderr.join(''));
}
