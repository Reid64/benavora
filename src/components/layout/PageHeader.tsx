import { Children, cloneElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/Button";

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions (buttons, widgets). */
  actions?: ReactNode;
};

type StyleableElement = ReactElement<{
  variant?: string;
  className?: string;
  children?: ReactNode;
}>;

const PRIMARY_ACTION_CLASSES =
  "bg-[#0077B6] hover:bg-[#005F92] text-white px-5 py-2.5 rounded-lg font-semibold text-sm shadow-sm transition-colors inline-flex items-center gap-2";

function isStyleableElement(node: ReactNode): node is StyleableElement {
  return isValidElement(node);
}

/**
 * Recursively walks the actions tree and forces the primary action style
 * onto every default/"primary" Button, no matter how deep it's wrapped
 * (e.g. inside a next/link <Link>). Secondary/ghost/danger buttons and
 * everything else pass through untouched.
 */
function withEnforcedPrimaryStyle(node: ReactNode): ReactNode {
  if (!isStyleableElement(node)) return node;

  if (node.type === Button && (node.props.variant === undefined || node.props.variant === "primary")) {
    return cloneElement(node, { className: PRIMARY_ACTION_CLASSES });
  }

  if (node.props.children === undefined) return node;
  return cloneElement(node, {
    children: Children.map(node.props.children, withEnforcedPrimaryStyle),
  });
}

/**
 * Standard page header used at the top of every dashboard page: a
 * left-accented title block with the page title and optional subtitle, and
 * a right-hand actions slot. Fixed shape across the app.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="border-l-4 border-[#0077B6] pl-4">
          <h1 className="text-2xl font-bold text-primary tracking-tight">{title}</h1>
          {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-3">{Children.map(actions, withEnforcedPrimaryStyle)}</div>
        )}
      </div>
    </div>
  );
}
