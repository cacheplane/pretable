const ENUM_CHOICE = Symbol("pretable.enum-choice");

/** Internal identity channel: only intentional choices bypass text matching. */
export interface EnumChoiceDraft {
  readonly [ENUM_CHOICE]: true;
  readonly value: string;
}
export function enumChoice(value: string): EnumChoiceDraft {
  return { [ENUM_CHOICE]: true, value };
}
export function isEnumChoice(draft: unknown): draft is EnumChoiceDraft {
  return (
    typeof draft === "object" &&
    draft !== null &&
    ENUM_CHOICE in draft &&
    draft[ENUM_CHOICE] === true &&
    "value" in draft &&
    typeof draft.value === "string"
  );
}
export function enumDraftText(draft: unknown): string {
  return isEnumChoice(draft) ? draft.value : String(draft ?? "");
}
