import type { ReactNode } from 'react';
import {
  BanknoteIcon,
  BasketIcon,
  BulbIcon,
  CarIcon,
  CartIcon,
  CupIcon,
  DocumentIcon,
  DotsIcon,
  ForkKnifeIcon,
  HeartIcon,
  HomeIcon,
  ShirtIcon,
  SignalIcon,
  StarIcon,
} from '../../../shared/ui/icons.tsx';

const ICONS = {
  home: <HomeIcon />,
  basket: <BasketIcon />,
  cup: <CupIcon />,
  restaurant: <ForkKnifeIcon />,
  car: <CarIcon />,
  shirt: <ShirtIcon />,
  heart: <HeartIcon />,
  cart: <CartIcon />,
  cash: <BanknoteIcon />,
  signal: <SignalIcon />,
  star: <StarIcon />,
  document: <DocumentIcon />,
  bulb: <BulbIcon />,
  other: <DotsIcon />,
} satisfies Record<string, ReactNode>;

export type CategoryIconKey = keyof typeof ICONS;

/** Keywords in a category name (lower case) → icon; the first match wins. */
const RULES: [RegExp, CategoryIconKey][] = [
  [/жиль|аренд|квартир|ипотек|(^|[^а-яё])дом/, 'home'],
  [/продукт|(^|[^а-яё])еда|магазин|супермаркет/, 'basket'],
  [/кафе|кофе|(^|[^а-яё])чай/, 'cup'],
  [/ресторан|обед|доставк/, 'restaurant'],
  [/транспорт|такси|авто|бензин|машин|парков/, 'car'],
  [/одежд|обув/, 'shirt'],
  [/здоров|аптек|врач|медиц/, 'heart'],
  [/маркетплейс|покупк|wb|ozon|озон/, 'cart'],
  [/налич|снят/, 'cash'],
  [/связ|интернет|телефон|мобил/, 'signal'],
  [/развлеч|кино|игр|отдых/, 'star'],
  [/подписк|налог|услуг/, 'document'],
  [/коммунал|бытов|электр/, 'bulb'],
];

/** Which icon a category gets, by keywords in its name (case does not matter); everything else is «other». */
export function categoryIconKey(name: string): CategoryIconKey {
  const lower = name.toLowerCase();
  return RULES.find(([pattern]) => pattern.test(lower))?.[1] ?? 'other';
}

export const categoryIcon = (name: string): ReactNode => ICONS[categoryIconKey(name)];
