import type { UseFormReturn } from 'react-hook-form';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { currencyLabel } from '../../../shared/utils/currency-flags.ts';
import {
  formatDecimalInput,
  caretAfterFormat,
  formatAmount,
  formatMoney,
  parseDecimal,
} from '../../../shared/utils/money.ts';
import { crossRate, currencyDigits } from '../../../shared/utils/conversion.ts';
import type { Card, RatesResponse } from '../api/expenses.api.ts';
import type { ExpenseFormValues } from '../schemas/expense-form.schema.ts';

const AMOUNT_DECIMALS = 2;
const RATE_DECIMALS = 6;

interface AmountFieldsProps {
  form: UseFormReturn<ExpenseFormValues>;
  /** Base currency (drams): rates are quoted against it, its amounts are whole */
  base: string;
  cards: Card[];
  /** Available currencies and rates; until loaded, only the card currency is available */
  rates?: RatesResponse;
}

/** Currency rate formatted for the input (`380,5`); empty if there is no rate. */
export function rateText(rates: RatesResponse | undefined, currency: string): string {
  const rate = rates?.rates.find((item) => item.currency === currency)?.rate;
  return rate === undefined ? '' : formatDecimalInput(String(rate), { maxDecimals: RATE_DECIMALS });
}

/** Amount in the card currency from the typed amount and the rate (drams per typed unit); null until something is missing. */
export function convertedAmount(
  amount: string,
  inputRate: number,
  cardRate: number,
  digits: number,
): number | null {
  const value = parseDecimal(amount);
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(((value * inputRate) / cardRate) * factor) / factor;
}

/**
 * Cost, currency and (when needed) rate with conversion into the card currency.
 * The currency starts as the card's one. The amount takes up to two decimals in any currency, drams included.
 */
export function AmountFields({ form, base, cards, rates }: AmountFieldsProps) {
  const { register, setValue, getValues, watch, formState } = form;
  const [currency, amount, rate, card] = watch(['currency', 'amount', 'rate', 'card']);
  const { errors } = formState;

  const cardCurrency = cards.find((item) => item.name === card)?.currency ?? base;
  const currencies = [...new Set([cardCurrency, ...(rates?.currencies ?? [])])];
  const isBase = currency === base;
  // A rate is needed only when the typed currency is neither drams nor the card currency
  const needsRate = !isBase && currency !== cardCurrency;

  const amountField = register('amount');
  const currencyField = register('currency');

  const changeCurrency = (next: string) => {
    const rateNeeded = next !== base && next !== cardCurrency;
    setValue('rate', rateNeeded ? rateText(rates, next) : '', { shouldValidate: false });
  };

  const inputRate = isBase ? 1 : parseDecimal(rate);
  const cardRate = crossRate(rates?.rates, cardCurrency, base, base);
  const converted =
    currency !== cardCurrency && inputRate !== null && cardRate !== undefined
      ? convertedAmount(amount, inputRate, cardRate, AMOUNT_DECIMALS)
      : null;

  return (
    <>
      <Field label="Стоимость" htmlFor="amount" error={errors.amount?.message}>
        <div className="relative">
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            // The most visible field of the form: big semibold digits
            className={`${inputClassName} h-14 pr-28 text-2xl font-semibold tabular-nums`}
            aria-invalid={!!errors.amount}
            {...amountField}
            onChange={(event) => {
              const input = event.target;
              const raw = input.value;
              const caret = input.selectionStart ?? raw.length;
              const formatted = formatDecimalInput(raw, {
                maxDecimals: AMOUNT_DECIMALS,
                group: true,
              });
              if (formatted !== raw) {
                input.value = formatted;
                // Keep the caret where the person is typing, not at the end
                const position = caretAfterFormat(raw, caret, formatted);
                input.setSelectionRange?.(position, position);
              }
              return amountField.onChange(event);
            }}
          />
          {currencies.length > 1 ? (
            <select
              aria-label="Валюта"
              className="absolute inset-y-1 right-1 rounded-lg bg-zinc-100 px-2 text-sm font-medium outline-none dark:bg-zinc-800"
              {...currencyField}
              onChange={(event) => {
                changeCurrency(event.target.value);
                return currencyField.onChange(event);
              }}
            >
              {currencies.map((item) => (
                <option key={item} value={item}>
                  {currencyLabel(item)}
                </option>
              ))}
            </select>
          ) : (
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-zinc-500">
              {currencyLabel(cardCurrency)}
            </span>
          )}
        </div>
        {currency !== cardCurrency && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            валюта отличается от валюты карты ({cardCurrency})
          </p>
        )}
        {converted !== null && (
          <p className="text-sm text-zinc-500" aria-live="polite">
            ≈ {formatAmount(converted, currencyDigits(cardCurrency, base))} {cardCurrency}
          </p>
        )}
      </Field>

      {needsRate && (
        <Field label={`Курс: ${base} за 1 ${currency}`} htmlFor="rate" error={errors.rate?.message}>
          <input
            id="rate"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className={inputClassName}
            aria-invalid={!!errors.rate}
            {...register('rate', {
              onChange: (event) => {
                event.target.value = formatDecimalInput(event.target.value, {
                  maxDecimals: RATE_DECIMALS,
                });
              },
            })}
          />
          {!rate && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Курс не загрузился, введите его вручную
            </p>
          )}
        </Field>
      )}
    </>
  );
}
