import type { Readable, Writable } from "node:stream";

import chalk, { Chalk, chalkStderr } from "chalk";
import { createInterface } from "node:readline";

import { version } from "../../package.json";

const areas = {
  frontend: { title: "Frontend", tone: "cyan" },
  backend: { title: "Backend", tone: "magenta" },
} as const;
export type Area = keyof typeof areas;
export const color = new Chalk({ level: process.env.NO_COLOR ? 0 : chalk.level });
const stderrColor = new Chalk({ level: process.env.NO_COLOR ? 0 : chalkStderr.level });

export function areaPresentation(area: Area, stderr = false) {
  const { title, tone } = areas[area];
  return { title, style: (stderr ? stderrColor : color)[tone] };
}

export function intro(command?: string, profile?: string) {
  const title = [`Prinpo Stack v${version}`, command, profile].filter(Boolean).join(" · ");
  process.stderr.write(`${stderrColor.dim(title)}\n`);
}

function processPrefix(area: Area, stderr = false) {
  const { style } = areaPresentation(area, stderr);
  return style.bold(`[${area}]`.padEnd(11));
}

export function restartNotice(path: string, multipleServers: boolean) {
  const message = `${path} changed, restarting ${multipleServers ? "servers" : "server"}...`;
  process.stderr.write(
    `${processPrefix("backend", true)}${stderrColor.white("[stack]")} ${stderrColor.green(message)}\n`,
  );
}

export function heading(area: Area, message: string) {
  const { title, style } = areaPresentation(area);
  console.log(`\n${style.bold(title)} ${color.dim(`— ${message}`)}`);
}

/** Keep native tool colors when piping into our labeled output. */
export function labeledEnvironment(env: NodeJS.ProcessEnv) {
  if (process.env.NO_COLOR || env.NO_COLOR) return { ...env, FORCE_COLOR: "0" };
  const level = Math.max(color.level, stderrColor.level);
  return level && env.FORCE_COLOR === undefined ? { ...env, FORCE_COLOR: String(level) } : env;
}

/** Readline handles split chunks, UTF-8, CRLF, and the final unterminated line. */
export function forwardLines(input: Readable, output: Writable, area: Area, stderr = false) {
  const prefix = processPrefix(area, stderr);
  createInterface({ input, crlfDelay: Infinity, terminal: false }).on("line", (line) => {
    output.write(`${prefix}${line}\n`);
  });
}

export interface BuildResult {
  area: Area;
  directory: string;
  bytes: number;
  milliseconds: number;
}

function size(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  return bytes < 1_000_000
    ? `${(bytes / 1000).toFixed(2)} kB`
    : `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function duration(milliseconds: number) {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;
}

export function buildSummary(results: BuildResult[], milliseconds: number, profile: string) {
  console.log(
    `\n${color.green.bold("✓ Build complete")} ${color.dim(`· Stack v${version} · ${profile}`)}\n`,
  );
  for (const result of results) {
    const { title, style } = areaPresentation(result.area);
    console.log(
      `  ${style(title.padEnd(10))}${size(result.bytes).padEnd(13)}${duration(result.milliseconds).padEnd(12)}${color.dim(result.directory)}`,
    );
  }
  console.log(
    `  ${color.bold("Total".padEnd(10))}${size(results.reduce((total, result) => total + result.bytes, 0)).padEnd(13)}${duration(milliseconds)}`,
  );
  console.log(color.dim("\n  Uncompressed output; external dependencies excluded.\n"));
}
