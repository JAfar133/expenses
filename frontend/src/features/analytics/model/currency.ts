import { currencyDigits } from '../../../shared/utils/conversion.ts';
export { currencyLabel, flagOf } from '../../../shared/utils/currency-flags.ts';

/** How many decimals to show for an amount: drams (the pivot currency) are whole, other currencies have cents. */
export const moneyDigits = (code: string, pivot = 'AMD') => currencyDigits(code, pivot);
