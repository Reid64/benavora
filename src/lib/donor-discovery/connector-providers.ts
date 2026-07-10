// Shared provider catalog for Donor Discovery BYO-key connectors
// (DONOR_DISCOVERY_ARCHITECTURE.md §6). One source of truth for the page and
// both API routes so the "coming soon" gate can't drift between them.

export type DdConnectorProvider = "google_places" | "apollo" | "hunter" | "zoominfo" | "clay";

export interface ConnectorProviderConfig {
  key: DdConnectorProvider;
  name: string;
  description: string;
  /** false = "coming soon" — UI disables Connect, API rejects test/save. */
  connectable: boolean;
}

export const CONNECTOR_PROVIDERS: ConnectorProviderConfig[] = [
  {
    key: "google_places",
    name: "Google Places",
    description:
      "Enumerate local businesses by category and radius. Required for non-Faith-Foundation organizations to run Donor Discovery searches.",
    connectable: true,
  },
  {
    key: "apollo",
    name: "Apollo.io",
    description:
      "Company + contact enrichment — decision-maker names, titles, and verified emails.",
    connectable: true,
  },
  {
    key: "hunter",
    name: "Hunter.io",
    description: "Email discovery and verification for prospect contacts.",
    connectable: true,
  },
  {
    key: "zoominfo",
    name: "ZoomInfo",
    description: "Enterprise firmographics. Coming soon.",
    connectable: false,
  },
  {
    key: "clay",
    name: "Clay",
    description: "Multi-source enrichment. Coming soon.",
    connectable: false,
  },
];

export function isConnectorProvider(value: unknown): value is DdConnectorProvider {
  return typeof value === "string" && CONNECTOR_PROVIDERS.some((p) => p.key === value);
}

export function getConnectorProvider(key: DdConnectorProvider): ConnectorProviderConfig {
  const config = CONNECTOR_PROVIDERS.find((p) => p.key === key);
  if (!config) throw new Error(`Unknown connector provider: ${key}`);
  return config;
}
