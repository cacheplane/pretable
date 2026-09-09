# SP4C control-state visual evidence

2026-09-08. Baseline CSS: `356e447f`; corrected CSS: `21421a79`.

The state harness uses the kit's actual option/checkbox DOM attributes and SVG
markup with the checked-in grid stylesheet and house theme. It isolates CSS
state combinations from application layout. Production React popup scope is
verified separately by `apps/website/e2e/overlay-scope.spec.ts`.

- [Forced light before](baseline-light-active.png) / [after](after-chromium-light-active.png): active option now has an independent outline; disabled and committed-disabled options use disabled system ink; disabled checked/mixed glyphs remain visible on the disabled surface.
- [Ordinary dark before](baseline-dark-none.png) / [after](after-chromium-dark-none.png): disabled checkboxes use a neutral surface, dim glyph and dashed border instead of looking enabled.
- [Forced dark OS palette before](baseline-chromium-dark-os-forced.png) / [after](after-chromium-dark-os-forced.png): system Canvas, Highlight, GrayText and their corresponding text/focus colors survive without author blue borders.
- [Ordinary WebKit dark after](after-webkit-dark-none.png): independent engine check of normal states.

Images were inspected and computed-state assertions checked disabled hover,
active outlines, checked/disabled fills and system borders/focus. Forced-color
emulation is Chromium evidence; it is not a physical Windows high-contrast or
human assistive-technology validation claim. Full task-local measurement logs
and the HTML/CLI harness are at `/tmp/pretable-sp4c-visual` on the task machine.

Production build after `bd5fe3c1`:

- [Chromium live dark/RTL scope](production-chromium-live-scope.png)
- [WebKit live light/LTR scope](production-webkit-live-scope.png)

These are the real React fixture after keyboard-triggered theme/direction
changes. Both engines assert token inheritance, direction, escaped clipping
and popup coordinates relative to the moved trigger. Nested filter dialogs
and their inner lists have the same position checks. Screenshots were visually
inspected after the final 16-case production run passed.
