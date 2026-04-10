import { BenchApp } from "./bench-app";
import { detectBrowserVersion } from "./bench-runtime";

export function App() {
  return (
    <BenchApp
      search={window.location.search}
      browserVersion={detectBrowserVersion(window.navigator.userAgent)}
    />
  );
}
