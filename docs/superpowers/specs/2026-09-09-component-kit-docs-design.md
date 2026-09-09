# Component kit documentation

The approved audit recommendation is to correct factual gaps, repair the custom-editor example, add one editor-control replacement example, and restructure and trim the guides. Keep the public runtime API unchanged.

Readers should first choose tokens (appearance), components (native control replacement while keeping editor behavior), or renderEditor (application-owned editing). Components should show a minimal replacement before its reference inventory. Preserve advanced overlay and native-control contracts in concise reference sections.

Add a small editable grid with module-scope TextInput, Textarea, and IconButton replacements, controlled rows, a delayed save, and a rejected quantity. Preserve supplied native props, handlers, ARIA attributes, styles/classes, and refs. The existing custom select example must supply a label, pending feedback, error association, cancellation and commit behavior. Document that custom renderers own those UI responsibilities.

Correct permission-check visibility, expose kit APIs in the website index, and explain editing exceptions in Keyboard. Consolidate repeated inventories, lifecycle descriptions, and warnings; place composition before See also. Retain canonical date/enum value contracts.

Validate example interactions in automated browser checks, registry consistency, website types/lint/tests/build, and Chrome on the deployed site. Follow the user's existing PR and merge-on-green authorization.
