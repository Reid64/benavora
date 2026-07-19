"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List } from "lucide-react";

import { Badge, Select } from "@/components/ui";
import { ContactCard } from "@/components/contacts/ContactCard";
import {
  avatarColorForName,
  contactInitials,
  RELATIONSHIP_COLOR,
  type ContactRow,
} from "@/components/contacts/contact-shared";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { CONTACT_RELATIONSHIPS } from "@/lib/utils/constants";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

export type { ContactRow } from "@/components/contacts/contact-shared";
export { RELATIONSHIP_COLOR } from "@/components/contacts/contact-shared";

type ContactRelationship = Enums<"contact_relationship">;

export type ContactTableProps = {
  contacts: ContactRow[];
  isLoading?: boolean;
};

type ViewMode = "list" | "grid";

const RELATIONSHIP_FILTER_OPTIONS = [
  { value: "all", label: "All relationships" },
  ...CONTACT_RELATIONSHIPS.map((value) => ({
    value,
    label: humanizeEnum(value),
  })),
];

/**
 * Contact list with keyword search, a relationship filter, and a grid/list
 * view toggle (Elevated Slate design system). Filtering runs client-side over
 * the provided rows; clicking a card or row opens the contact detail page.
 * Search, filter, and view state are persisted to the URL so they survive
 * sidebar navigation.
 */
export function ContactTable({ contacts, isLoading = false }: ContactTableProps) {
  const router = useRouter();
  const { searchParams, setParams } = useUrlState();

  const query = searchParams.get("q") ?? "";
  const relationshipParam = searchParams.get("relationship");
  const relationship: ContactRelationship | "all" =
    relationshipParam &&
    (CONTACT_RELATIONSHIPS as readonly string[]).includes(relationshipParam)
      ? (relationshipParam as ContactRelationship)
      : "all";
  const view: ViewMode = searchParams.get("view") === "grid" ? "grid" : "list";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts
      .filter((contact) => {
        if (relationship !== "all" && contact.relationship !== relationship) {
          return false;
        }
        if (!q) return true;
        return (
          contact.name.toLowerCase().includes(q) ||
          contact.funderName.toLowerCase().includes(q) ||
          (contact.title?.toLowerCase().includes(q) ?? false) ||
          (contact.email?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, query, relationship]);

  function openContact(row: ContactRow) {
    router.push(`/contacts/${row.id}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:flex-1">
          <input
            type="search"
            defaultValue={query}
            onChange={(event) => setParams({ q: event.target.value || null })}
            placeholder="Search contacts..."
            aria-label="Search contacts"
            style={{ border: "1px solid #E2E8F0", backgroundColor: "#FFFFFF", color: "#334155" }}
            className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
          />
        </div>
        <div className="sm:w-56">
          <Select
            aria-label="Filter by relationship"
            options={RELATIONSHIP_FILTER_OPTIONS}
            value={relationship}
            onChange={(e) =>
              setParams({
                relationship: e.target.value === "all" ? null : e.target.value,
              })
            }
          />
        </div>
        <ViewToggle
          view={view}
          onChange={(v) => setParams({ view: v === "list" ? null : v })}
        />
      </div>

      {isLoading ? (
        <LoadingPlaceholder view={view} />
      ) : filtered.length === 0 ? (
        <div
          style={{ backgroundColor: "#FFFFFF", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)", color: "#64748B" }}
          className="p-10 text-center text-sm"
        >
          No contacts match your filters.
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              onClick={() => openContact(contact)}
            />
          ))}
        </div>
      ) : (
        <div
          style={{ backgroundColor: "#FFFFFF", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
          className="overflow-hidden"
        >
          {filtered.map((contact, i) => (
            <ContactListRow
              key={contact.id}
              contact={contact}
              onClick={() => openContact(contact)}
              isLast={i === filtered.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  return (
    <div
      style={{ border: "1px solid #E2E8F0", backgroundColor: "#FFFFFF" }}
      className="inline-flex shrink-0 rounded-lg p-0.5 shadow-sm"
    >
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-pressed={view === "list"}
        style={{
          backgroundColor: view === "list" ? "#0077B6" : "transparent",
          color: view === "list" ? "#FFFFFF" : "#475569",
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
      >
        <List className="h-4 w-4" aria-hidden />
        List
      </button>
      <button
        type="button"
        onClick={() => onChange("grid")}
        aria-pressed={view === "grid"}
        style={{
          backgroundColor: view === "grid" ? "#0077B6" : "transparent",
          color: view === "grid" ? "#FFFFFF" : "#475569",
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
      >
        <LayoutGrid className="h-4 w-4" aria-hidden />
        Grid
      </button>
    </div>
  );
}

function LoadingPlaceholder({ view }: { view: ViewMode }) {
  if (view === "grid") {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{ backgroundColor: "#F1F5F9" }}
            className="h-32 animate-pulse rounded-xl"
          />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          style={{ backgroundColor: "#F1F5F9" }}
          className="h-16 animate-pulse rounded-xl"
        />
      ))}
    </div>
  );
}

function ContactListRow({
  contact,
  onClick,
  isLast = false,
}: {
  contact: ContactRow;
  onClick: () => void;
  isLast?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      style={{ backgroundColor: "#FFFFFF", borderBottom: isLast ? "none" : "1px solid #F1F5F9" }}
      className="px-5 py-4 flex items-center gap-4 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
    >
      <div
        style={{ backgroundColor: avatarColorForName(contact.name), color: "#FFFFFF" }}
        className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center text-lg font-bold"
      >
        {contactInitials(contact.name)}
      </div>

      <div className="min-w-0 flex-1">
        <div style={{ color: "#0F172A" }} className="truncate text-base font-semibold">
          {contact.name}
        </div>
        {contact.title && (
          <div style={{ color: "#0077B6" }} className="truncate text-sm font-medium">
            {contact.title}
          </div>
        )}
        <div style={{ color: "#94A3B8" }} className="truncate text-xs">{contact.funderName}</div>
      </div>

      <div className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
        {contact.email ? (
          <a
            href={`mailto:${contact.email}`}
            onClick={(e) => e.stopPropagation()}
            style={{ color: "#0077B6" }}
            className="text-sm hover:underline"
          >
            {contact.email}
          </a>
        ) : (
          <span style={{ color: "#94A3B8" }} className="text-sm">No email</span>
        )}
        <span style={{ color: "#94A3B8" }} className="text-xs">
          {contact.last_contacted_at
            ? `Last contact ${formatDate(contact.last_contacted_at)}`
            : "Never contacted"}
        </span>
      </div>

      {contact.relationship && (
        <Badge color={RELATIONSHIP_COLOR[contact.relationship]} className="shrink-0">
          {humanizeEnum(contact.relationship)}
        </Badge>
      )}
    </div>
  );
}
