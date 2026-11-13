import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceRoot = join(projectRoot, 'src');

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('runtime policy (static source scan)', () => {
  const files = sourceFiles(sourceRoot);
  const sources = files.map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
  }));

  it('finds the expected source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('imports only relative modules and type-only contracts', () => {
    for (const source of sources) {
      const specifiers = [
        ...source.text.matchAll(/from\s+["']([^"']+)["']/g),
        ...source.text.matchAll(/import\s*\(\s*["']([^"']+)["']/g),
      ].map((match) => match[1] ?? '');

      for (const specifier of specifiers) {
        expect(specifier.length).toBeGreaterThan(0);
        expect(specifier, `${source.file} imports ${specifier}`).toMatch(/^\.\.?\//);
        expect(specifier.endsWith('.js') || specifier.endsWith('.ts')).toBe(true);
      }
    }
  });

  it('contains no network, filesystem, process, or storage capability', () => {
    const forbidden = [
      /\bnpm\b/,
      /\brequire\s*\(/,
      /\bimport\s*\(/,
      /\beval\s*\(/,
      /\bnew\s+Function\b/,
      /\bFunction\s*\(/,
      /\bprocess\s*\./,
      /\bglobalThis\b/,
      /\bwindow\s*\./,
      /\bdocument\s*\./,
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      /\bindexedDB\b/,
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bsendBeacon\b/,
      /\bchild_process\b/,
      /\bworker_threads\b/,
      /\bnode:/,
    ];

    for (const source of sources) {
      for (const pattern of forbidden) {
        expect(pattern.test(source.text), `${source.file} matches ${pattern}`).toBe(false);
      }
    }
  });

  it('declares zero runtime dependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      files?: string[];
      type?: string;
      engines?: Record<string, string>;
    };

    expect(packageJson.dependencies).toEqual({});
    expect(packageJson.type).toBe('module');
    expect(packageJson.engines?.node).toBe('>=22');
    expect(packageJson.files).toEqual(['dist', 'LICENSE', 'README.md']);
  });
});
