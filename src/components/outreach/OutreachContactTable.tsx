"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CheckCircle2 } from "lucide-react";

import {
  Badge,
  Button,
  Modal,
  SearchBar,
  Select,
  Table,
} from "@/components/ui";
import type { BadgeColor, TableColumn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { FUNDER_CATEGORIES, OUTREACH_STATUSES } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

const LIKELIHOOD_COLOR: Record<string, BadgeColor> = {
  high: "green",
  medium: "yellow",
  low: "gray",
};

const STATUS_COLOR: Record<string, BadgeColor> = {
  new: "blue",
  contacted: "yellow",
  responded: "indigo",
  converted: "green",
  unresponsive: "gray",
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...OUTREACH_STATUSES.map((value) => ({ value, label: humanizeEnum(value) })),
];

const CATEGORY_OPTIONS = FUNDER_CATEGORIES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

export type OutreachContactTableProps = {
  contacts: Tables<"outreach_contacts">[];
  isLoading?: boolean;
  /** Whether the current role may convert contacts (BLUEPRINT §3.2). */
  canConvert?: boolean;
  /** Tenant scope for the funder the conversion creates. */
  organizationId: string | null;
  /** Reload the list after a conversion. */
  onChanged: () => void | Promise<void>;
};

/**
 * Outreach contact list (BLUEPRINT §4.11): companies extracted by the Cold
 * Outreach Agent, with status and giving-likelihood columns and a
 * "Convert to Funder" action. Conversion creates a new funder and links it via
 * converted_to_funder_id (Behavioral Contracts §13).
 */
export function OutreachContactTable({
  contacts,
  isLoading = false,
  canConvert = false,
  organizationId,
  onChanged,
}: OutreachContactTableProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [converting, setConverting] =
    useState<Tables<"outreach_contacts"> | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (status !== "all" && (c.status ?? "new") !== status) return false;
      if (!q) return true;
      return (
        c.company_name.toLowerCase().includes(q) ||
        (c.contact_name?.toLowerCase().includes(q) ?? false) ||
        (c.email?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [contacts, query, status]);

  const columns: TableColumn<Tables<"outreach_contacts">>[] = [
    {
      key: "company",
      header: "Company",
      sortable: true,
      sortValue: (row) => row.company_name.toLowerCase(),
      render: (row) => (
        <span className="font-medium text-navy-900">{row.company_name}</span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      render: (row) => (
        <div className="min-w-0">
          <p className="text-navy-800">{row.contact_name ?? "—"}</p>
          {row.email && (
            <a
              href={`mailto:${row.email}`}
              className="text-xs text-teal-600 hover:text-teal-700"
              onClick={(e) => e.stopPropagation()}
            >
              {row.email}
            </a>
          )}
          {row.phone && <p className="text-xs text-navy-500">{row.phone}</p>}
        </div>
      ),
    },
    {
      key: "company_type",
      header: "Type",
      sortable: true,
      sortValue: (row) => row.company_type ?? "",
      render: (row) =>
        row.company_type ? (
          humanizeEnum(row.company_type)
        ) : (
          <span className="text-navy-400">—</span>
        ),
    },
    {
      key: "giving_likelihood",
      header: "Giving Likelihood",
      sortable: true,
      sortValue: (row) => row.giving_likelihood ?? "",
      render: (row) =>
        row.giving_likelihood ? (
          <Badge color={LIKELIHOOD_COLOR[row.giving_likelihood] ?? "gray"}>
            {humanizeEnum(row.giving_likelihood)}
          </Badge>
        ) : (
          <span className="text-navy-400">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (row) => row.status ?? "new",
      render: (row) => (
        <Badge color={STATUS_COLOR[row.status ?? "new"] ?? "gray"}>
          {humanizeEnum(row.status ?? "new")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => {
        const converted = !!row.converted_to_funder_id || row.status === "converted";
        if (converted) {
          return (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Converted
            </span>
          );
        }
        if (!canConvert) return null;
        return (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConverting(row)}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden />
            Convert to Funder
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:flex-1">
          <SearchBar
            onSearch={setQuery}
            placeholder="Search companies…"
            aria-label="Search outreach contacts"
          />
        </div>
        <div className="sm:w-48">
          <Select
            aria-label="Filter by status"
            options={STATUS_FILTER_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        </div>
      </div>

      <Table
        columns={columns}
        data={filtered}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        initialSort={{ key: "company", direction: "asc" }}
        emptyMessage="No outreach contacts match your filters."
      />

      <ConvertModal
        contact={converting}
        organizationId={organizationId}
        onClose={() => setConverting(null)}
        onConverted={async () => {
          setConverting(null);
          await onChanged();
        }}
      />
    </div>
  );
}

/**
 * Converts an outreach contact into a CRM funder (Behavioral Contracts §13):
 * creates a funder (name = company, has_giving_page = false), then links the
 * contact via converted_to_funder_id and marks it "converted".
 */
function ConvertModal({
  contact,
  organizationId,
  onClose,
  onConverted,
}: {
  contact: Tables<"outreach_contacts"> | null;
  organizationId: string | null;
  onClose: () => void;
  onConverted: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<FunderCategory>(
    "corporate_donation",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConvert() {
    if (!contact) return;
    if (!organizationId) {
      setError("Your session could not be verified.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();

    // Create the funder. organization_id is derived from the session profile,
    // never a form field (Behavioral Contracts §2). has_giving_page = false
    // preserves the cold-outreach origin.
    const { data: funder, error: funderError } = await supabase
      .from("funders")
      .insert({
        organization_id: organizationId,
        name: contact.company_name,
        category,
        has_giving_page: false,
        website: contact.source_url,
        notes:
          "Converted from cold outreach." +
          (contact.contact_name ? ` Primary contact: ${contact.contact_name}.` : ""),
      })
      .select("id")
      .single();

    if (funderError || !funder) {
      setError(funderError?.message ?? "Could not create the funder.");
      setSubmitting(false);
      return;
    }

    const { error: linkError } = await supabase
      .from("outreach_contacts")
      .update({
        converted_to_funder_id: funder.id,
        status: "converted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", contact.id);

    if (linkError) {
      setError(linkError.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    await onConverted();
    router.push(`/funders/${funder.id}`);
  }

  return (
    <Modal
      isOpen={!!contact}
      onClose={onClose}
      title="Convert to funder"
      description={
        contact
          ? `Create a CRM funder from ${contact.company_name}.`
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConvert} isLoading={submitting}>
            Convert
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        <Select
          label="Funder category"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(e) => setCategory(e.target.value as FunderCategory)}
        />
        <p className="text-sm text-navy-500">
          The new funder keeps this company&apos;s website and is flagged as a
          cold-outreach source. You can add contacts and opportunities to it
          afterward.
        </p>
      </div>
    </Modal>
  );
}
