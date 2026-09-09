import {
  PretableTextarea,
  type PretableTextareaProps,
  type PretableTextareaComponent,
  type PretableComponents,
  type PretableBuiltInSite,
} from "@pretable/react";
import { forwardRef } from "react";
const ref = { current: null as HTMLTextAreaElement | null };
<PretableTextarea
  ref={ref}
  site="cell-editor"
  rows={3}
  wrap="soft"
  name="notes"
  autoComplete="off"
  readOnly
  aria-invalid
  onChange={(event) => {
    const node: HTMLTextAreaElement = event.currentTarget;
    void node;
  }}
/>;
// @ts-expect-error textarea has no input type
<PretableTextarea type="number" />;
// @ts-expect-error textarea refs require the textarea node
<PretableTextarea ref={{ current: null as HTMLInputElement | null }} />;
// @ts-expect-error use value or defaultValue rather than children
<PretableTextarea>Notes</PretableTextarea>;
const Replacement: PretableTextareaComponent = forwardRef<
  HTMLTextAreaElement,
  PretableTextareaProps
>(({ site, ...props }, fieldRef) => (
  <textarea {...props} ref={fieldRef} data-site={site} />
));
const slots: PretableComponents = { Textarea: Replacement };
const sites: PretableBuiltInSite[] = [
  "cell-editor",
  "number-increment",
  "number-decrement",
  "date-previous-month",
  "date-next-month",
];
void slots;
void sites;
