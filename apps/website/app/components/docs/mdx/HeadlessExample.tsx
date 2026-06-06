import { headlessCustomRenderer } from "../../../../content/examples/headless-custom-renderer";
import { Example } from "./Example";

export function HeadlessExample() {
  return <Example example={headlessCustomRenderer} showLive defaultOpen />;
}
