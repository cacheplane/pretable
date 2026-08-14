import { DensityScopeGrids } from "./grid";

/**
 * Test fixture for `apps/website/e2e/density-scope.spec.ts`.
 *
 * `data-density` scopes to a wrapper the way `data-theme` does: the density
 * tokens are CSS custom properties, so they inherit, and the engine resolves
 * them against the grid's own element rather than `document.documentElement`.
 *
 * Two of the claims in that spec are ones jsdom structurally cannot make.
 *
 *  1. **The scoped geometry is what gets PAINTED.** The grid element behind the
 *     read is a ref, and a ref is null while the render that creates it runs —
 *     so the first snapshot of a mounting grid resolves the root and something
 *     later replaces it. Whether that replacement beats the browser to the
 *     screen is a question about frames, and jsdom lays nothing out, so the unit
 *     suite converges either way. The per-frame sampler installed below is the
 *     instrument that tells them apart; it is what established that
 *     `PretableSurface` paints nothing size-dependent before its ref attaches,
 *     and it is the regression guard if that ever changes.
 *  2. **The rows are really that tall.** jsdom measures every element at zero.
 *
 * ## Why the numbers are what they are
 *
 * `--pretable-row-height` is a FLOOR, not a height: a row whose content is
 * taller is drawn at its content height. The docs site's own theme is loaded
 * here, and its compact tier puts the natural cell content around 33px, so both
 * tiers below are set well clear of that — otherwise the floor would not govern
 * and the assertion would be measuring the theme's padding instead of the token
 * under test. `--pretable-header-height` is used directly, so the header is the
 * crisper of the two signals and both are asserted.
 */

const ROOT_ROW_HEIGHT = 96;
const ROOT_HEADER_HEIGHT = 72;
const SCOPED_ROW_HEIGHT = 40;
const SCOPED_HEADER_HEIGHT = 28;

/**
 * Runs while the streamed HTML is still parsing — before React hydrates, which
 * is the whole point: the sampler has to be recording before any commit that
 * could paint the wrong density.
 *
 * The root values are written as an inline style on `<html>` rather than in the
 * stylesheet below so they beat whatever the site's own theme states, with no
 * specificity argument to lose.
 */
const BOOTSTRAP = `
(function () {
  var root = document.documentElement;
  root.style.setProperty("--pretable-row-height", "${ROOT_ROW_HEIGHT}px");
  root.style.setProperty("--pretable-header-height", "${ROOT_HEADER_HEIGHT}px");

  var samples = { scoped: [], unscoped: [] };
  window.__densitySamples = samples;
  window.__densityResetSamples = function () {
    samples.scoped.length = 0;
    samples.unscoped.length = 0;
  };

  function sample(key) {
    var host = document.querySelector('[data-testid="' + key + '"]');
    if (host === null) return;
    var row = host.querySelector("[data-pretable-row]");
    if (row === null) return;
    var height = Math.round(row.getBoundingClientRect().height * 100) / 100;
    var list = samples[key];
    // Runs of one value collapse: the assertion is about which heights were
    // ever on screen, and a 600-frame list of the same number says nothing more
    // than the number does.
    if (list.length === 0 || list[list.length - 1] !== height) list.push(height);
  }

  function tick() {
    sample("scoped");
    sample("unscoped");
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
`;

const THEME = `
  [data-density="compact"] {
    --pretable-row-height: ${SCOPED_ROW_HEIGHT}px;
    --pretable-header-height: ${SCOPED_HEADER_HEIGHT}px;
  }
`;

export default function DensityScopeFixturePage() {
  return (
    <main style={{ padding: 24 }}>
      <style dangerouslySetInnerHTML={{ __html: THEME }} />
      <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />
      <h1 style={{ marginBottom: 12 }}>Density scope fixture</h1>
      <DensityScopeGrids />
    </main>
  );
}
