import Image from "next/image";

import { cn } from "@/lib/utils/cn";

export type LogoProps = {
  /** Pixel size of the square mark. Defaults to 36. */
  size?: number;
  /** Show the "Benavora" wordmark beside the mark. Defaults to true. */
  showWordmark?: boolean;
  /** Extra classes on the wrapper. */
  className?: string;
};

/**
 * Benavora brand lockup — the logo mark plus an optional wordmark.
 *
 * The mark is served from `public/`. Drop a real brand file at
 * `public/logo.png` and change `LOGO_SRC` to "/logo.png" to use it; the bundled
 * `/logo.svg` is a theme-matched placeholder so the UI is never broken.
 */
const LOGO_SRC = "/logo.svg";

export function Logo({ size = 36, showWordmark = true, className }: LogoProps) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image
        src={LOGO_SRC}
        alt="Benavora"
        width={size}
        height={size}
        priority
        className="rounded-xl shadow-glow-blue"
      />
      {showWordmark && (
        <span className="text-lg font-semibold tracking-tight text-white">
          Benavora
        </span>
      )}
    </span>
  );
}
