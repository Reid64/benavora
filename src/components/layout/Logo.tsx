import Image from "next/image";
import { cn } from "@/lib/utils/cn";

export type LogoProps = {
  size?: number;
  showWordmark?: boolean;
  className?: string;
  /** Organization's own uploaded logo (Settings > Branding), when set. Falls back to the Benavora wordmark. */
  src?: string | null;
};

export function Logo({ size = 36, showWordmark = true, className, src }: LogoProps) {
  return (
    <span className={cn("flex items-center", className)}>
      <Image
        src={src || "/benavora_logo.png"}
        alt="Benavora"
        width={showWordmark ? 180 : size}
        height={showWordmark ? 54 : size}
        priority
        unoptimized={Boolean(src)}
        className="object-contain"
      />
    </span>
  );
}
