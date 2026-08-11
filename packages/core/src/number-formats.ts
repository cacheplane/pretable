/**
 * Options for Pretable's currency number-format presets.
 *
 * @public
 */
export type PretableCurrencyFormatOptions = Omit<
  Intl.NumberFormatOptions,
  "style" | "currency" | "currencySign"
> & {
  currency: string;
};

function currencyOptions(
  options: PretableCurrencyFormatOptions,
  currencySign: "standard" | "accounting",
): Intl.NumberFormatOptions {
  return {
    ...options,
    style: "currency",
    currency: options.currency,
    currencySign,
  };
}

/**
 * Native number-format presets for money and accounting presentation.
 *
 * @public
 */
export const numberFormats = {
  money(options: PretableCurrencyFormatOptions): Intl.NumberFormatOptions {
    return currencyOptions(options, "standard");
  },
  accounting(options: PretableCurrencyFormatOptions): Intl.NumberFormatOptions {
    return currencyOptions(options, "accounting");
  },
} as const;
