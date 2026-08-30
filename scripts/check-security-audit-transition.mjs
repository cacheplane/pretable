#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_ADVISORY_KEY = "1120680";
const EXPECTED_ADVISORY_ID = 1120680;
const EXPECTED_MODULE = "esbuild";
const EXPECTED_SEVERITY = "low";
const EXPECTED_VULNERABLE_VERSIONS = ">=0.27.3 <0.28.1";
const EXPECTED_FINDING_VERSION = "0.27.7";
const EXPECTED_PATH = ".>tsup>esbuild";
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const EXPECTED_TOTALS = {
  info: 0,
  low: 1,
  moderate: 0,
  high: 0,
  critical: 0,
};
const SUCCESS_MESSAGE =
  "Confirmed security audit transition: advisory 1120680 affects only .>tsup>esbuild at esbuild 0.27.7 (low).";

export const AUDIT_TIMEOUT_MS = 120_000;
export const MAX_AUDIT_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_CLI_DIAGNOSTIC_BYTES = 1024;

const MAX_JSON_DEPTH = 128;
const MAX_ADVISORY_KEYS_IN_DIAGNOSTIC = 12;
const SAFE_JSON_KEYS = new Set([
  "advisories",
  "metadata",
  "vulnerabilities",
  "findings",
  "paths",
  "version",
  "id",
  "severity",
  "module_name",
  "vulnerable_versions",
  ...SEVERITIES,
]);
const SAFE_PROCESS_ERROR_CODES = new Set([
  "EACCES",
  "ENOENT",
  "ENOBUFS",
  "ENOMEM",
  "ETIMEDOUT",
]);
const JSON_NUMBER_TOKEN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function issue(code, message) {
  return { code, message };
}

function failure(...errors) {
  return { ok: false, errors };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function safeProcessErrorCode(error) {
  const code = error?.code;
  return SAFE_PROCESS_ERROR_CODES.has(code) ? code : null;
}

function processFailure(error) {
  const code = safeProcessErrorCode(error);
  if (code === "ETIMEDOUT") {
    return failure(
      issue(
        "AUDIT_TIMEOUT",
        `pnpm audit timed out after ${AUDIT_TIMEOUT_MS} ms.`,
      ),
    );
  }
  if (code === "ENOBUFS") {
    return failure(
      issue(
        "AUDIT_PROCESS_ERROR",
        `pnpm audit exceeded the ${MAX_AUDIT_OUTPUT_BYTES}-byte output buffer.`,
      ),
    );
  }
  return failure(
    issue(
      "AUDIT_PROCESS_ERROR",
      code
        ? `pnpm audit process failed (${code}).`
        : "pnpm audit process failed (unrecognized error code).",
    ),
  );
}

function invalidProcessResult(field) {
  return failure(
    issue(
      "INVALID_PROCESS_RESULT",
      `pnpm audit process result field ${field} has an invalid shape.`,
    ),
  );
}

class DuplicateJsonKeyError extends Error {
  constructor(key) {
    super("duplicate JSON key");
    this.key = key;
  }
}

class InvalidJsonStructureError extends Error {}

/**
 * Parses JSON structure before JSON.parse so duplicate keys remain observable.
 * Every string token is decoded with JSON.parse, which makes escaped and literal
 * spellings compare by their actual key value rather than their source text.
 */
function assertUniqueJsonObjectKeys(text) {
  let index = 0;
  let depth = 0;

  function invalid() {
    throw new InvalidJsonStructureError("invalid JSON structure");
  }

  function skipWhitespace() {
    while (
      text[index] === " " ||
      text[index] === "\n" ||
      text[index] === "\r" ||
      text[index] === "\t"
    ) {
      index += 1;
    }
  }

  function parseString() {
    if (text[index] !== '"') invalid();
    const start = index;
    index += 1;

    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          invalid();
        }
      }
      if (character === "\\") {
        index += 1;
        if (index >= text.length) invalid();
        if (text[index] === "u") {
          if (index + 4 >= text.length) invalid();
          index += 5;
        } else {
          index += 1;
        }
        continue;
      }
      if (text.charCodeAt(index) <= 0x1f) invalid();
      index += 1;
    }
    invalid();
  }

  function parseNumber() {
    JSON_NUMBER_TOKEN.lastIndex = index;
    const match = JSON_NUMBER_TOKEN.exec(text);
    if (!match) invalid();
    index = JSON_NUMBER_TOKEN.lastIndex;
  }

  function enterContainer() {
    depth += 1;
    if (depth > MAX_JSON_DEPTH) invalid();
  }

  function leaveContainer() {
    depth -= 1;
  }

  function parseObject() {
    enterContainer();
    index += 1;
    skipWhitespace();
    const keys = new Set();
    if (text[index] === "}") {
      index += 1;
      leaveContainer();
      return;
    }

    while (index < text.length) {
      const key = parseString();
      if (keys.has(key)) throw new DuplicateJsonKeyError(key);
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ":") invalid();
      index += 1;
      parseValue();
      skipWhitespace();
      if (text[index] === "}") {
        index += 1;
        leaveContainer();
        return;
      }
      if (text[index] !== ",") invalid();
      index += 1;
      skipWhitespace();
    }
    invalid();
  }

  function parseArray() {
    enterContainer();
    index += 1;
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      leaveContainer();
      return;
    }

    while (index < text.length) {
      parseValue();
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        leaveContainer();
        return;
      }
      if (text[index] !== ",") invalid();
      index += 1;
      skipWhitespace();
    }
    invalid();
  }

  function parseValue() {
    skipWhitespace();
    const character = text[index];
    if (character === "{") return parseObject();
    if (character === "[") return parseArray();
    if (character === '"') {
      parseString();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    parseNumber();
  }

  parseValue();
  skipWhitespace();
  if (index !== text.length) invalid();
}

function describeDuplicateKey(key) {
  if (SAFE_JSON_KEYS.has(key) || /^\d{1,12}$/.test(key)) {
    return JSON.stringify(key);
  }
  return "<untrusted-key>";
}

function describeAdvisoryKey(key) {
  return /^\d{1,12}$/.test(key) ? JSON.stringify(key) : "<untrusted-key>";
}

function describeAdvisorySet(keys) {
  const preview = keys
    .slice(0, MAX_ADVISORY_KEYS_IN_DIAGNOSTIC)
    .map(describeAdvisoryKey)
    .join(", ");
  const remainder = keys.length - MAX_ADVISORY_KEYS_IN_DIAGNOSTIC;
  return `${keys.length} keys [${preview}${remainder > 0 ? `, ... (+${remainder} more)` : ""}]`;
}

function parseAuditJson(stdout) {
  const bytes = byteLength(stdout);
  try {
    assertUniqueJsonObjectKeys(stdout);
  } catch (error) {
    if (error instanceof DuplicateJsonKeyError) {
      return failure(
        issue(
          "AUDIT_JSON_DUPLICATE_KEY",
          `pnpm audit JSON contains duplicate object key ${describeDuplicateKey(error.key)}.`,
        ),
      );
    }
    return failure(
      issue(
        "AUDIT_JSON_INVALID",
        `pnpm audit stdout is not valid JSON (${bytes} bytes).`,
      ),
    );
  }

  try {
    return { ok: true, payload: JSON.parse(stdout) };
  } catch {
    return failure(
      issue(
        "AUDIT_JSON_INVALID",
        `pnpm audit stdout is not valid JSON (${bytes} bytes).`,
      ),
    );
  }
}

function validateAuditPayload(payload, stdoutBytes) {
  if (!isRecord(payload)) {
    return failure(
      issue("AUDIT_SCHEMA", "pnpm audit JSON must be a top-level object."),
    );
  }
  if (Object.hasOwn(payload, "error")) {
    return failure(
      issue(
        "AUDIT_ERROR_PAYLOAD",
        `pnpm audit returned a top-level error payload (${stdoutBytes} bytes).`,
      ),
    );
  }
  if (!isRecord(payload.advisories)) {
    return failure(
      issue(
        "AUDIT_SCHEMA",
        "pnpm audit JSON is missing the required top-level advisories object.",
      ),
    );
  }
  if (!isRecord(payload.metadata?.vulnerabilities)) {
    return failure(
      issue(
        "AUDIT_SCHEMA",
        "pnpm audit JSON is missing the required metadata.vulnerabilities object.",
      ),
    );
  }

  const advisoryKeys = Object.keys(payload.advisories).sort();
  if (advisoryKeys.length !== 1 || advisoryKeys[0] !== EXPECTED_ADVISORY_KEY) {
    return failure(
      issue(
        "AUDIT_ADVISORY_SET",
        `Unexpected advisory key set (${describeAdvisorySet(advisoryKeys)}); expected exactly ["${EXPECTED_ADVISORY_KEY}"].`,
      ),
    );
  }

  const advisory = payload.advisories[EXPECTED_ADVISORY_KEY];
  if (!isRecord(advisory)) {
    return failure(
      issue(
        "AUDIT_ADVISORY",
        `Advisory ${EXPECTED_ADVISORY_KEY} must be an object.`,
      ),
    );
  }

  const errors = [];
  if (advisory.id !== EXPECTED_ADVISORY_ID) {
    errors.push(
      issue(
        "AUDIT_ADVISORY",
        `Advisory ${EXPECTED_ADVISORY_KEY} has an unexpected id; expected ${EXPECTED_ADVISORY_ID}.`,
      ),
    );
  }
  if (advisory.module_name !== EXPECTED_MODULE) {
    errors.push(
      issue(
        "AUDIT_ADVISORY",
        `Advisory ${EXPECTED_ADVISORY_KEY} has an unexpected module_name; expected ${EXPECTED_MODULE}.`,
      ),
    );
  }
  if (advisory.vulnerable_versions !== EXPECTED_VULNERABLE_VERSIONS) {
    errors.push(
      issue(
        "AUDIT_ADVISORY",
        `Advisory ${EXPECTED_ADVISORY_KEY} has unexpected vulnerable_versions; expected ${EXPECTED_VULNERABLE_VERSIONS}.`,
      ),
    );
  }
  if (advisory.severity !== EXPECTED_SEVERITY) {
    errors.push(
      issue(
        "AUDIT_ADVISORY",
        `Advisory ${EXPECTED_ADVISORY_KEY} has an unexpected severity; expected ${EXPECTED_SEVERITY}.`,
      ),
    );
  }

  if (!Array.isArray(advisory.findings)) {
    errors.push(
      issue(
        "AUDIT_FINDING",
        "Advisory findings must be an array with exactly one finding.",
      ),
    );
  } else if (advisory.findings.length !== 1) {
    errors.push(
      issue(
        "AUDIT_FINDING",
        `Advisory finding count must be exactly 1; received ${advisory.findings.length}.`,
      ),
    );
  } else {
    const [finding] = advisory.findings;
    if (!isRecord(finding)) {
      errors.push(
        issue("AUDIT_FINDING", "The sole advisory finding must be an object."),
      );
    } else {
      if (finding.version !== EXPECTED_FINDING_VERSION) {
        errors.push(
          issue(
            "AUDIT_FINDING",
            `Advisory finding has an unexpected version; expected ${EXPECTED_FINDING_VERSION}.`,
          ),
        );
      }
      if (!Array.isArray(finding.paths)) {
        errors.push(
          issue(
            "AUDIT_FINDING",
            "Advisory finding paths must be an array with exactly one path.",
          ),
        );
      } else if (finding.paths.length !== 1) {
        errors.push(
          issue(
            "AUDIT_FINDING",
            `Advisory finding path count must be exactly 1; received ${finding.paths.length}.`,
          ),
        );
      } else if (
        typeof finding.paths[0] !== "string" ||
        finding.paths[0] !== EXPECTED_PATH
      ) {
        errors.push(
          issue(
            "AUDIT_FINDING",
            `Advisory finding has an unexpected path; expected ${EXPECTED_PATH}.`,
          ),
        );
      }
    }
  }

  const totals = payload.metadata.vulnerabilities;
  const totalKeys = Object.keys(totals).sort();
  const expectedTotalKeys = [...SEVERITIES].sort();
  if (
    totalKeys.length !== expectedTotalKeys.length ||
    totalKeys.some((key, index) => key !== expectedTotalKeys[index])
  ) {
    errors.push(
      issue(
        "AUDIT_TOTALS",
        `Vulnerability severity keys differ; expected ${expectedTotalKeys.join(", ")}.`,
      ),
    );
  } else {
    for (const severity of SEVERITIES) {
      const total = totals[severity];
      const expected = EXPECTED_TOTALS[severity];
      if (!Number.isInteger(total) || total < 0 || total !== expected) {
        errors.push(
          issue(
            "AUDIT_TOTALS",
            `Vulnerability total ${severity} is unexpected; expected ${expected}.`,
          ),
        );
      }
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, message: SUCCESS_MESSAGE };
}

function validateSecurityAuditTransitionInternal(result) {
  if (!isRecord(result)) return invalidProcessResult("result");

  const processError = result.error;
  if (processError !== undefined) {
    if (!isRecord(processError) && !(processError instanceof Error)) {
      return invalidProcessResult("error");
    }
    return processFailure(processError);
  }
  if (!Object.hasOwn(result, "status")) {
    return invalidProcessResult("status");
  }
  if (!Object.hasOwn(result, "signal")) {
    return invalidProcessResult("signal");
  }
  if (!Object.hasOwn(result, "stdout")) {
    return invalidProcessResult("stdout");
  }
  if (!Object.hasOwn(result, "stderr")) {
    return invalidProcessResult("stderr");
  }

  const status = result.status;
  const signal = result.signal;
  const stdout = result.stdout;
  const stderr = result.stderr;

  if (status !== 1) return invalidProcessResult("status");
  if (signal !== null) return invalidProcessResult("signal");
  if (typeof stdout !== "string") return invalidProcessResult("stdout");
  if (typeof stderr !== "string") return invalidProcessResult("stderr");
  if (stderr !== "") {
    return failure(
      issue(
        "AUDIT_STDERR",
        `pnpm audit wrote ${byteLength(stderr)} bytes to stderr.`,
      ),
    );
  }

  const stdoutBytes = byteLength(stdout);
  if (stdoutBytes === 0 || stdoutBytes > MAX_AUDIT_OUTPUT_BYTES) {
    return failure(
      issue(
        "AUDIT_STDOUT",
        `pnpm audit stdout has an invalid size (${stdoutBytes} bytes).`,
      ),
    );
  }

  const parsed = parseAuditJson(stdout);
  if (!parsed.ok) return parsed;
  return validateAuditPayload(parsed.payload, stdoutBytes);
}

export function validateSecurityAuditTransition(result) {
  try {
    return validateSecurityAuditTransitionInternal(result);
  } catch {
    return invalidProcessResult("result");
  }
}

function isRegularFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function selectPnpmAuditInvocation({
  npmExecPath,
  execPath,
  platform,
  isFile = isRegularFile,
} = {}) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const absoluteEntry =
    typeof npmExecPath === "string" &&
    pathApi.isAbsolute(npmExecPath) &&
    isFile(npmExecPath);
  const entryBasename = absoluteEntry ? pathApi.basename(npmExecPath) : "";
  const trustedJavaScriptEntry =
    absoluteEntry && ["pnpm.cjs", "pnpm.js"].includes(entryBasename);
  const trustedWindowsExecutable =
    platform === "win32" &&
    absoluteEntry &&
    entryBasename.toLowerCase() === "pnpm.exe";

  if (
    trustedJavaScriptEntry &&
    typeof execPath === "string" &&
    execPath !== ""
  ) {
    return {
      ok: true,
      command: execPath,
      args: [npmExecPath, "audit", "--json"],
    };
  }

  if (trustedWindowsExecutable) {
    return {
      ok: true,
      command: npmExecPath,
      args: ["audit", "--json"],
    };
  }

  if (platform === "win32") {
    return {
      ok: false,
      error: issue(
        "PNPM_LAUNCH_UNSUPPORTED",
        "Cannot safely launch pnpm on Windows without a verified npm_execpath JavaScript or pnpm.exe entry point.",
      ),
    };
  }

  return { ok: true, command: "pnpm", args: ["audit", "--json"] };
}

function boundedDiagnostic(text) {
  const safe = text.replace(/[\u0000-\u001f\u007f]/g, "?");
  if (byteLength(safe) <= MAX_CLI_DIAGNOSTIC_BYTES - 1) {
    return `${safe}\n`;
  }
  const prefix = Buffer.from(safe)
    .subarray(0, MAX_CLI_DIAGNOSTIC_BYTES - 5)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
  return `${prefix}...\n`;
}

function renderFailure(report) {
  return boundedDiagnostic(
    `Security audit transition check failed: ${report.errors
      .map(({ code, message }) => `${code}: ${message}`)
      .join(" | ")}`,
  );
}

/**
 * Runs the audit synchronously with a two-minute timeout. The injected seams
 * keep import and CLI behavior testable without spawning a registry request.
 */
export function runSecurityAuditTransition({
  runner = spawnSync,
  npmExecPath = process.env.npm_execpath,
  execPath = process.execPath,
  platform = process.platform,
  isFile = isRegularFile,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const invocation = selectPnpmAuditInvocation({
    npmExecPath,
    execPath,
    platform,
    isFile,
  });
  if (!invocation.ok) {
    stderr.write(renderFailure(failure(invocation.error)));
    return 1;
  }

  let result;
  try {
    result = runner(invocation.command, invocation.args, {
      encoding: "utf8",
      maxBuffer: MAX_AUDIT_OUTPUT_BYTES,
      shell: false,
      timeout: AUDIT_TIMEOUT_MS,
      killSignal: "SIGTERM",
    });
  } catch (error) {
    result = { error };
  }

  const report = validateSecurityAuditTransition(result);
  if (report.ok) {
    stdout.write(`${report.message}\n`);
    return 0;
  }

  stderr.write(renderFailure(report));
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runSecurityAuditTransition();
}
