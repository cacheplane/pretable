/**
 * Locale input accepted by Pretable's formatting and export surfaces.
 *
 * This intentionally matches the locale form available to ES2018 consumers.
 * `Intl.Locale` objects are not part of the supported ES2018 runtime contract.
 *
 * @public
 */
export type PretableLocale = string | readonly string[];
