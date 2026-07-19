"use client";

import { Badge } from "@/components/ui";
import {
  avatarColorForName,
  contactInitials,
  RELATIONSHIP_COLOR,
  type ContactRow,
} from "@/components/contacts/contact-shared";
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
      style={{ backgroundColor: "#FFFFFF", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
      className="p-5 hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div
          style={{ backgroundColor: avatarColorForName(contact.name), color: "#FFFFFF" }}
          className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
        >
          {contactInitials(contact.name)}
        </div>
        {contact.relationship && (
          <Badge color={RELATIONSHIP_COLOR[contact.relationship]}>
            {humanizeEnum(contact.relationship)}
          </Badge>
        )}
      </div>

      <h3 style={{ color: "#0F172A" }} className="text-base font-semibold mt-3">{contact.name}</h3>
      {contact.title && (
        <p style={{ color: "#0077B6" }} className="text-sm font-medium">{contact.title}</p>
      )}
      <p style={{ color: "#94A3B8" }} className="text-xs">{contact.funderName}</p>
    </div>
  );
}
