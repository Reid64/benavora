import Image from "next/image";
import { cn } from "@/lib/utils/cn";

export type LogoProps = {
  size?: number;
  showWordmark?: boolean;
  className?: string;
};

export function Logo({ size = 36, showWordmark = true, className }: LogoProps) {
  return (
    <span className={cn("flex items-center", className)}>
      <Image
        src="/benavora_logo.png"
        alt="Benavora"
        width={showWordmark ? 180 : size}
        height={showWordmark ? 54 : size}
        priority
        className="object-contain"
      />
    </span>
  );
}
