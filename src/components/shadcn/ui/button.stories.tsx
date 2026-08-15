import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "./button";

/**
 * shadcn/ui primitive base (`src/components/shadcn/`), added 2026-08-15 once
 * CSS_OVERRIDE_INVESTIGATION_2026-08-15.md confirmed Tailwind-class-based
 * styling genuinely works again for these color families (no !important
 * fight) — see FEATURE_REGISTRY_v2.md's "The One UI Rule" for exactly which
 * families still require inline hex (navy/white; not touched by this button).
 */
const meta = {
  title: "shadcn/Button",
  component: Button,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "destructive", "outline", "secondary", "ghost", "link"],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Run Agent", variant: "default" },
};

export const Destructive: Story = {
  args: { children: "Delete", variant: "destructive" },
};

export const Outline: Story = {
  args: { children: "Cancel", variant: "outline" },
};

export const Secondary: Story = {
  args: { children: "Save Draft", variant: "secondary" },
};

export const Ghost: Story = {
  args: { children: "Dismiss", variant: "ghost" },
};

export const AllVariants: Story = {
  args: { children: "Button" },
  render: () => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Button variant="default">Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};
