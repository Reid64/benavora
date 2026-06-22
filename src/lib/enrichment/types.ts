export type enrichment_source =
  | "propublica"
  | "irs_990"
  | "irs_990_xml"
  | "irs_990_index"
  | "web_search"
  | "website_scrape"
  | "candid"
  | "manual";

export interface EnrichmentResult {
  source: enrichment_source;
  website?: string;
  emails: string[];
  phones: string[];
  officers: Array<{ name: string; title: string }>;
  revenue?: number;
  assets?: number;
  giving?: number;
  programs?: string[];
  address?: { street: string; city: string; state: string; zip: string };
  confidence: number;
  raw: unknown;
}

export interface FilingDetails {
  year: number;
  total_revenue?: number;
  total_assets?: number;
  total_giving?: number;
  program_service_revenue?: number;
  filing_url?: string;
}
