// Real, reorderable Command Center panel ids — shared between the client
// component (drag source) and the /api/command-center/layout route (server
// validation, so an authenticated PUT can't smuggle an arbitrary jsonb value
// into profiles.command_center_layout).

export const COMMAND_CENTER_PANEL_IDS = [
  "stats",
  "ai-pipeline",
  "data-intelligence",
  "top-orgs",
  "recent-runs",
] as const;

export type CommandCenterPanelId = (typeof COMMAND_CENTER_PANEL_IDS)[number];

export const DEFAULT_COMMAND_CENTER_LAYOUT: CommandCenterPanelId[] = [
  ...COMMAND_CENTER_PANEL_IDS,
];
