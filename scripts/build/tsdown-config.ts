import type { UserConfig } from "tsdown/config";

type DependencyPattern = string | RegExp;

export interface PublicPackageBuildOptions {
  alwaysBundle?: DependencyPattern[];
  inputOptions?: UserConfig["inputOptions"];
  neverBundle?: DependencyPattern[];
}

export function publicPackageConfig({
  alwaysBundle,
  inputOptions,
  neverBundle,
}: PublicPackageBuildOptions = {}): UserConfig {
  const deps =
    alwaysBundle || neverBundle
      ? {
          ...(alwaysBundle ? { alwaysBundle } : {}),
          ...(neverBundle ? { neverBundle } : {}),
        }
      : undefined;

  return {
    clean: ["dist"],
    ...(deps ? { deps } : {}),
    dts: { newContext: true, resolver: "tsc", sourcemap: true },
    entry: ["src/index.ts"],
    exports: false,
    failOnWarn: true,
    fixedExtension: true,
    format: ["esm", "cjs"],
    hash: false,
    ...(inputOptions ? { inputOptions } : {}),
    minify: false,
    outDir: "dist",
    outputOptions: { codeSplitting: false },
    platform: "neutral",
    sourcemap: true,
    target: "es2018",
    treeshake: true,
    tsconfig: "tsconfig.build.json",
  };
}
