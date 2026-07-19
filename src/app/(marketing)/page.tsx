import MarketingPageClient from "./MarketingPageClient";

export const revalidate = 3600;

export default function Page() {
  return <MarketingPageClient />;
}
