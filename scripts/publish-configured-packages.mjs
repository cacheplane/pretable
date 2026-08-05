import { runPublishCli } from "./publish-public-packages.mjs";

await runPublishCli({ args: process.argv.slice(2) });
