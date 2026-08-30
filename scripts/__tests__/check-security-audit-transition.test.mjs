import assert from "node:assert/strict";
import {
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as checker from "../check-security-audit-transition.mjs";

const expectedNpmrc =
  "auto-install-peers=true\nstrict-peer-dependencies=false\n";
const expectedPackageJson =
  '{"name":"audit-trust-fixture","version":"1.0.0"}\n';
const expectedLockfile =
  "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n";

function transitionPayload() {
  return {
    advisories: {
      1120680: {
        findings: [
          {
            version: "0.27.7",
            paths: [".>tsup>esbuild"],
          },
        ],
        id: 1120680,
        severity: "low",
        module_name: "esbuild",
        vulnerable_versions: ">=0.27.3 <0.28.1",
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 1,
        moderate: 0,
        high: 0,
        critical: 0,
      },
    },
  };
}

function processResult(payload = transitionPayload(), overrides = {}) {
  return {
    status: 1,
    signal: null,
    stdout: JSON.stringify(payload),
    stderr: "",
    ...overrides,
  };
}

function thresholdProcessResult(overrides = {}) {
  return {
    status: 0,
    signal: null,
    stdout: "1 vulnerabilities found\nSeverity: 1 low\n",
    stderr: "",
    ...overrides,
  };
}

function validate(payload = transitionPayload(), overrides = {}) {
  return checker.validateSecurityAuditTransition(
    processResult(payload, overrides),
  );
}

function validateWithoutThrow(result) {
  let report;
  assert.doesNotThrow(() => {
    report = checker.validateSecurityAuditTransition(result);
  });
  return report;
}

function rejection(report, code, pattern) {
  assert.equal(report.ok, false);
  assert.ok(Array.isArray(report.errors));
  const error = report.errors.find((candidate) => candidate.code === code);
  assert.ok(error, `expected structured error code ${code}`);
  assert.equal(typeof error.message, "string");
  if (pattern) assert.match(error.message, pattern);
  return error;
}

function assertDoesNotLeak(text, pattern, label = "diagnostic") {
  assert.equal(pattern.test(text), false, `${label} leaked untrusted content`);
}

function memoryStream() {
  let value = "";
  return {
    stream: {
      write(chunk) {
        value += String(chunk);
        return true;
      },
    },
    read() {
      return value;
    },
  };
}

function rawAuditJson(advisories, vulnerabilities) {
  return `{"advisories":${advisories},"metadata":{"vulnerabilities":${vulnerabilities}}}`;
}

function withAuditTrustFiles(
  {
    npmrc = expectedNpmrc,
    packageJson = expectedPackageJson,
    lockfile = expectedLockfile,
    workspace = "packages:\n  - apps/*\n  - packages/*\n",
  },
  callback,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "pretable-audit-trust-"));
  try {
    writeFileSync(path.join(directory, ".npmrc"), npmrc);
    writeFileSync(path.join(directory, "package.json"), packageJson);
    writeFileSync(path.join(directory, "pnpm-lock.yaml"), lockfile);
    writeFileSync(path.join(directory, "pnpm-workspace.yaml"), workspace);
    return callback(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

const advisoryJson = () =>
  JSON.stringify(transitionPayload().advisories["1120680"]);
const vulnerabilitiesJson = () =>
  JSON.stringify(transitionPayload().metadata.vulnerabilities);

const remediatedAdvisories = [
  [1121187, "undici", "high", ">=7.23.0 <7.28.0", "7.25.0", ".>jsdom>undici"],
  [
    1121241,
    "undici",
    "moderate",
    ">=7.0.0 <7.28.0",
    "7.25.0",
    ".>jsdom>undici",
  ],
  [1121244, "undici", "high", ">=7.0.0 <7.28.0", "7.25.0", ".>jsdom>undici"],
  [1121247, "undici", "high", ">=7.23.0 <7.28.0", "7.25.0", ".>jsdom>undici"],
  [1121254, "undici", "low", ">=7.0.0 <7.28.0", "7.25.0", ".>jsdom>undici"],
  [
    1121428,
    "undici",
    "moderate",
    ">=7.0.0 <7.28.0",
    "7.25.0",
    ".>jsdom>undici",
  ],
  [
    1121859,
    "js-yaml",
    "moderate",
    "<3.15.0",
    "3.14.2",
    "apps__website>gray-matter>js-yaml",
  ],
  [
    1123528,
    "@babel/core",
    "low",
    "<=7.29.0",
    "7.29.0",
    ".>eslint-plugin-react-hooks>@babel/core",
  ],
  [
    1123912,
    "js-yaml",
    "high",
    ">=3.0.0 <3.15.0",
    "3.14.2",
    "apps__website>gray-matter>js-yaml",
  ],
  [
    1130715,
    "undici",
    "moderate",
    ">=7.0.0 <7.29.0",
    "7.25.0",
    ".>jsdom>undici",
  ],
  [1130718, "undici", "high", ">=7.0.0 <7.29.0", "7.25.0", ".>jsdom>undici"],
  [
    1130726,
    "undici",
    "moderate",
    ">=7.0.0 <7.29.0",
    "7.25.0",
    ".>jsdom>undici",
  ],
  [
    1130729,
    "undici",
    "moderate",
    ">=7.0.0 <7.29.0",
    "7.25.0",
    ".>jsdom>undici",
  ],
  [
    1130731,
    "undici",
    "moderate",
    ">=7.0.0 <7.29.0",
    "7.25.0",
    ".>jsdom>undici",
  ],
  [1137242, "undici", "low", ">=7.0.0 <7.28.0", "7.25.0", ".>jsdom>undici"],
  [
    1138114,
    "js-yaml",
    "high",
    ">=3.0.0 <3.15.1",
    "3.14.2",
    "apps__website>gray-matter>js-yaml",
  ],
  [1139427, "nanoid", "high", "<3.3.18", "3.3.17", ".>tsup>postcss>nanoid"],
];

test("imports without running pnpm audit", () => {
  assert.equal(typeof checker.validateSecurityAuditTransition, "function");
});

test("accepts exactly the planned single-esbuild-advisory transition", () => {
  const report = validate();

  assert.deepEqual(report, {
    ok: true,
    message:
      "Confirmed security audit transition: advisory 1120680 affects only .>tsup>esbuild at esbuild 0.27.7 (low).",
  });
});

test("rejects duplicate advisory keys before JSON.parse erases them", () => {
  const advisory = advisoryJson();
  const stdout = rawAuditJson(
    `{"1120680":${advisory},"1120680":${advisory}}`,
    vulnerabilitiesJson(),
  );

  rejection(
    checker.validateSecurityAuditTransition(
      processResult(undefined, { stdout }),
    ),
    "AUDIT_JSON_DUPLICATE_KEY",
    /1120680/,
  );
});

test("rejects duplicate top-level advisories keys", () => {
  const advisories = JSON.stringify(transitionPayload().advisories);
  const stdout = `{"advisories":${advisories},"advisories":${advisories},"metadata":{"vulnerabilities":${vulnerabilitiesJson()}}}`;

  rejection(
    checker.validateSecurityAuditTransition(
      processResult(undefined, { stdout }),
    ),
    "AUDIT_JSON_DUPLICATE_KEY",
    /advisories/,
  );
});

test("rejects duplicate vulnerability total keys", () => {
  const stdout = rawAuditJson(
    JSON.stringify(transitionPayload().advisories),
    '{"info":0,"low":1,"low":1,"moderate":0,"high":0,"critical":0}',
  );

  rejection(
    checker.validateSecurityAuditTransition(
      processResult(undefined, { stdout }),
    ),
    "AUDIT_JSON_DUPLICATE_KEY",
    /low/,
  );
});

test("rejects decoded-equivalent escaped duplicate keys", () => {
  const advisory = advisoryJson();
  const stdout = rawAuditJson(
    `{"1120680":${advisory},"112068\\u0030":${advisory}}`,
    vulnerabilitiesJson(),
  );

  rejection(
    checker.validateSecurityAuditTransition(
      processResult(undefined, { stdout }),
    ),
    "AUDIT_JSON_DUPLICATE_KEY",
    /1120680/,
  );
});

const malformedProcessResults = [
  ["null", () => null],
  ["array", () => []],
  [
    "missing status",
    () => ({ signal: null, stdout: processResult().stdout, stderr: "" }),
  ],
  [
    "missing signal",
    () => ({ status: 1, stdout: processResult().stdout, stderr: "" }),
  ],
  ["missing stdout", () => ({ status: 1, signal: null, stderr: "" })],
  [
    "missing stderr",
    () => ({ status: 1, signal: null, stdout: processResult().stdout }),
  ],
  ["status zero", () => ({ ...processResult(), status: 0 })],
  ["empty signal", () => ({ ...processResult(), signal: "" })],
  ["false error", () => ({ ...processResult(), error: false })],
  [
    "Buffer stdout",
    () => ({ ...processResult(), stdout: Buffer.from(processResult().stdout) }),
  ],
  ["Buffer stderr", () => ({ ...processResult(), stderr: Buffer.alloc(0) })],
  ["object stdout", () => ({ ...processResult(), stdout: {} })],
  ["object stderr", () => ({ ...processResult(), stderr: {} })],
];

for (const [name, makeResult] of malformedProcessResults) {
  test(`rejects malformed process result: ${name}`, () => {
    rejection(
      validateWithoutThrow(makeResult()),
      "INVALID_PROCESS_RESULT",
      undefined,
    );
  });
}

test("rejects whitespace stderr because only the exact empty string is valid", () => {
  rejection(validate(undefined, { stderr: " \n" }), "AUDIT_STDERR", /2 bytes/);
});

test("snapshots a changing stderr accessor once and rejects its first value", () => {
  const result = processResult();
  let reads = 0;
  Object.defineProperty(result, "stderr", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? "registry failure TOKEN_123" : "";
    },
  });

  const error = rejection(
    validateWithoutThrow(result),
    "AUDIT_STDERR",
    /26 bytes/,
  );
  assert.equal(reads, 1);
  assertDoesNotLeak(error.message, /registry|TOKEN_123/);
});

test("rejects an exact payload with status zero", () => {
  rejection(
    validate(undefined, { status: 0 }),
    "INVALID_PROCESS_RESULT",
    /status/,
  );
});

test("rejects empty stdout", () => {
  rejection(validate(undefined, { stdout: "" }), "AUDIT_STDOUT", /0 bytes/);
});

test("rejects stdout content beyond the wrapper buffer bound", () => {
  const stdout = "x".repeat(checker.MAX_AUDIT_OUTPUT_BYTES + 1);
  const error = rejection(
    validate(undefined, { stdout }),
    "AUDIT_STDOUT",
    new RegExp(`${checker.MAX_AUDIT_OUTPUT_BYTES + 1} bytes`),
  );

  assert.ok(Buffer.byteLength(error.message) <= 256);
  assertDoesNotLeak(error.message, /x{8}/);
});

test("rejects zero advisories while the PR2 transition checker exists", () => {
  const payload = transitionPayload();
  payload.advisories = {};
  payload.metadata.vulnerabilities.low = 0;

  rejection(validate(payload), "AUDIT_ADVISORY_SET", /1120680/);
});

for (const [
  id,
  moduleName,
  severity,
  vulnerableVersions,
  version,
  path,
] of remediatedAdvisories) {
  test(`rejects remediated advisory ${id} at ${path}`, () => {
    const payload = transitionPayload();
    payload.advisories[id] = {
      findings: [{ version, paths: [path] }],
      id,
      severity,
      module_name: moduleName,
      vulnerable_versions: vulnerableVersions,
    };
    payload.metadata.vulnerabilities[severity] += 1;

    rejection(validate(payload), "AUDIT_ADVISORY_SET", new RegExp(String(id)));
  });
}

test("rejects another advisory id", () => {
  const payload = transitionPayload();
  payload.advisories = {
    9999999: { ...payload.advisories["1120680"], id: 9999999 },
  };

  rejection(validate(payload), "AUDIT_ADVISORY_SET", /9999999.*1120680/);
});

test("rejects a mismatch between the advisory key and embedded id", () => {
  const payload = transitionPayload();
  payload.advisories["1120680"].id = 9999999;

  rejection(validate(payload), "AUDIT_ADVISORY", /id.*1120680/i);
});

test("rejects another module or vulnerable version range", () => {
  const modulePayload = transitionPayload();
  modulePayload.advisories["1120680"].module_name = "vite";
  rejection(validate(modulePayload), "AUDIT_ADVISORY", /module_name.*esbuild/i);

  const rangePayload = transitionPayload();
  rangePayload.advisories["1120680"].vulnerable_versions = "<0.28.1";
  rejection(
    validate(rangePayload),
    "AUDIT_ADVISORY",
    /vulnerable_versions.*>=0\.27\.3 <0\.28\.1/i,
  );
});

test("rejects another dependency path", () => {
  const payload = transitionPayload();
  payload.advisories["1120680"].findings[0].paths = [".>vite>esbuild"];

  rejection(validate(payload), "AUDIT_FINDING", /path.*\.>tsup>esbuild/i);
});

test("rejects another affected esbuild version", () => {
  const payload = transitionPayload();
  payload.advisories["1120680"].findings[0].version = "0.27.8";

  rejection(validate(payload), "AUDIT_FINDING", /version.*0\.27\.7/i);
});

test("rejects another severity even when its total is internally consistent", () => {
  const payload = transitionPayload();
  payload.advisories["1120680"].severity = "moderate";
  payload.metadata.vulnerabilities.low = 0;
  payload.metadata.vulnerabilities.moderate = 1;

  rejection(validate(payload), "AUDIT_ADVISORY", /severity.*low/i);
});

test("rejects duplicate findings", () => {
  const payload = transitionPayload();
  payload.advisories["1120680"].findings.push({
    version: "0.27.7",
    paths: [".>tsup>esbuild"],
  });

  rejection(validate(payload), "AUDIT_FINDING", /finding count.*1/i);
});

test("rejects duplicate paths", () => {
  const payload = transitionPayload();
  payload.advisories["1120680"].findings[0].paths.push(".>tsup>esbuild");

  rejection(validate(payload), "AUDIT_FINDING", /path count.*1/i);
});

test("rejects vulnerability totals that contradict the advisory set", () => {
  const payload = transitionPayload();
  payload.metadata.vulnerabilities.low = 0;

  rejection(validate(payload), "AUDIT_TOTALS", /low.*1/i);
});

test("rejects missing or extra vulnerability severity total keys", () => {
  const missing = transitionPayload();
  delete missing.metadata.vulnerabilities.info;
  rejection(validate(missing), "AUDIT_TOTALS", /info/i);

  const extra = transitionPayload();
  extra.metadata.vulnerabilities.unknown = 0;
  rejection(validate(extra), "AUDIT_TOTALS", /severity keys/i);
});

test("rejects malformed or truncated JSON without a parser excerpt", () => {
  const secret = "https://user:password@registry.invalid/TOKEN_123";
  const report = checker.validateSecurityAuditTransition(
    processResult(undefined, {
      stdout: `{"advisories":"${secret}",`,
    }),
  );
  const error = rejection(report, "AUDIT_JSON_INVALID", /bytes/);

  assertDoesNotLeak(error.message, /user|password|TOKEN_123|registry\.invalid/);
});

const malformedAuditShapes = [
  [
    "top-level array",
    () => processResult(undefined, { stdout: "[]" }),
    "AUDIT_SCHEMA",
  ],
  [
    "top-level null",
    () => processResult(undefined, { stdout: "null" }),
    "AUDIT_SCHEMA",
  ],
  [
    "advisory array",
    () => {
      const payload = transitionPayload();
      payload.advisories["1120680"] = [];
      return processResult(payload);
    },
    "AUDIT_ADVISORY",
  ],
  [
    "findings object",
    () => {
      const payload = transitionPayload();
      payload.advisories["1120680"].findings = {};
      return processResult(payload);
    },
    "AUDIT_FINDING",
  ],
  [
    "finding array",
    () => {
      const payload = transitionPayload();
      payload.advisories["1120680"].findings = [[]];
      return processResult(payload);
    },
    "AUDIT_FINDING",
  ],
  [
    "paths object",
    () => {
      const payload = transitionPayload();
      payload.advisories["1120680"].findings[0].paths = {};
      return processResult(payload);
    },
    "AUDIT_FINDING",
  ],
  [
    "non-string path",
    () => {
      const payload = transitionPayload();
      payload.advisories["1120680"].findings[0].paths = [7];
      return processResult(payload);
    },
    "AUDIT_FINDING",
  ],
  [
    "vulnerability totals array",
    () => {
      const payload = transitionPayload();
      payload.metadata.vulnerabilities = [];
      return processResult(payload);
    },
    "AUDIT_SCHEMA",
  ],
  [
    "non-numeric vulnerability total",
    () => {
      const payload = transitionPayload();
      payload.metadata.vulnerabilities.low = "1";
      return processResult(payload);
    },
    "AUDIT_TOTALS",
  ],
];

for (const [name, makeResult, code] of malformedAuditShapes) {
  test(`rejects malformed audit schema: ${name}`, () => {
    rejection(validateWithoutThrow(makeResult()), code);
  });
}

test("rejects missing required pnpm audit schema", () => {
  rejection(
    validate({ metadata: transitionPayload().metadata }),
    "AUDIT_SCHEMA",
    /advisories/,
  );
  rejection(
    validate({ advisories: {} }),
    "AUDIT_SCHEMA",
    /metadata\.vulnerabilities/,
  );
});

test("rejects top-level registry or error payloads without echoing them", () => {
  const secret = "https://user:password@registry.invalid/TOKEN_123";
  const report = validate({
    error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE", detail: secret },
  });
  const error = rejection(report, "AUDIT_ERROR_PAYLOAD", /bytes/);

  assertDoesNotLeak(error.message, /user|password|TOKEN_123|registry\.invalid/);

  const contradictory = transitionPayload();
  contradictory.error = { code: "EAI_AGAIN", detail: secret };
  rejection(validate(contradictory), "AUDIT_ERROR_PAYLOAD");
});

test("rejects spawn errors, signals, and null statuses with safe categories", () => {
  const rawMessage =
    "spawn failed https://user:password@registry.invalid/TOKEN_123\nINJECTED";
  const spawnReport = validateWithoutThrow({
    error: Object.assign(new Error(rawMessage), { code: "ENOENT" }),
    status: null,
    signal: null,
    stdout: "",
    stderr: "",
  });
  const spawnError = rejection(spawnReport, "AUDIT_PROCESS_ERROR", /ENOENT/);
  assertDoesNotLeak(spawnError.message, /password|TOKEN_123|INJECTED/);

  rejection(
    validateWithoutThrow({
      error: undefined,
      status: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
    }),
    "INVALID_PROCESS_RESULT",
    /status|signal/,
  );
});

test("snapshots a changing process error code once without leaking later values", () => {
  const processError = new Error("raw process message TOKEN_123");
  let reads = 0;
  Object.defineProperty(processError, "code", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? "ENOENT" : "TOKEN_123\nINJECTED";
    },
  });
  const report = validateWithoutThrow({
    error: processError,
    status: null,
    signal: null,
    stdout: "",
    stderr: "",
  });
  const error = rejection(report, "AUDIT_PROCESS_ERROR", /ENOENT/);

  assert.equal(reads, 1);
  assertDoesNotLeak(JSON.stringify(report), /TOKEN_123|INJECTED/);
  assertDoesNotLeak(error.message, /raw process message/);
});

test("reports timeouts without echoing the raw process error", () => {
  const report = validateWithoutThrow({
    error: Object.assign(new Error("timeout TOKEN_123\nINJECTED"), {
      code: "ETIMEDOUT",
    }),
    status: null,
    signal: "SIGTERM",
    stdout: "",
    stderr: "",
  });
  const error = rejection(report, "AUDIT_TIMEOUT", /timed out/i);

  assertDoesNotLeak(error.message, /TOKEN_123|INJECTED/);
});

test("bounds and sanitizes stderr diagnostics", () => {
  const secret =
    "https://user:password@registry.invalid/TOKEN_123\nINJECTED\u0000";
  const stderr = secret.repeat(10_000);
  const error = rejection(
    validate(undefined, { stderr }),
    "AUDIT_STDERR",
    new RegExp(`${Buffer.byteLength(stderr)} bytes`),
  );

  assert.ok(Buffer.byteLength(error.message) <= 256);
  assertDoesNotLeak(error.message, /user|password|TOKEN_123|INJECTED/);
  assertDoesNotLeak(error.message, /[\u0000-\u001f\u007f]/, "diagnostic");
});

test("never echoes injected semantic values and bounds large advisory sets", () => {
  const secret =
    "https://user:password@registry.invalid/TOKEN_123\nINJECTED\u0000";
  const payload = transitionPayload();
  payload.advisories["1120680"].module_name = secret;
  payload.advisories["1120680"].findings[0].paths = [secret];
  const semanticReport = validate(payload);
  const semanticText = JSON.stringify(semanticReport);
  assertDoesNotLeak(semanticText, /user|password|TOKEN_123|INJECTED/);
  assertDoesNotLeak(semanticText, /[\u0000-\u001f\u007f]/);

  const large = transitionPayload();
  large.advisories = Object.fromEntries(
    Array.from({ length: 2_000 }, (_, index) => [
      String(2_000_000 + index),
      transitionPayload().advisories["1120680"],
    ]),
  );
  const error = rejection(validate(large), "AUDIT_ADVISORY_SET", /1120680/);
  assert.ok(Buffer.byteLength(error.message) <= 256);
});

test("selects a trusted pnpm JavaScript entry point through process.execPath", () => {
  const invocation = checker.selectPnpmAuditInvocation({
    npmExecPath: "/opt/corepack/pnpm.cjs",
    execPath: "/opt/node",
    platform: "linux",
    isFile: (candidate) => candidate === "/opt/corepack/pnpm.cjs",
  });

  assert.deepEqual(invocation, {
    ok: true,
    command: "/opt/node",
    args: ["/opt/corepack/pnpm.cjs", "audit", "--json"],
  });
});

test("selects a trusted pnpm JavaScript entry point on Windows without a shell", () => {
  const invocation = checker.selectPnpmAuditInvocation({
    npmExecPath: "C:\\corepack\\pnpm.cjs",
    execPath: "C:\\node.exe",
    platform: "win32",
    isFile: (candidate) => candidate === "C:\\corepack\\pnpm.cjs",
  });

  assert.deepEqual(invocation, {
    ok: true,
    command: "C:\\node.exe",
    args: ["C:\\corepack\\pnpm.cjs", "audit", "--json"],
  });
});

test("selects an absolute regular pnpm.exe on Windows for direct no-shell execution", () => {
  const invocation = checker.selectPnpmAuditInvocation({
    npmExecPath: "C:\\pnpm\\pnpm.exe",
    execPath: "C:\\node.exe",
    platform: "win32",
    isFile: (candidate) => candidate === "C:\\pnpm\\pnpm.exe",
  });

  assert.deepEqual(invocation, {
    ok: true,
    command: "C:\\pnpm\\pnpm.exe",
    args: ["audit", "--json"],
  });
});

test("rejects unsafe Windows pnpm executable candidates", () => {
  for (const npmExecPath of [
    "C:\\pnpm\\pnpm.cmd",
    "C:\\pnpm\\pnpm.bat",
    "pnpm.exe",
    "C:\\pnpm\\other.exe",
  ]) {
    const invocation = checker.selectPnpmAuditInvocation({
      npmExecPath,
      execPath: "C:\\node.exe",
      platform: "win32",
      isFile: () => true,
    });
    assert.equal(invocation.ok, false, npmExecPath);
    assert.equal(invocation.error.code, "PNPM_LAUNCH_UNSUPPORTED");
  }

  const nonFile = checker.selectPnpmAuditInvocation({
    npmExecPath: "C:\\pnpm\\pnpm.exe",
    execPath: "C:\\node.exe",
    platform: "win32",
    isFile: () => false,
  });
  assert.equal(nonFile.ok, false);
  assert.equal(nonFile.error.code, "PNPM_LAUNCH_UNSUPPORTED");
});

test("uses a no-shell POSIX fallback and fails closed on Windows without a trusted entry", () => {
  assert.deepEqual(
    checker.selectPnpmAuditInvocation({
      npmExecPath: "/tmp/not-pnpm.sh",
      execPath: "/opt/node",
      platform: "linux",
      isFile: () => true,
    }),
    { ok: true, command: "pnpm", args: ["audit", "--json"] },
  );
  assert.deepEqual(
    checker.selectPnpmAuditInvocation({
      npmExecPath: undefined,
      execPath: "C:\\node.exe",
      platform: "win32",
      isFile: () => false,
    }),
    {
      ok: false,
      error: {
        code: "PNPM_LAUNCH_UNSUPPORTED",
        message:
          "Cannot safely launch pnpm on Windows without a verified npm_execpath JavaScript or pnpm.exe entry point.",
      },
    },
  );
});

test("rejects repository npm configuration drift before any audit request", async (t) => {
  const cases = [
    [
      "registry redirect",
      "auto-install-peers=true\nstrict-peer-dependencies=false\nregistry=https://registry.invalid\n",
    ],
    [
      "audit disabled",
      "auto-install-peers=true\nstrict-peer-dependencies=false\naudit=false\n",
    ],
    [
      "production-only audit",
      "auto-install-peers=true\nstrict-peer-dependencies=false\nproduction=true\n",
    ],
    [
      "unrelated configuration drift",
      "strict-peer-dependencies=false\nauto-install-peers=true\n",
    ],
    [
      "CRLF drift",
      "auto-install-peers=true\r\nstrict-peer-dependencies=false\r\n",
    ],
  ];

  for (const [name, npmrc] of cases) {
    await t.test(name, () =>
      withAuditTrustFiles({ npmrc }, (cwd) => {
        let auditRequests = 0;
        const stderr = memoryStream();
        const exitCode = checker.runSecurityAuditTransition({
          cwd,
          environment: { PATH: "/bin" },
          runner() {
            auditRequests += 1;
            return processResult();
          },
          stdout: memoryStream().stream,
          stderr: stderr.stream,
        });

        assert.equal(exitCode, 1);
        assert.equal(auditRequests, 0);
        assert.match(stderr.read(), /AUDIT_TRUST_CONFIG/);
        assertDoesNotLeak(stderr.read(), /registry\.invalid/);
      }),
    );
  }
});

test("rejects any non-exact workspace bytes before any audit request", async (t) => {
  const cases = [
    ["dev root key", "packages: []\ndev: true\n"],
    ["optional root key", "packages: []\noptional: false\n"],
    ["extra root key", "packages: []\ncatalog: {}\n"],
    ["package order", "packages:\n  - packages/*\n  - apps/*\n"],
    ["comment", "packages:\n  - apps/*\n  - packages/* # comment\n"],
    ["CRLF", "packages:\r\n  - apps/*\r\n  - packages/*\r\n"],
    ["missing newline", "packages:\n  - apps/*\n  - packages/*"],
    [
      "ignoreCves",
      "packages: []\nauditConfig:\n  ignoreCves: [CVE-2026-0001]\n",
    ],
    [
      "ignoreGhsas",
      "packages: []\nauditConfig:\n  ignoreGhsas: [GHSA-xxxx-yyyy-zzzz]\n",
    ],
    ["empty mapping", "packages: []\nauditConfig: {}\n"],
    ["null", "packages: []\nauditConfig:\n"],
    ["wrong type", "packages: []\nauditConfig: false\n"],
    [
      "inline merge key",
      "packages: []\n<<: { auditConfig: { ignoreCves: [CVE-2026-0001] } }\n",
    ],
    [
      "nested inline merge key",
      "packages: []\ncatalog:\n  <<: { auditConfig: { ignoreGhsas: [GHSA-xxxx-yyyy-zzzz] } }\n",
    ],
    [
      "alias merge key",
      "defaults: &defaults { auditConfig: { ignoreCves: [CVE-2026-0001] } }\npackages: []\n<<: *defaults\n",
    ],
    ["alias", "shared: &shared []\npackages: *shared\nauditConfig: *shared\n"],
    ["duplicate", "packages: []\nauditConfig: {}\nauditConfig: null\n"],
    ["unsupported tag", "packages: !untrusted []\n"],
    ["malformed", "packages: [\n"],
  ];

  for (const [name, workspace] of cases) {
    await t.test(name, () =>
      withAuditTrustFiles({ workspace }, (cwd) => {
        let auditRequests = 0;
        const stderr = memoryStream();
        const exitCode = checker.runSecurityAuditTransition({
          cwd,
          environment: { PATH: "/bin" },
          runner() {
            auditRequests += 1;
            return processResult();
          },
          stdout: memoryStream().stream,
          stderr: stderr.stream,
        });

        assert.equal(exitCode, 1);
        assert.equal(auditRequests, 0);
        assert.match(stderr.read(), /AUDIT_TRUST_CONFIG/);
      }),
    );
  }
});

test("rejects every own root package pnpm property before spawning", async (t) => {
  const cases = [
    ["null", null],
    ["boolean", false],
    ["string", "ignored"],
    ["array", []],
    ["empty object", {}],
    ["ignoreGhsas", { auditConfig: { ignoreGhsas: ["GHSA-test"] } }],
    ["ignoreCves", { auditConfig: { ignoreCves: ["CVE-2026-0001"] } }],
    ["configDependencies", { configDependencies: { pnpmfile: "1.0.0" } }],
  ];

  for (const [name, pnpm] of cases) {
    await t.test(name, () => {
      const packageData = JSON.parse(expectedPackageJson);
      packageData.pnpm = pnpm;
      return withAuditTrustFiles(
        { packageJson: `${JSON.stringify(packageData)}\n` },
        (cwd) => {
          let calls = 0;
          const stderr = memoryStream();
          const exitCode = checker.runSecurityAuditTransition({
            cwd,
            environment: { PATH: "/bin" },
            runner() {
              calls += 1;
              return calls === 1 ? thresholdProcessResult() : processResult();
            },
            stdout: memoryStream().stream,
            stderr: stderr.stream,
          });

          assert.equal(exitCode, 1);
          assert.equal(calls, 0);
          assert.match(stderr.read(), /AUDIT_TRUST_CONFIG/);
        },
      );
    });
  }
});

test("fails closed on missing and oversized audit trust files without spawning", async (t) => {
  const cases = [
    ["missing npmrc", (cwd) => rmSync(path.join(cwd, ".npmrc"))],
    ["missing package", (cwd) => rmSync(path.join(cwd, "package.json"))],
    ["missing lockfile", (cwd) => rmSync(path.join(cwd, "pnpm-lock.yaml"))],
    [
      "oversized npmrc",
      (cwd) =>
        writeFileSync(
          path.join(cwd, ".npmrc"),
          "x".repeat(checker.MAX_AUDIT_TRUST_FILE_BYTES + 1),
        ),
    ],
    [
      "oversized workspace",
      (cwd) =>
        writeFileSync(
          path.join(cwd, "pnpm-workspace.yaml"),
          "x".repeat(checker.MAX_AUDIT_TRUST_FILE_BYTES + 1),
        ),
    ],
    [
      "oversized package",
      (cwd) =>
        writeFileSync(
          path.join(cwd, "package.json"),
          "x".repeat(checker.MAX_AUDIT_PACKAGE_JSON_BYTES + 1),
        ),
    ],
    [
      "oversized lockfile",
      (cwd) =>
        writeFileSync(
          path.join(cwd, "pnpm-lock.yaml"),
          "x".repeat(checker.MAX_AUDIT_LOCKFILE_BYTES + 1),
        ),
    ],
    [
      "malformed package",
      (cwd) => writeFileSync(path.join(cwd, "package.json"), "{"),
    ],
    [
      "empty lockfile",
      (cwd) => writeFileSync(path.join(cwd, "pnpm-lock.yaml"), ""),
    ],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () =>
      withAuditTrustFiles({}, (cwd) => {
        mutate(cwd);
        let auditRequests = 0;
        const stderr = memoryStream();
        const exitCode = checker.runSecurityAuditTransition({
          cwd,
          environment: { PATH: "/bin" },
          runner() {
            auditRequests += 1;
            return processResult();
          },
          stdout: memoryStream().stream,
          stderr: stderr.stream,
        });

        assert.equal(exitCode, 1);
        assert.equal(auditRequests, 0);
        assert.match(stderr.read(), /AUDIT_TRUST_CONFIG/);
      }),
    );
  }
});

test("rejects symlinked audit source inputs before spawning", async (t) => {
  for (const name of [
    ".npmrc",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]) {
    await t.test(name, () =>
      withAuditTrustFiles({}, (cwd) => {
        const source = path.join(cwd, name);
        const target = path.join(cwd, `${name.replaceAll("/", "-")}.target`);
        renameSync(source, target);
        symlinkSync(path.basename(target), source);
        let calls = 0;
        const stderr = memoryStream();
        const exitCode = checker.runSecurityAuditTransition({
          cwd,
          environment: { PATH: "/bin" },
          runner() {
            calls += 1;
            return processResult();
          },
          stdout: memoryStream().stream,
          stderr: stderr.stream,
        });

        assert.equal(exitCode, 1);
        assert.equal(calls, 0);
        assert.match(stderr.read(), /AUDIT_TRUST_CONFIG/);
      }),
    );
  }
});

test("rejects every root pnpmfile directory entry without following it", async (t) => {
  const cases = [
    [
      "regular file",
      (cwd, candidate) => writeFileSync(candidate, "module.exports = {};\n"),
    ],
    [
      "valid symlink",
      (cwd, candidate) => {
        writeFileSync(
          path.join(cwd, "pnpmfile-target.cjs"),
          "module.exports = {};\n",
        );
        symlinkSync("pnpmfile-target.cjs", candidate);
      },
    ],
    [
      "dangling symlink",
      (_cwd, candidate) => symlinkSync("missing.cjs", candidate),
    ],
    ["directory", (_cwd, candidate) => mkdirSync(candidate)],
  ];

  for (const [name, createEntry] of cases) {
    await t.test(name, () =>
      withAuditTrustFiles({}, (cwd) => {
        createEntry(cwd, path.join(cwd, ".pnpmfile.cjs"));
        let calls = 0;
        const stderr = memoryStream();
        const exitCode = checker.runSecurityAuditTransition({
          cwd,
          environment: { PATH: "/bin" },
          runner() {
            calls += 1;
            return calls === 1 ? thresholdProcessResult() : processResult();
          },
          stdout: memoryStream().stream,
          stderr: stderr.stream,
        });

        assert.equal(exitCode, 1);
        assert.equal(calls, 0);
        assert.match(stderr.read(), /AUDIT_TRUST_CONFIG/);
      }),
    );
  }
});

test("rejects an ENOENT pnpmfile lstat race", () =>
  withAuditTrustFiles({}, (cwd) => {
    const candidate = path.join(cwd, ".pnpmfile.cjs");
    const absent = checker.isAbsentTrustPath(candidate, {
      fileSystem: {
        lstatSync(file, options) {
          if (file === candidate) {
            writeFileSync(candidate, "module.exports = {};\n");
            throw Object.assign(new Error("raced"), { code: "ENOENT" });
          }
          return lstatSync(file, options);
        },
      },
    });
    assert.equal(absent, false);
  }));

test("bounded trust reads reject lstat/open races and no-follow errors", async (t) => {
  await t.test("regular file replacement between lstat and open", () =>
    withAuditTrustFiles({}, (cwd) => {
      const candidate = path.join(cwd, ".npmrc");
      let firstLstat = true;
      const result = checker.readBoundedTrustFile(candidate, {
        fileSystem: {
          constants,
          lstatSync(file, options) {
            const result = lstatSync(file, options);
            if (firstLstat) {
              firstLstat = false;
              renameSync(file, `${file}.previous`);
              writeFileSync(file, expectedNpmrc);
            }
            return result;
          },
        },
      });
      assert.equal(result, undefined);
    }),
  );

  await t.test("symlink replacement between lstat and open", () =>
    withAuditTrustFiles({}, (cwd) => {
      const candidate = path.join(cwd, ".npmrc");
      let firstLstat = true;
      const result = checker.readBoundedTrustFile(candidate, {
        fileSystem: {
          constants,
          lstatSync(file, options) {
            const result = lstatSync(file, options);
            if (firstLstat) {
              firstLstat = false;
              renameSync(file, `${file}.previous`);
              symlinkSync(path.basename(`${file}.previous`), file);
            }
            return result;
          },
        },
      });
      assert.equal(result, undefined);
    }),
  );

  await t.test("path replacement before the final lstat", () =>
    withAuditTrustFiles({}, (cwd) => {
      const candidate = path.join(cwd, ".npmrc");
      let lstatCalls = 0;
      const result = checker.readBoundedTrustFile(candidate, {
        fileSystem: {
          constants,
          lstatSync(file, options) {
            lstatCalls += 1;
            if (lstatCalls === 2) {
              renameSync(file, `${file}.previous`);
              writeFileSync(file, expectedNpmrc);
            }
            return lstatSync(file, options);
          },
        },
      });
      assert.equal(result, undefined);
    }),
  );

  await t.test("open no-follow failure", () =>
    withAuditTrustFiles({}, (cwd) => {
      const result = checker.readBoundedTrustFile(path.join(cwd, ".npmrc"), {
        fileSystem: {
          constants,
          openSync(_file, flags) {
            if (typeof constants.O_NOFOLLOW === "number") {
              assert.equal(flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW);
            }
            throw Object.assign(new Error("no-follow"), { code: "ELOOP" });
          },
        },
      });
      assert.equal(result, undefined);
    }),
  );
});

test("runs both audit phases from a private immutable snapshot", () =>
  withAuditTrustFiles({}, (cwd) => {
    const sourceNames = [
      ".npmrc",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ];
    let snapshotCwd;
    let calls = 0;
    const exitCode = checker.runSecurityAuditTransition({
      cwd,
      environment: { PATH: "/trusted/bin" },
      runner(_command, _args, options) {
        calls += 1;
        snapshotCwd ??= options.cwd;
        assert.equal(options.cwd, snapshotCwd);
        assert.notEqual(options.cwd, cwd);
        assert.equal(lstatSync(options.cwd).mode & 0o777, 0o700);
        for (const name of sourceNames) {
          const source = path.join(cwd, name);
          const snapshot = path.join(options.cwd, name);
          const snapshotStat = lstatSync(snapshot);
          assert.equal(snapshotStat.isFile(), true);
          assert.equal(snapshotStat.isSymbolicLink(), false);
          assert.equal(snapshotStat.mode & 0o777, 0o600);
          assert.deepEqual(readFileSync(snapshot), readFileSync(source));
        }
        return calls === 1 ? thresholdProcessResult() : processResult();
      },
      stdout: memoryStream().stream,
      stderr: memoryStream().stream,
    });

    assert.equal(exitCode, 0);
    assert.equal(calls, 2);
    assert.throws(() => lstatSync(snapshotCwd), /ENOENT/);
  }));

test("rejects source and private snapshot drift and always cleans up", async (t) => {
  await t.test("source becomes a symlink after snapshot creation", () =>
    withAuditTrustFiles({}, (cwd) => {
      let snapshotCwd;
      const exitCode = checker.runSecurityAuditTransition({
        cwd,
        environment: { PATH: "/bin" },
        runner(_command, _args, options) {
          snapshotCwd = options.cwd;
          assert.equal(
            readFileSync(path.join(options.cwd, "package.json"), "utf8"),
            expectedPackageJson,
          );
          const source = path.join(cwd, "package.json");
          renameSync(source, `${source}.previous`);
          symlinkSync("package.json.previous", source);
          return thresholdProcessResult();
        },
        stdout: memoryStream().stream,
        stderr: memoryStream().stream,
      });

      assert.equal(exitCode, 1);
      assert.throws(() => lstatSync(snapshotCwd), /ENOENT/);
    }),
  );

  await t.test("source is transiently replaced by a symlink", () =>
    withAuditTrustFiles({}, (cwd) => {
      let snapshotCwd;
      const exitCode = checker.runSecurityAuditTransition({
        cwd,
        environment: { PATH: "/bin" },
        runner(_command, _args, options) {
          snapshotCwd = options.cwd;
          const source = path.join(cwd, "pnpm-workspace.yaml");
          const previous = `${source}.previous`;
          renameSync(source, previous);
          symlinkSync(path.basename(previous), source);
          assert.equal(
            readFileSync(path.join(options.cwd, "pnpm-workspace.yaml"), "utf8"),
            "packages:\n  - apps/*\n  - packages/*\n",
          );
          rmSync(source);
          renameSync(previous, source);
          return thresholdProcessResult();
        },
        stdout: memoryStream().stream,
        stderr: memoryStream().stream,
      });

      assert.equal(exitCode, 1);
      assert.throws(() => lstatSync(snapshotCwd), /ENOENT/);
    }),
  );

  await t.test("private snapshot mutates", () =>
    withAuditTrustFiles({}, (cwd) => {
      let snapshotCwd;
      const exitCode = checker.runSecurityAuditTransition({
        cwd,
        environment: { PATH: "/bin" },
        runner(_command, _args, options) {
          snapshotCwd = options.cwd;
          writeFileSync(
            path.join(options.cwd, "pnpm-lock.yaml"),
            `${expectedLockfile}overrides: {}\n`,
          );
          return thresholdProcessResult();
        },
        stdout: memoryStream().stream,
        stderr: memoryStream().stream,
      });

      assert.equal(exitCode, 1);
      assert.throws(() => lstatSync(snapshotCwd), /ENOENT/);
    }),
  );

  await t.test("private snapshot mutates after the JSON audit", () =>
    withAuditTrustFiles({}, (cwd) => {
      let snapshotCwd;
      let calls = 0;
      const exitCode = checker.runSecurityAuditTransition({
        cwd,
        environment: { PATH: "/bin" },
        runner(_command, _args, options) {
          calls += 1;
          snapshotCwd = options.cwd;
          if (calls === 2) {
            writeFileSync(
              path.join(options.cwd, "package.json"),
              '{"name":"changed"}\n',
            );
            return processResult();
          }
          return thresholdProcessResult();
        },
        stdout: memoryStream().stream,
        stderr: memoryStream().stream,
      });

      assert.equal(exitCode, 1);
      assert.equal(calls, 2);
      assert.throws(() => lstatSync(snapshotCwd), /ENOENT/);
    }),
  );

  for (const [name, result] of [
    ["audit failure", { ...thresholdProcessResult(), status: 1 }],
    ["runner throw", new Error("runner failed")],
  ]) {
    await t.test(name, () =>
      withAuditTrustFiles({}, (cwd) => {
        let snapshotCwd;
        const exitCode = checker.runSecurityAuditTransition({
          cwd,
          environment: { PATH: "/bin" },
          runner(_command, _args, options) {
            snapshotCwd = options.cwd;
            if (result instanceof Error) throw result;
            return result;
          },
          stdout: memoryStream().stream,
          stderr: memoryStream().stream,
        });

        assert.equal(exitCode, 1);
        assert.throws(() => lstatSync(snapshotCwd), /ENOENT/);
      }),
    );
  }

  await t.test("JSON validation failure", () =>
    withAuditTrustFiles({}, (cwd) => {
      let snapshotCwd;
      let calls = 0;
      const exitCode = checker.runSecurityAuditTransition({
        cwd,
        environment: { PATH: "/bin" },
        runner(_command, _args, options) {
          calls += 1;
          snapshotCwd = options.cwd;
          return calls === 1
            ? thresholdProcessResult()
            : processResult({
                advisories: {},
                metadata: { vulnerabilities: {} },
              });
        },
        stdout: memoryStream().stream,
        stderr: memoryStream().stream,
      });

      assert.equal(exitCode, 1);
      assert.equal(calls, 2);
      assert.throws(() => lstatSync(snapshotCwd), /ENOENT/);
    }),
  );
});

test("rejects trust-file changes after every audit child return", async (t) => {
  const cases = [
    [
      "in-place content change",
      (file) => writeFileSync(file, `${expectedNpmrc}audit=false\n`),
    ],
    [
      "same-content inode replacement",
      (file) => {
        renameSync(file, `${file}.previous`);
        writeFileSync(file, expectedNpmrc);
      },
    ],
    [
      "changed then restored content",
      (file) => {
        writeFileSync(file, `${expectedNpmrc}audit=false\n`);
        writeFileSync(file, expectedNpmrc);
      },
    ],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () =>
      withAuditTrustFiles({}, (cwd) => {
        let calls = 0;
        const stderr = memoryStream();
        const exitCode = checker.runSecurityAuditTransition({
          cwd,
          environment: { PATH: "/bin" },
          runner() {
            calls += 1;
            mutate(path.join(cwd, ".npmrc"));
            return thresholdProcessResult();
          },
          stdout: memoryStream().stream,
          stderr: stderr.stream,
        });

        assert.equal(exitCode, 1);
        assert.equal(calls, 1);
        assert.match(stderr.read(), /AUDIT_TRUST_CONFIG/);
      }),
    );
  }

  await t.test("JSON audit return", () =>
    withAuditTrustFiles({}, (cwd) => {
      let calls = 0;
      const stderr = memoryStream();
      const exitCode = checker.runSecurityAuditTransition({
        cwd,
        environment: { PATH: "/bin" },
        runner() {
          calls += 1;
          if (calls === 2) {
            writeFileSync(
              path.join(cwd, "pnpm-workspace.yaml"),
              "packages: []\nauditConfig: {}\n",
            );
            return processResult();
          }
          return thresholdProcessResult();
        },
        stdout: memoryStream().stream,
        stderr: stderr.stream,
      });

      assert.equal(exitCode, 1);
      assert.equal(calls, 2);
      assert.match(stderr.read(), /AUDIT_TRUST_CONFIG/);
    }),
  );

  await t.test("failure result still revalidates trust", () =>
    withAuditTrustFiles({}, (cwd) => {
      const stderr = memoryStream();
      const exitCode = checker.runSecurityAuditTransition({
        cwd,
        environment: { PATH: "/bin" },
        runner() {
          writeFileSync(
            path.join(cwd, ".npmrc"),
            `${expectedNpmrc}audit=false\n`,
          );
          return {
            error: Object.assign(new Error("spawn failed"), { code: "ENOENT" }),
          };
        },
        stdout: memoryStream().stream,
        stderr: stderr.stream,
      });

      assert.equal(exitCode, 1);
      assert.match(stderr.read(), /AUDIT_TRUST_CONFIG/);
      assert.doesNotMatch(stderr.read(), /AUDIT_PROCESS_ERROR/);
    }),
  );
});

test("sanitizes every inherited registry spelling and forces the official registry", () =>
  withAuditTrustFiles({}, (cwd) => {
    const calls = [];
    const environment = {
      PATH: "/trusted/bin",
      HOME: "/trusted/home",
      npm_config_registry: "https://lower.invalid",
      NPM_CONFIG_REGISTRY: "https://upper.invalid",
      NpM_CoNfIg_ReGiStRy: "https://mixed.invalid",
      NPM_CONFIG_USERCONFIG: "/tmp/evil-userconfig",
      npm_config_globalconfig: "/tmp/evil-globalconfig",
      NPM_CONFIG_AUDIT_LEVEL: "critical",
      pnpm_home: "/tmp/evil-pnpm",
      NODE_OPTIONS: "--require=/tmp/preload.cjs",
      node_path: "/tmp/evil-modules",
      NODE_EXTRA_CA_CERTS: "/tmp/evil-ca.pem",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      SSL_CERT_FILE: "/tmp/evil-cert.pem",
      ssl_cert_dir: "/tmp/evil-certs",
      BASH_ENV: "/tmp/evil-bash-env",
      ENV: "/tmp/evil-env",
    };
    const exitCode = checker.runSecurityAuditTransition({
      cwd,
      environment,
      runner(...args) {
        calls.push(args);
        return calls.length === 1 ? thresholdProcessResult() : processResult();
      },
      npmExecPath: undefined,
      execPath: "/opt/node",
      platform: "linux",
      isFile: () => false,
      stdout: memoryStream().stream,
      stderr: memoryStream().stream,
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(environment, {
      PATH: "/trusted/bin",
      HOME: "/trusted/home",
      npm_config_registry: "https://lower.invalid",
      NPM_CONFIG_REGISTRY: "https://upper.invalid",
      NpM_CoNfIg_ReGiStRy: "https://mixed.invalid",
      NPM_CONFIG_USERCONFIG: "/tmp/evil-userconfig",
      npm_config_globalconfig: "/tmp/evil-globalconfig",
      NPM_CONFIG_AUDIT_LEVEL: "critical",
      pnpm_home: "/tmp/evil-pnpm",
      NODE_OPTIONS: "--require=/tmp/preload.cjs",
      node_path: "/tmp/evil-modules",
      NODE_EXTRA_CA_CERTS: "/tmp/evil-ca.pem",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      SSL_CERT_FILE: "/tmp/evil-cert.pem",
      ssl_cert_dir: "/tmp/evil-certs",
      BASH_ENV: "/tmp/evil-bash-env",
      ENV: "/tmp/evil-env",
    });
    const snapshotCwd = calls[0][2].cwd;
    assert.notEqual(snapshotCwd, cwd);
    const options = {
      cwd: snapshotCwd,
      encoding: "utf8",
      env: {
        PATH: "/trusted/bin",
        HOME: "/trusted/home",
        NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
        NPM_CONFIG_USERCONFIG: devNull,
        NPM_CONFIG_GLOBALCONFIG: devNull,
        NPM_CONFIG_IGNORE_PNPMFILE: "true",
        NPM_CONFIG_IGNORE_SCRIPTS: "true",
      },
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      timeout: 120_000,
      killSignal: "SIGTERM",
    };
    assert.deepEqual(calls, [
      ["pnpm", ["audit", "--audit-level", "moderate"], options],
      ["pnpm", ["audit", "--json"], options],
    ]);
  }));

test("wrapper invokes the exact command with a bounded buffer and timeout", () => {
  const calls = [];
  const stdout = memoryStream();
  const stderr = memoryStream();
  const exitCode = checker.runSecurityAuditTransition({
    cwd: process.cwd(),
    environment: {
      PATH: "/trusted/bin",
      HOME: "/trusted/home",
      HTTPS_PROXY: "http://proxy.invalid",
      CI: "true",
      npm_config_registry: "https://redirect.invalid",
      npm_config_audit_level: "critical",
      PNPM_HOME: "/tmp/evil",
      NODE_OPTIONS: "--require=/tmp/preload.cjs",
      NODE_PATH: "/tmp/modules",
      BASH_ENV: "/tmp/bash-env",
    },
    runner(...args) {
      calls.push(args);
      return calls.length === 1 ? thresholdProcessResult() : processResult();
    },
    npmExecPath: "/opt/corepack/pnpm.cjs",
    execPath: "/opt/node",
    platform: "linux",
    isFile: () => true,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 0);
  const snapshotCwd = calls[0][2].cwd;
  assert.notEqual(snapshotCwd, process.cwd());
  const options = {
    cwd: snapshotCwd,
    encoding: "utf8",
    env: {
      PATH: "/trusted/bin",
      HOME: "/trusted/home",
      HTTPS_PROXY: "http://proxy.invalid",
      CI: "true",
      NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
      NPM_CONFIG_USERCONFIG: devNull,
      NPM_CONFIG_GLOBALCONFIG: devNull,
      NPM_CONFIG_IGNORE_PNPMFILE: "true",
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
    },
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: 120_000,
    killSignal: "SIGTERM",
  };
  assert.deepEqual(calls, [
    [
      "/opt/node",
      ["/opt/corepack/pnpm.cjs", "audit", "--audit-level", "moderate"],
      options,
    ],
    ["/opt/node", ["/opt/corepack/pnpm.cjs", "audit", "--json"], options],
  ]);
  assert.match(stdout.read(), /^1 vulnerabilities found/);
  assert.match(stdout.read(), /Confirmed security audit transition:/);
  assert.equal(stderr.read(), "");
});

test("wrapper executes an absolute regular pnpm.exe directly without a shell", () => {
  const calls = [];
  const exitCode = checker.runSecurityAuditTransition({
    cwd: process.cwd(),
    environment: {
      Path: "C:\\Windows\\System32",
      npm_config_registry: "https://redirect.invalid",
    },
    runner(...args) {
      calls.push(args);
      return calls.length === 1 ? thresholdProcessResult() : processResult();
    },
    npmExecPath: "C:\\pnpm\\pnpm.exe",
    execPath: "C:\\node.exe",
    platform: "win32",
    isFile: () => true,
    stdout: memoryStream().stream,
    stderr: memoryStream().stream,
  });

  assert.equal(exitCode, 0);
  const snapshotCwd = calls[0][2].cwd;
  assert.notEqual(snapshotCwd, process.cwd());
  const options = {
    cwd: snapshotCwd,
    encoding: "utf8",
    env: {
      Path: "C:\\Windows\\System32",
      NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
      NPM_CONFIG_USERCONFIG: devNull,
      NPM_CONFIG_GLOBALCONFIG: devNull,
      NPM_CONFIG_IGNORE_PNPMFILE: "true",
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
    },
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: 120_000,
    killSignal: "SIGTERM",
  };
  assert.deepEqual(calls, [
    ["C:\\pnpm\\pnpm.exe", ["audit", "--audit-level", "moderate"], options],
    ["C:\\pnpm\\pnpm.exe", ["audit", "--json"], options],
  ]);
});

test("wrapper returns nonzero and emits bounded single-line safe diagnostics", () => {
  const output = memoryStream();
  const payload = transitionPayload();
  payload.advisories["1120680"].module_name =
    "https://user:password@registry.invalid/TOKEN_123\nINJECTED\u0000";

  let calls = 0;
  const exitCode = checker.runSecurityAuditTransition({
    runner: () => {
      calls += 1;
      return calls === 1 ? thresholdProcessResult() : processResult(payload);
    },
    npmExecPath: undefined,
    execPath: "/opt/node",
    platform: "linux",
    isFile: () => false,
    stdout: memoryStream().stream,
    stderr: output.stream,
  });
  const diagnostic = output.read();

  assert.equal(exitCode, 1);
  assert.match(diagnostic, /AUDIT_ADVISORY/);
  assert.ok(Buffer.byteLength(diagnostic) <= 1024);
  assertDoesNotLeak(diagnostic, /user|password|TOKEN_123|INJECTED/);
  assertDoesNotLeak(diagnostic.replace(/\n/g, ""), /[\u0000-\u001f\u007f]/);
  assert.ok(diagnostic.endsWith("\n"));
});

test("wrapper emits a focused timeout diagnostic and exits nonzero", () => {
  const output = memoryStream();
  const exitCode = checker.runSecurityAuditTransition({
    runner: () => ({
      error: Object.assign(new Error("raw timeout TOKEN_123"), {
        code: "ETIMEDOUT",
      }),
      status: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
    }),
    npmExecPath: undefined,
    execPath: "/opt/node",
    platform: "linux",
    isFile: () => false,
    stdout: memoryStream().stream,
    stderr: output.stream,
  });

  assert.equal(exitCode, 1);
  assert.match(output.read(), /AUDIT_TIMEOUT.*timed out/i);
  assertDoesNotLeak(output.read(), /TOKEN_123/);
});

test("wrapper handles ENOBUFS with a bounded sanitized structured failure", () => {
  const output = memoryStream();
  const exitCode = checker.runSecurityAuditTransition({
    runner: () => ({
      error: Object.assign(
        new Error("maxBuffer https://user:password@registry.invalid/TOKEN_123"),
        { code: "ENOBUFS" },
      ),
      status: null,
      signal: "SIGTERM",
      stdout: "TOKEN_123".repeat(10_000),
      stderr: "TOKEN_123".repeat(10_000),
    }),
    npmExecPath: undefined,
    execPath: "/opt/node",
    platform: "linux",
    isFile: () => false,
    stdout: memoryStream().stream,
    stderr: output.stream,
  });
  const diagnostic = output.read();

  assert.equal(exitCode, 1);
  assert.match(diagnostic, /AUDIT_PROCESS_ERROR.*4194304-byte output buffer/);
  assert.ok(Buffer.byteLength(diagnostic) <= 1024);
  assertDoesNotLeak(diagnostic, /user|password|registry|TOKEN_123/);
});

test("wrapper converts a synchronous runner throw into a safe failure", () => {
  const output = memoryStream();
  const exitCode = checker.runSecurityAuditTransition({
    runner() {
      throw Object.assign(
        new Error("runner https://user:password@registry.invalid/TOKEN_123"),
        { code: "EACCES" },
      );
    },
    npmExecPath: undefined,
    execPath: "/opt/node",
    platform: "linux",
    isFile: () => false,
    stdout: memoryStream().stream,
    stderr: output.stream,
  });
  const diagnostic = output.read();

  assert.equal(exitCode, 1);
  assert.match(diagnostic, /AUDIT_PROCESS_ERROR.*EACCES/);
  assert.ok(Buffer.byteLength(diagnostic) <= 1024);
  assertDoesNotLeak(diagnostic, /user|password|registry|TOKEN_123/);
});

test("wrapper fails safely on unsupported Windows invocation without calling runner", () => {
  const output = memoryStream();
  let runnerCalls = 0;
  const exitCode = checker.runSecurityAuditTransition({
    runner() {
      runnerCalls += 1;
      throw new Error("must not run TOKEN_123");
    },
    npmExecPath: "C:\\pnpm\\pnpm.cmd",
    execPath: "C:\\node.exe",
    platform: "win32",
    isFile: () => true,
    stdout: memoryStream().stream,
    stderr: output.stream,
  });
  const diagnostic = output.read();

  assert.equal(exitCode, 1);
  assert.equal(runnerCalls, 0);
  assert.match(diagnostic, /PNPM_LAUNCH_UNSUPPORTED/);
  assert.ok(Buffer.byteLength(diagnostic) <= 1024);
  assertDoesNotLeak(diagnostic, /TOKEN_123/);
});
