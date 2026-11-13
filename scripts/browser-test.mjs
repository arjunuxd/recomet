/**
 * Real-browser correctness harness.
 *
 * Uses the installed Microsoft Edge and Google Chrome executables in headless
 * mode. Firefox is attempted through its CDP remote agent. WebKit and Safari are
 * not available on Windows, so they are reported as unverified, never inferred
 * from Chromium results.
 *
 * No browser automation dependency is added. Results are machine-specific.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const distRoot = join(projectRoot, 'dist');
const browserRoot = join(projectRoot, 'tests', 'browser');
const resultsPath = join(projectRoot, 'benchmarks', 'browser-results.json');
const RESULT_PREFIX = 'RECOMET_RESULT:';

const candidates = [
  {
    name: 'Microsoft Edge',
    kind: 'chromium',
    executable: join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
  },
  {
    name: 'Google Chrome',
    kind: 'chromium',
    executable: join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
  },
  {
    name: 'Mozilla Firefox',
    kind: 'firefox',
    executable: join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Mozilla Firefox',
      'firefox.exe',
    ),
  },
];

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function safeResolve(base, pathname) {
  const normalized = normalize(pathname).replace(/^([/\\])+/, '');
  const resolved = resolve(base, normalized);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    return undefined;
  }
  return resolved;
}

async function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    let filePath;

    if (url.pathname === '/') {
      filePath = join(browserRoot, 'index.html');
    } else if (url.pathname === '/suite.js') {
      filePath = join(browserRoot, 'suite.js');
    } else if (url.pathname.startsWith('/dist/')) {
      filePath = safeResolve(distRoot, url.pathname.slice('/dist/'.length));
    }

    if (filePath === undefined || !existsSync(filePath)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }

    try {
      const body = readFileSync(filePath);
      response.writeHead(200, {
        'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('read failure');
    }
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not determine harness port');
  }
  return { server, port: address.port };
}

function browserVersion(executable) {
  if (process.platform === 'win32') {
    const escaped = executable.replace(/'/g, "''");
    const metadata = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`,
      ],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true },
    );
    const metadataVersion = (metadata.stdout ?? '').trim();
    if (metadataVersion.length > 0) {
      return metadataVersion;
    }
  }

  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''} ${result.stderr ?? ''}`.trim();
  return output.length > 0 ? output.replace(/\s+/g, ' ') : 'unknown';
}

function parseResultTitle(title) {
  if (typeof title !== 'string' || !title.startsWith(RESULT_PREFIX)) {
    return undefined;
  }
  return JSON.parse(decodeURIComponent(title.slice(RESULT_PREFIX.length)));
}

function extractTitle(dom) {
  const match = dom.match(/<title>([^<]*)<\/title>/);
  return match?.[1];
}

function runChromium(executable, url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'recomet-browser-'));
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--virtual-time-budget=20000',
      `--user-data-dir=${userDataDir}`,
      '--dump-dom',
      url,
    ];

    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      rmSync(userDataDir, { recursive: true, force: true });
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    };

    const timer = setTimeout(() => {
      child.kill();
      fail(new Error('headless browser timed out'));
    }, 60_000);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => fail(error));
    child.on('close', () => {
      if (settled) {
        return;
      }
      let summary;
      try {
        summary = parseResultTitle(extractTitle(stdout));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (summary === undefined) {
        const output = `${stdout}\n${stderr}`.trim();
        fail(
          new Error(`result not produced${output.length > 0 ? `: ${output.slice(0, 200)}` : ''}`),
        );
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(summary);
    });
  });
}

function getFreePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = createNetServer();
    probe.once('error', rejectPromise);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        rejectPromise(new Error('Could not allocate a debugging port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolvePromise(port));
    });
  });
}

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function connectWebSocket(webSocketUrl, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await new Promise((resolvePromise, rejectPromise) => {
        const socket = new WebSocket(webSocketUrl);
        const timer = setTimeout(() => {
          socket.close();
          rejectPromise(new Error('WebSocket open timed out'));
        }, 5_000);

        socket.addEventListener(
          'open',
          () => {
            clearTimeout(timer);
            resolvePromise(socket);
          },
          { once: true },
        );
        socket.addEventListener(
          'error',
          () => {
            clearTimeout(timer);
            socket.close();
            rejectPromise(new Error('WebSocket connection failed'));
          },
          { once: true },
        );
      });
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }

  throw lastError ?? new Error('could not connect to the browser remote agent');
}

function bidiSession(socket, url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const pending = new Map();
    let nextId = 0;
    let settled = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Ignore close failures while cleaning up.
      }
      if (error !== undefined) {
        rejectPromise(error);
      } else {
        resolvePromise(value);
      }
    };

    const send = (method, params = {}) =>
      new Promise((resolveSend, rejectSend) => {
        const id = (nextId += 1);
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
        socket.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.delete(id)) {
            rejectSend(new Error(`${method} timed out`));
          }
        }, 10_000);
      });

    const timer = setTimeout(() => finish(new Error('browser session timed out')), 60_000);

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter === undefined) {
        return;
      }
      pending.delete(message.id);
      if (message.type === 'error') {
        waiter.reject(new Error(`${message.error ?? 'BiDi error'}: ${message.message ?? ''}`));
      } else {
        waiter.resolve(message.result);
      }
    });

    socket.addEventListener('error', () => finish(new Error('WebSocket connection failed')));
    socket.addEventListener('close', () => {
      if (!settled) {
        finish(new Error('WebSocket closed before a result was produced'));
      }
    });

    void (async () => {
      try {
        const session = await send('session.new', { capabilities: {} });
        const tree = await send('browsingContext.getTree', {});
        let context = Array.isArray(tree?.contexts) ? tree.contexts[0]?.context : undefined;
        if (typeof context !== 'string') {
          const created = await send('browsingContext.create', { type: 'tab' });
          context = created?.context;
        }
        if (typeof context !== 'string') {
          throw new Error('no browsing context available');
        }

        await send('browsingContext.navigate', { context, url, wait: 'complete' });

        for (let attempt = 0; attempt < 40; attempt += 1) {
          const evaluation = await send('script.evaluate', {
            expression: 'document.title',
            target: { context },
            awaitPromise: false,
            resultOwnership: 'none',
          });
          const summary = parseResultTitle(evaluation?.result?.value);
          if (summary !== undefined) {
            summary.browserVersion = session?.capabilities?.browserVersion;
            finish(undefined, summary);
            return;
          }
          await sleep(250);
        }
        finish(new Error('result title not produced'));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

async function runFirefox(executable, url) {
  const port = await getFreePort();
  const userDataDir = mkdtempSync(join(tmpdir(), 'recomet-firefox-'));
  const child = spawn(
    executable,
    [
      '--headless',
      '--no-remote',
      '--profile',
      userDataDir,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  try {
    const socket = await connectWebSocket(`ws://127.0.0.1:${port}/session`, 20_000);
    return await bidiSession(socket, url);
  } finally {
    child.kill();
    await sleep(250);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

function summarize(summary) {
  return {
    status: summary.ok ? 'passed' : 'failed',
    passed: summary.passed,
    failed: summary.failed,
    userAgent: summary.userAgent,
    tests: summary.results,
  };
}

const { server, port } = await startServer();
const url = `http://127.0.0.1:${port}/`;
const browserResults = [];

try {
  for (const candidate of candidates) {
    const installed = existsSync(candidate.executable);
    if (!installed) {
      browserResults.push({
        browser: candidate.name,
        status: 'not-installed',
        reason: 'Executable not found on this machine.',
      });
      continue;
    }

    const version = browserVersion(candidate.executable);
    try {
      const summary =
        candidate.kind === 'chromium'
          ? await runChromium(candidate.executable, url)
          : await runFirefox(candidate.executable, url);
      browserResults.push({
        browser: candidate.name,
        version: summary.browserVersion ?? version,
        executableKind: candidate.kind,
        ...summarize(summary),
      });
    } catch (error) {
      browserResults.push({
        browser: candidate.name,
        version,
        status: 'unverified',
        reason: error instanceof Error ? error.message : 'unknown failure',
      });
    }
  }
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  note: 'Real-browser execution on this machine. WebKit results would not prove Safari compatibility; Safari is unverified on Windows.',
  nodeVersion: process.version,
  unverified: [
    {
      browser: 'Safari',
      reason: 'Safari is not available on Windows and was not executed.',
    },
    {
      browser: 'WebKit',
      reason:
        'No WebKit runtime is installed or executed; WebKit would not be treated as Safari evidence.',
    },
  ],
  browsers: browserResults,
};

writeFileSync(resultsPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const entry of browserResults) {
  if (entry.status === 'passed' || entry.status === 'failed') {
    console.log(
      `${entry.browser} (${entry.version}): ${entry.status} — ${entry.passed} passed, ${entry.failed} failed`,
    );
  } else {
    console.log(`${entry.browser}: ${entry.status} — ${entry.reason}`);
  }
}
console.log('Safari: unverified (not available on Windows)');
console.log('WebKit: unverified (not executed)');
console.log(`\nWrote ${resultsPath}`);

const failed = browserResults.some((entry) => entry.status === 'failed');
if (failed) {
  process.exitCode = 1;
}
