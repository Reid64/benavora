"use client";

import { Badge } from "@/components/ui";
import { contactInitials, RELATIONSHIP_COLOR, type ContactRow } from "@/components/contacts/contact-shared";
import { humanizeEnum } from "@/lib/utils/formatters";

export type ContactCardProps = {
  contact: ContactRow;
  onClick: () => void;
};

/** Card view of a contact (Elevated Slate design system) — the grid alternative
 * to the list view used elsewhere on the Contacts page. */
export function ContactCard({ contact, onClick }: ContactCardProps) {
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
      className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-12 h-12 rounded-full bg-[#0077B6] text-white flex items-center justify-center text-lg font-bold">
          {contactInitials(contact.name)}
        </div>
        {contact.relationship && (
          <Badge color={RELATIONSHIP_COLOR[contact.relationship]}>
            {humanizeEnum(contact.relationship)}
          </Badge>
        )}
      </div>

      <h3 className="text-base font-semibold text-slate-900 mt-3">{contact.name}</h3>
      {contact.title && (
        <p className="text-sm text-[#0077B6] font-medium">{contact.title}</p>
      )}
      <p className="text-xs text-slate-400">{contact.funderName}</p>
    </div>
  );
}
