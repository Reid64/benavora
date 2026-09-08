import Image from "next/image";
import { cn } from "@/lib/utils/cn";

export type LogoProps = {
  size?: number;
  showWordmark?: boolean;
  className?: string;
  /** Organization's own uploaded logo (Settings > Branding), when set. Falls back to the Benavora wordmark. */
  src?: string | null;
};

// #C49A4F, the "wordmarkGold" brand token (src/lib/marketing/theme.ts) - documented as
// "Logo only", but never actually applied: the flattened public/benavora_logo.png raster
// bakes the wordmark in as a near-white fill with no alpha channel, so it's unreadable
// against a light nav and shows as an opaque box on dark surfaces (e.g. the app sidebar).
// Rendered as real text here instead of trying to recover it from that raster.
const WORDMARK_GOLD = "#C49A4F";

export function Logo({ size = 36, showWordmark = true, className, src }: LogoProps) {
  if (src) {
    return (
      <span className={cn("flex items-center", className)}>
        <Image
          src={src}
          alt="Benavora"
          width={showWordmark ? 180 : size}
          height={showWordmark ? 54 : size}
          priority
          unoptimized
          className="object-contain"
        />
      </span>
    );
  }

  // public/benavora_icon.png is 472x443 (~1.065:1) - use its real aspect ratio so next/image
  // doesn't warn about a CSS-overridden dimension.
  const iconHeight = showWordmark ? 36 : size;
  const iconWidth = Math.round(iconHeight * (472 / 443));
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <Image
        src="/benavora_icon.png"
        alt="Benavora"
        width={iconWidth}
        height={iconHeight}
        priority
        className="object-contain"
      />
      {showWordmark && (
        <span
          className="font-sans font-extrabold leading-none"
          style={{ color: WORDMARK_GOLD, fontSize: iconHeight * 0.72 }}
        >
          benavora
        </span>
      )}
    </span>
  );
}
