import type { BenchAdapterId } from "./bench-adapter-families.js";

export interface BenchAdapterVersionsRecord {
  source: string;
  recordedAt: string;
  adapters: Record<string, Record<string, string>>;
}

export interface ReadAdapterVersionsOptions {
  benchAppDir?: string;
}

export declare const benchAdapterPackages: Record<
  BenchAdapterId,
  readonly string[]
>;

export declare const benchComparatorAdapterIds: readonly BenchAdapterId[];

export declare const BENCH_APP_DIR: string;

export declare function readInstalledPackageVersion(
  packageName: string,
  options?: ReadAdapterVersionsOptions,
): string;

export declare function readAdapterVersions(
  adapterId: BenchAdapterId,
  options?: ReadAdapterVersionsOptions,
): Record<string, string>;

export declare function createAdapterVersionsRecord(
  adapterIds: readonly BenchAdapterId[],
  options?: ReadAdapterVersionsOptions & { recordedAt?: string },
): BenchAdapterVersionsRecord;
