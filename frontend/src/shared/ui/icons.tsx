import type { ReactNode } from 'react';

/** One stroke style for all icons: 24px grid, current text color, round caps. */
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      {children}
    </svg>
  );
}

export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Icon>
);

/** Rename */
export const PencilIcon = () => (
  <Icon>
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </Icon>
);

/** Card access */
export const LockIcon = () => (
  <Icon>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const ArchiveIcon = () => (
  <Icon>
    <path d="M21 8v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8" />
    <rect x="2" y="3" width="20" height="5" rx="1" />
    <path d="M10 12h4" />
  </Icon>
);

/** Restore from the archive */
export const UndoIcon = () => (
  <Icon>
    <path d="M3 4v6h6" />
    <path d="M3.5 15a9 9 0 1 0 2.1-9.4L3 10" />
  </Icon>
);

export const MergeIcon = () => (
  <Icon>
    <path d="M4 4l8 8M20 4l-8 8M12 12v8" />
    <path d="M9 17l3 3 3-3" />
  </Icon>
);

/** Password reset link */
export const KeyIcon = () => (
  <Icon>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="M10.7 12.3L21 2m-3 3l3 3m-6-0l2.5 2.5" />
  </Icon>
);

export const UserMinusIcon = () => (
  <Icon>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M17 11h6" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <path d="M8 5v14M16 5v14" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M7 4.5l12 7.5-12 7.5z" />
  </Icon>
);

/** Make an owner */
export const CrownIcon = () => (
  <Icon>
    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" />
  </Icon>
);

/** Make a plain member (a crossed-out crown) */
export const CrownOffIcon = () => (
  <Icon>
    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" />
    <path d="M4 3l16 18" />
  </Icon>
);

/** Download a file */
export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </Icon>
);

export const RefreshIcon = () => (
  <Icon>
    <path d="M20 5v5h-5" />
    <path d="M19.5 10A8 8 0 1 0 20 14" />
  </Icon>
);

export const WarningIcon = () => (
  <Icon size={16}>
    <path d="M12 4l9 16H3L12 4z" />
    <path d="M12 10v4M12 17.5v.01" />
  </Icon>
);

/** A spending limit */
export const GaugeIcon = () => (
  <Icon>
    <path d="M4.5 17a8 8 0 1 1 15 0" />
    <path d="M12 14l4-5" />
    <path d="M3 20h18" />
  </Icon>
);

/* Category icons: a small fixed set, picked by the name of a category (see features/budgets/model/category-icon.tsx) */

export const HomeIcon = () => (
  <Icon>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
    <path d="M10 20v-6h4v6" />
  </Icon>
);

export const BasketIcon = () => (
  <Icon>
    <path d="M5 9h14l-1.5 10h-11L5 9z" />
    <path d="M9 9l3-5 3 5" />
  </Icon>
);

export const CupIcon = () => (
  <Icon>
    <path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8z" />
    <path d="M16 10h2a2 2 0 0 1 0 4h-2" />
    <path d="M8 3v2M12 3v2" />
  </Icon>
);

export const ForkKnifeIcon = () => (
  <Icon>
    <path d="M6 3v7a2 2 0 0 0 4 0V3M8 3v18" />
    <path d="M17 3c-2 2-2 6 0 8v10" />
  </Icon>
);

export const CarIcon = () => (
  <Icon>
    <path d="M5 17v-4l2-5h10l2 5v4z" />
    <path d="M5 13h14" />
    <circle cx="8.5" cy="17.5" r="1.5" />
    <circle cx="15.5" cy="17.5" r="1.5" />
  </Icon>
);

export const ShirtIcon = () => (
  <Icon>
    <path d="M8 3L3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z" />
  </Icon>
);

export const HeartIcon = () => (
  <Icon>
    <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />
  </Icon>
);

export const CartIcon = () => (
  <Icon>
    <path d="M3 4h2l2.5 11h10l2-8H6.5" />
    <circle cx="9" cy="19.5" r="1.2" />
    <circle cx="17" cy="19.5" r="1.2" />
  </Icon>
);

export const BanknoteIcon = () => (
  <Icon>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
  </Icon>
);

export const SignalIcon = () => (
  <Icon>
    <path d="M5 19v-3M10 19v-7M15 19V8M20 19V4" />
  </Icon>
);

export const StarIcon = () => (
  <Icon>
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" />
  </Icon>
);

export const DocumentIcon = () => (
  <Icon>
    <path d="M7 3h7l4 4v14H7V3z" />
    <path d="M14 3v4h4M10 12h5M10 16h5" />
  </Icon>
);

export const BulbIcon = () => (
  <Icon>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" />
  </Icon>
);

export const DotsIcon = () => (
  <Icon>
    <circle cx="6" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="18" cy="12" r="1" />
  </Icon>
);

export const ChevronRightIcon = () => (
  <Icon size={16}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon size={16}>
    <path d="M5 9l7 7 7-7" />
  </Icon>
);

/* User menu */

export const SettingsIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
);

export const UsersIcon = () => (
  <Icon>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
  </Icon>
);

export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
  </Icon>
);

export const LogoutIcon = () => (
  <Icon>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon size={16}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CameraIcon = () => (
  <Icon>
    <path d="M4 8h3l2-3h6l2 3h3v11H4V8z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <circle cx="5" cy="12" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="19" cy="12" r="1.3" />
  </Icon>
);

export const CreditCardIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18M7 15h4" />
  </Icon>
);
