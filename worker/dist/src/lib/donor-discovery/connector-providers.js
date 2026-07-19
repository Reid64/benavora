"use strict";
// Shared provider catalog for Donor Discovery BYO-key connectors
// (DONOR_DISCOVERY_ARCHITECTURE.md §6). One source of truth for the page and
// both API routes so the "coming soon" gate can't drift between them.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONNECTOR_PROVIDERS = void 0;
exports.isConnectorProvider = isConnectorProvider;
exports.getConnectorProvider = getConnectorProvider;
exports.CONNECTOR_PROVIDERS = [
    {
        key: "google_places",
        name: "Google Places",
        description: "Enumerate local businesses by category and radius. Required for non-Faith-Foundation organizations to run Donor Discovery searches.",
        connectable: true,
    },
    {
        key: "apollo",
        name: "Apollo.io",
        description: "Company + contact enrichment — decision-maker names, titles, and verified emails.",
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
function isConnectorProvider(value) {
    return typeof value === "string" && exports.CONNECTOR_PROVIDERS.some((p) => p.key === value);
}
function getConnectorProvider(key) {
    const config = exports.CONNECTOR_PROVIDERS.find((p) => p.key === key);
    if (!config)
        throw new Error(`Unknown connector provider: ${key}`);
    return config;
}
