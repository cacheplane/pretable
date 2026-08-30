#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { devNull, tmpdir } from "node:os";
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
export const MAX_AUDIT_TRUST_FILE_BYTES = 64 * 1024;
export const MAX_AUDIT_PACKAGE_JSON_BYTES = 1024 * 1024;
export const MAX_AUDIT_LOCKFILE_BYTES = 4 * 1024 * 1024;
export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";

const EXPECTED_NPMRC =
  "auto-install-peers=true\nstrict-peer-dependencies=false\n";
const EXPECTED_WORKSPACE = "packages:\n  - apps/*\n  - packages/*\n";

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
const TRUSTED_ENV_KEYS = new Set([
  "appdata",
  "ci",
  "colorterm",
  "comspec",
  "force_color",
  "home",
  "homedrive",
  "homepath",
  "http_proxy",
  "https_proxy",
  "localappdata",
  "no_color",
  "no_proxy",
  "path",
  "pathext",
  "systemroot",
  "temp",
  "term",
  "tmp",
  "tmpdir",
  "userprofile",
]);
const AUDIT_SOURCE_SPECS = [
  ["npmrc", ".npmrc", MAX_AUDIT_TRUST_FILE_BYTES],
  ["packageJson", "package.json", MAX_AUDIT_PACKAGE_JSON_BYTES],
  ["lockfile", "pnpm-lock.yaml", MAX_AUDIT_LOCKFILE_BYTES],
  ["workspace", "pnpm-workspace.yaml", MAX_AUDIT_TRUST_FILE_BYTES],
];
const DEFAULT_FILE_SYSTEM = {
  constants: fsConstants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
};

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

function auditTrustFailure() {
  return failure(
    issue(
      "AUDIT_TRUST_CONFIG",
      "Repository dependency audit trust inputs are invalid.",
    ),
  );
}

function sameStableStat(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

export function isAbsentTrustPath(candidate, { fileSystem: overrides } = {}) {
  const fileSystem = { ...DEFAULT_FILE_SYSTEM, ...overrides };
  try {
    const parentBefore = fileSystem.lstatSync(path.dirname(candidate), {
      bigint: true,
    });
    if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) {
      return false;
    }
    try {
      fileSystem.lstatSync(candidate, { bigint: true });
      return false;
    } catch (error) {
      if (error?.code !== "ENOENT") return false;
    }
    const parentAfter = fileSystem.lstatSync(path.dirname(candidate), {
      bigint: true,
    });
    return (
      parentAfter.isDirectory() &&
      !parentAfter.isSymbolicLink() &&
      sameStableStat(parentBefore, parentAfter)
    );
  } catch {
    return false;
  }
}

function stableStatFingerprint(stat) {
  return {
    ctimeNs: stat.ctimeNs.toString(),
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    mode: stat.mode.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    size: stat.size.toString(),
  };
}

function fingerprint(buffer, stat) {
  return {
    content: createHash("sha256").update(buffer).digest("hex"),
    ...stableStatFingerprint(stat),
  };
}

export function readBoundedTrustFile(
  candidate,
  { maxBytes = MAX_AUDIT_TRUST_FILE_BYTES, fileSystem: overrides } = {},
) {
  const fileSystem = { ...DEFAULT_FILE_SYSTEM, ...overrides };
  let descriptor;
  try {
    const pathBefore = fileSystem.lstatSync(candidate, { bigint: true });
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) return undefined;
    const noFollow = fileSystem.constants?.O_NOFOLLOW;
    const flags =
      fileSystem.constants.O_RDONLY |
      (typeof noFollow === "number" ? noFollow : 0);
    descriptor = fileSystem.openSync(candidate, flags);
    const before = fileSystem.fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.size < 0n ||
      before.size > BigInt(maxBytes) ||
      !sameStableStat(pathBefore, before)
    ) {
      return undefined;
    }

    const buffer = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fileSystem.readSync(
        descriptor,
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) return undefined;
      offset += bytesRead;
    }

    const after = fileSystem.fstatSync(descriptor, { bigint: true });
    const pathAfter = fileSystem.lstatSync(candidate, { bigint: true });
    if (
      pathAfter.isSymbolicLink() ||
      !sameStableStat(before, after) ||
      !sameStableStat(after, pathAfter)
    )
      return undefined;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return {
      buffer,
      text,
      fingerprint: fingerprint(buffer, before),
    };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      try {
        fileSystem.closeSync(descriptor);
      } catch {
        // The descriptor's validated bytes have already been consumed.
      }
    }
  }
}

export function validateAuditTrustInputs({ npmrc, workspace } = {}) {
  return npmrc === EXPECTED_NPMRC && workspace === EXPECTED_WORKSPACE
    ? { ok: true }
    : auditTrustFailure();
}

function loadAuditTrustInputs(cwd) {
  if (typeof cwd !== "string" || cwd === "") return auditTrustFailure();
  const files = {};
  let rootBefore;
  let rootAfter;
  try {
    rootBefore = lstatSync(cwd, { bigint: true });
    if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) {
      return auditTrustFailure();
    }
    for (const [key, name, maxBytes] of AUDIT_SOURCE_SPECS) {
      const value = readBoundedTrustFile(path.resolve(cwd, name), { maxBytes });
      if (!value) return auditTrustFailure();
      files[key] = value;
    }
    if (!isAbsentTrustPath(path.resolve(cwd, ".pnpmfile.cjs"))) {
      return auditTrustFailure();
    }
    rootAfter = lstatSync(cwd, { bigint: true });
    if (rootAfter.isSymbolicLink() || !sameStableStat(rootBefore, rootAfter)) {
      return auditTrustFailure();
    }
  } catch {
    return auditTrustFailure();
  }
  const validation = validateAuditTrustInputs({
    npmrc: files.npmrc.text,
    workspace: files.workspace.text,
  });
  try {
    const packageJson = JSON.parse(files.packageJson.text);
    if (
      packageJson === null ||
      Array.isArray(packageJson) ||
      typeof packageJson !== "object" ||
      Object.hasOwn(packageJson, "pnpm") ||
      files.lockfile.buffer.length === 0
    ) {
      return auditTrustFailure();
    }
  } catch {
    return auditTrustFailure();
  }
  return validation.ok
    ? {
        ok: true,
        files,
        fingerprints: Object.fromEntries(
          [
            ["root", { fingerprint: stableStatFingerprint(rootBefore) }],
            ...Object.entries(files),
          ].map(([key, value]) => [key, value.fingerprint]),
        ),
      }
    : validation;
}

function trustedAuditEnvironment(environment) {
  const trusted = {};
  const seen = new Set();
  if (environment && typeof environment === "object") {
    for (const [key, value] of Object.entries(environment)) {
      const normalized = key.toLowerCase();
      if (TRUSTED_ENV_KEYS.has(normalized) && !seen.has(normalized)) {
        trusted[key] = value;
        seen.add(normalized);
      }
    }
  }
  trusted.NPM_CONFIG_REGISTRY = OFFICIAL_NPM_REGISTRY;
  trusted.NPM_CONFIG_USERCONFIG = devNull;
  trusted.NPM_CONFIG_GLOBALCONFIG = devNull;
  trusted.NPM_CONFIG_IGNORE_PNPMFILE = "true";
  trusted.NPM_CONFIG_IGNORE_SCRIPTS = "true";
  return trusted;
}

function sameTrustFingerprints(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function revalidateAuditTrustInputs(cwd, expected) {
  const current = loadAuditTrustInputs(cwd);
  return current.ok && sameTrustFingerprints(expected, current.fingerprints)
    ? { ok: true }
    : auditTrustFailure();
}

function sameTrustContents(source, snapshot) {
  return AUDIT_SOURCE_SPECS.every(
    ([key]) =>
      source.files[key].fingerprint.content ===
      snapshot.files[key].fingerprint.content,
  );
}

function cleanupAuditSnapshot(directory) {
  try {
    rmSync(directory, { force: true, recursive: true });
    return true;
  } catch {
    return false;
  }
}

function createAuditSnapshot(source) {
  let directory;
  try {
    directory = mkdtempSync(path.join(tmpdir(), "pretable-audit-snapshot-"));
    chmodSync(directory, 0o700);
    const directoryStat = lstatSync(directory);
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      (directoryStat.mode & 0o777) !== 0o700
    ) {
      throw new Error("invalid audit snapshot directory");
    }
    for (const [key, name] of AUDIT_SOURCE_SPECS) {
      const candidate = path.join(directory, name);
      writeFileSync(candidate, source.files[key].buffer, {
        flag: "wx",
        mode: 0o600,
      });
      chmodSync(candidate, 0o600);
    }
    const snapshot = loadAuditTrustInputs(directory);
    if (!snapshot.ok || !sameTrustContents(source, snapshot)) {
      throw new Error("invalid audit snapshot files");
    }
    for (const [, name] of AUDIT_SOURCE_SPECS) {
      const fileStat = lstatSync(path.join(directory, name));
      if (
        !fileStat.isFile() ||
        fileStat.isSymbolicLink() ||
        (fileStat.mode & 0o777) !== 0o600
      ) {
        throw new Error("invalid audit snapshot file mode");
      }
    }
    return {
      ok: true,
      cwd: directory,
      fingerprints: snapshot.fingerprints,
    };
  } catch {
    if (directory) cleanupAuditSnapshot(directory);
    return auditTrustFailure();
  }
}

function revalidateAuditState(sourceCwd, sourceFingerprints, snapshot) {
  const source = revalidateAuditTrustInputs(sourceCwd, sourceFingerprints);
  const privateCopy = revalidateAuditTrustInputs(
    snapshot.cwd,
    snapshot.fingerprints,
  );
  return source.ok && privateCopy.ok ? { ok: true } : auditTrustFailure();
}

export function selectPnpmAuditInvocation({
  npmExecPath,
  execPath,
  platform,
  auditArgs = ["audit", "--json"],
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
      args: [npmExecPath, ...auditArgs],
    };
  }

  if (trustedWindowsExecutable) {
    return {
      ok: true,
      command: npmExecPath,
      args: auditArgs,
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

  return { ok: true, command: "pnpm", args: auditArgs };
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

function validateThresholdAudit(result) {
  if (result?.error) return processFailure(result.error);
  if (
    !isRecord(result) ||
    result.status !== 0 ||
    result.signal !== null ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string"
  ) {
    return failure(
      issue(
        "AUDIT_THRESHOLD_PROCESS",
        "The moderate-threshold audit process returned an invalid result.",
      ),
    );
  }
  if (
    result.stderr !== "" ||
    byteLength(result.stdout) > MAX_AUDIT_OUTPUT_BYTES
  ) {
    return failure(
      issue(
        "AUDIT_THRESHOLD_OUTPUT",
        "The moderate-threshold audit process returned invalid output.",
      ),
    );
  }
  return { ok: true, output: result.stdout };
}

function runAuditChild(runner, invocation, options) {
  try {
    return runner(invocation.command, invocation.args, options);
  } catch (error) {
    return { error };
  }
}

/**
 * Runs the audit synchronously with a two-minute timeout. The injected seams
 * keep import and CLI behavior testable without spawning a registry request.
 */
export function runSecurityAuditTransition({
  runner = spawnSync,
  cwd = process.cwd(),
  environment = process.env,
  npmExecPath = process.env.npm_execpath,
  execPath = process.execPath,
  platform = process.platform,
  isFile = isRegularFile,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const trust = loadAuditTrustInputs(cwd);
  if (!trust.ok) {
    stderr.write(renderFailure(trust));
    return 1;
  }

  const thresholdInvocation = selectPnpmAuditInvocation({
    npmExecPath,
    execPath,
    platform,
    auditArgs: ["audit", "--audit-level", "moderate"],
    isFile,
  });
  const jsonInvocation = selectPnpmAuditInvocation({
    npmExecPath,
    execPath,
    platform,
    auditArgs: ["audit", "--json"],
    isFile,
  });
  if (!thresholdInvocation.ok || !jsonInvocation.ok) {
    const invocation = thresholdInvocation.ok
      ? jsonInvocation
      : thresholdInvocation;
    stderr.write(renderFailure(failure(invocation.error)));
    return 1;
  }

  const snapshot = createAuditSnapshot(trust);
  if (!snapshot.ok) {
    stderr.write(renderFailure(snapshot));
    return 1;
  }

  const options = {
    cwd: snapshot.cwd,
    encoding: "utf8",
    env: trustedAuditEnvironment(environment),
    maxBuffer: MAX_AUDIT_OUTPUT_BYTES,
    shell: false,
    timeout: AUDIT_TIMEOUT_MS,
    killSignal: "SIGTERM",
  };

  let resultCode = 1;
  try {
    const initialTrust = revalidateAuditState(
      cwd,
      trust.fingerprints,
      snapshot,
    );
    if (!initialTrust.ok) {
      stderr.write(renderFailure(initialTrust));
      return resultCode;
    }
    const thresholdResult = runAuditChild(runner, thresholdInvocation, options);
    const thresholdTrust = revalidateAuditState(
      cwd,
      trust.fingerprints,
      snapshot,
    );
    if (!thresholdTrust.ok) {
      stderr.write(renderFailure(thresholdTrust));
      return resultCode;
    }
    const thresholdReport = validateThresholdAudit(thresholdResult);
    if (!thresholdReport.ok) {
      stderr.write(renderFailure(thresholdReport));
      return resultCode;
    }
    stdout.write(thresholdReport.output);

    const jsonResult = runAuditChild(runner, jsonInvocation, options);
    const jsonTrust = revalidateAuditState(cwd, trust.fingerprints, snapshot);
    if (!jsonTrust.ok) {
      stderr.write(renderFailure(jsonTrust));
      return resultCode;
    }
    const report = validateSecurityAuditTransition(jsonResult);
    if (report.ok) {
      stdout.write(`${report.message}\n`);
      resultCode = 0;
      return resultCode;
    }

    stderr.write(renderFailure(report));
    return resultCode;
  } finally {
    if (!cleanupAuditSnapshot(snapshot.cwd)) {
      stderr.write(renderFailure(auditTrustFailure()));
      return 1;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runSecurityAuditTransition();
}
