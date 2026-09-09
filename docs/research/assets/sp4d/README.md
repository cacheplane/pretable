# Editor kit production visual checks

Baseline: `04dc1b5e`, production Next build, `/docs/grid/editing`, first
async editing example, 1280 × 900 viewport. The matching flows open Quantity,
enter `1.5` and commit to show the whole-number validation error, then cancel
and open Restock by. Chromium and WebKit use the same flows.

The baseline number error places its message beside the input and squeezes
away the editable value. The repair gives the message its own line and keeps
the field at the cell width. Editor-specific geometry and invalid outlines
must remain authoritative when TextInput/Textarea provide the native field.

- `baseline-*-number-error.png`: original validation layout.
- `baseline-*-date.png`: original date field and calendar.
- `baseline-chromium-date-forced.png`: original forced-color calendar.

Matched `after-*` screenshots use the production build containing `71c4c13a`
and the final editor CSS. Both engines display the number draft above a single
error line, with the error outline retained; full error text remains in the
alert and its hover title. The date-only padding correction leaves the full ISO
date visible. The browser measurement initially failed in both engines:
79.5px text competed for 78px of content space. The corrected field has 102px.

The companion `*-measurements.json` files record number-field and stepper
geometry. The narrow docs quantity field grows from its squeezed baseline to
roughly 75px, with a roughly 28px height while the error is shown. The wider
fixture also passes compact-density content-height and error-outline checks.

Chromium forced-color screenshots show system-painted calendar selection and
active outlines; WebKit screenshots verify ordinary layout. The fixture's
calendar-active test distinguishes a moved cursor from the selected date.
Direct Chrome MCP interaction verified save direction, full date selection,
truthful combobox/grid references, browsing without a changed saved date, and
no warning/error console messages.

Final local focused production suite: 34 Chromium/WebKit checks passed. Chromium forced-colors emulation is a rendering
check; synthetic composition events are regression checks. Neither represents
a physical OS IME session or a human screen-reader pass.
