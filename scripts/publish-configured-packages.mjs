import { publishPublicPackages } from "./publish-public-packages.mjs";

try {
  await publishPublicPackages();
} catch (error) {
  console.error(
    `Public package publish failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode =
    Number.isInteger(error?.exitCode) && error.exitCode !== 0
      ? error.exitCode
      : 1;
}
