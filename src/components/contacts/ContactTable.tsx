"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, SearchBar, Select, Table } from "@/components/ui";
import type { BadgeColor, TableColumn } from "@/components/ui";
import { CONTACT_RELATIONSHIPS } from "@/lib/utils/constants";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type ContactRelationship = Enums<"contact_relationship">;

/** Badge colors per relationship stage — shared with the detail view. */
export const RELATIONSHIP_COLOR: Record<ContactRelationship, BadgeColor> = {
  cold: "gray",
  warm: "yellow",
  active: "blue",
  champion: "green",
};

/** A contact row enriched with its funder's name for display and search. */
export type ContactRow = Tables<"contacts"> & {
  funderName: string;
};

export type ContactTableProps = {
  contacts: ContactRow[];
  isLoading?: boolean;
};

const RELATIONSHIP_FILTER_OPTIONS = [
  { value: "all", label: "All relationships" },
  ...CONTACT_RELATIONSHIPS.map((value) => ({
    value,
    label: humanizeEnum(value),
  })),
];

/**
 * Sortable contact list with keyword search and a relationship filter
 * (BLUEPRINT §4.3). Filtering and sorting run client-side over the provided
 * rows. Clicking a row opens the contact detail page.
 */
export function ContactTable({ contacts, isLoading = false }: ContactTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [relationship, setRelationship] = useState<
    ContactRelationship | "all"
  >("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((contact) => {
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
    });
  }, [contacts, query, relationship]);

  const columns: TableColumn<ContactRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (row) => row.name.toLowerCase(),
      render: (row) => (
        <div>
          <span className="font-medium text-navy-900">{row.name}</span>
          {row.title && (
            <span className="mt-0.5 block text-xs text-navy-500">
              {row.title}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "funder",
      header: "Funder",
      sortable: true,
      sortValue: (row) => row.funderName.toLowerCase(),
      render: (row) => row.funderName,
    },
    {
      key: "email",
      header: "Email",
      render: (row) =>
        row.email ? (
          <a
            href={`mailto:${row.email}`}
            onClick={(e) => e.stopPropagation()}
            className="text-teal-600 hover:text-teal-700"
          >
            {row.email}
          </a>
        ) : (
          <span className="text-navy-400">—</span>
        ),
    },
    {
      key: "phone",
      header: "Phone",
      render: (row) => row.phone ?? <span className="text-navy-400">—</span>,
    },
    {
      key: "relationship",
      header: "Relationship",
      sortable: true,
      sortValue: (row) => row.relationship ?? "",
      render: (row) =>
        row.relationship ? (
          <Badge color={RELATIONSHIP_COLOR[row.relationship]}>
            {humanizeEnum(row.relationship)}
          </Badge>
        ) : (
          <span className="text-navy-400">—</span>
        ),
    },
    {
      key: "last_contacted",
      header: "Last Contact",
      sortable: true,
      sortValue: (row) => row.last_contacted_at ?? "",
      render: (row) =>
        row.last_contacted_at ? (
          formatDate(row.last_contacted_at)
        ) : (
          <span className="text-navy-400">Never</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:flex-1">
          <SearchBar
            onSearch={setQuery}
            placeholder="Search contacts…"
            aria-label="Search contacts"
          />
        </div>
        <div className="sm:w-56">
          <Select
            aria-label="Filter by relationship"
            options={RELATIONSHIP_FILTER_OPTIONS}
            value={relationship}
            onChange={(e) =>
              setRelationship(e.target.value as ContactRelationship | "all")
            }
          />
        </div>
      </div>

      <Table
        columns={columns}
        data={filtered}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/contacts/${row.id}`)}
        initialSort={{ key: "name", direction: "asc" }}
        emptyMessage="No contacts match your filters."
      />
    </div>
  );
}
