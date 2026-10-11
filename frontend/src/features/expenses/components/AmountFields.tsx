import type { UseFormReturn } from 'react-hook-form';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import {
  formatAmountInput,
  formatDecimalInput,
  formatMoney,
  parseDecimal,
} from '../../../shared/utils/money.ts';
import type { RatesResponse } from '../api/expenses.api.ts';
import type { ExpenseFormValues } from '../schemas/expense-form.schema.ts';

const AMOUNT_DECIMALS = 2;
const RATE_DECIMALS = 6;

interface AmountFieldsProps {
  form: UseFormReturn<ExpenseFormValues>;
  /** Базовая валюта (драмы): в ней учёт и Excel */
  base: string;
  /** Доступные валюты и курсы; пока не загрузились, доступна только базовая */
  rates?: RatesResponse;
}

/** Курс валюты в виде для поля ввода (`380,5`); пусто, если курса нет. */
export function rateText(rates: RatesResponse | undefined, currency: string): string {
  const rate = rates?.rates.find((item) => item.currency === currency)?.rate;
  return rate === undefined ? '' : formatDecimalInput(String(rate), { maxDecimals: RATE_DECIMALS });
}

/** Сумма в драммах по введённым сумме и курсу; null, пока что-то не введено. */
export function convertedAmount(amount: string, rate: string): number | null {
  const [value, factor] = [parseDecimal(amount), parseDecimal(rate)];
  return value === null || factor === null ? null : Math.round(value * factor);
}

/**
 * Стоимость, валюта и (для иностранной валюты) курс с пересчётом в драммы.
 * В драммах сумма целая, в иностранной валюте можно вводить копейки.
 */
export function AmountFields({ form, base, rates }: AmountFieldsProps) {
  const { register, setValue, getValues, watch, formState } = form;
  const [currency, amount, rate] = watch(['currency', 'amount', 'rate']);
  const { errors } = formState;

  const currencies = rates?.currencies ?? [base];
  const isForeign = currency !== base;

  const amountField = register('amount');
  const currencyField = register('currency');

  const changeCurrency = (next: string) => {
    // Сумма с копейками в драммах невозможна: оставляем целую часть
    if (next === base) {
      const whole = getValues('amount').split(/[.,]/)[0] ?? '';
      setValue('amount', formatAmountInput(whole));
    }
    setValue('rate', next === base ? '' : rateText(rates, next), { shouldValidate: false });
  };

  const converted = isForeign ? convertedAmount(amount, rate) : null;

  return (
    <>
      <Field label="Стоимость" htmlFor="amount" error={errors.amount?.message}>
        <div className="relative">
          <input
            id="amount"
            type="text"
            inputMode={isForeign ? 'decimal' : 'numeric'}
            autoComplete="off"
            className={`${inputClassName} pr-24`}
            aria-invalid={!!errors.amount}
            {...amountField}
            onChange={(event) => {
              event.target.value = isForeign
                ? formatDecimalInput(event.target.value, {
                    maxDecimals: AMOUNT_DECIMALS,
                    group: true,
                  })
                : formatAmountInput(event.target.value);
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
                  {item}
                </option>
              ))}
            </select>
          ) : (
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-zinc-500">
              {base}
            </span>
          )}
        </div>
        {converted !== null && (
          <p className="text-sm text-zinc-500" aria-live="polite">
            ≈ {formatMoney(converted)} {base}
          </p>
        )}
      </Field>

      {isForeign && (
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
