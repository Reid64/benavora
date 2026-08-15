// Mail-merge letter PDF (row #77, Physical Mail channel). Reuses the
// @react-pdf/renderer dependency already established by
// src/lib/reports/pdf-generator.tsx (Board Report), but is its own template —
// that file's layout is hardcoded to the board-report shape and has no
// generic letterhead+body concept to extend.

import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const NAVY = "#0f172a";
const TEAL = "#0d9488";
const SLATE = "#475569";
const BORDER = "#e2e8f0";
const WHITE = "#ffffff";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 11,
    color: NAVY,
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
    backgroundColor: WHITE,
  },
  letterhead: {
    marginBottom: 28,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: TEAL,
  },
  orgName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
  },
  orgDetail: {
    fontSize: 9,
    color: SLATE,
    marginTop: 2,
  },
  date: {
    fontSize: 10,
    color: SLATE,
    marginBottom: 20,
  },
  recipient: {
    fontSize: 10,
    color: NAVY,
    marginBottom: 20,
  },
  salutation: {
    fontSize: 11,
    color: NAVY,
    marginBottom: 12,
  },
  bodyText: {
    fontSize: 11,
    color: NAVY,
    lineHeight: 1.6,
    marginBottom: 10,
    textAlign: "justify",
  },
  signOff: {
    fontSize: 11,
    color: NAVY,
    marginTop: 20,
  },
  signature: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginTop: 28,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 56,
    right: 56,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 6,
  },
  footerText: {
    fontSize: 8,
    color: SLATE,
  },
});

export interface LetterOrgHeader {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  cityStateZip: string | null;
  phone: string | null;
  email: string | null;
}

export interface OutreachLetterInput {
  org: LetterOrgHeader;
  recipientName: string;
  recipientTitle: string | null;
  recipientOrgName: string | null;
  dateLabel: string;
  bodyParagraphs: string[];
  signerName: string;
}

function LetterDocument({ input }: { input: OutreachLetterInput }) {
  const { org, recipientName, recipientTitle, recipientOrgName, dateLabel, bodyParagraphs, signerName } = input;

  return (
    <Document title={`Letter to ${recipientName}`} author={org.name} subject="Outreach Letter">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.letterhead}>
          <Text style={styles.orgName}>{org.name}</Text>
          {org.addressLine1 && <Text style={styles.orgDetail}>{org.addressLine1}</Text>}
          {org.addressLine2 && <Text style={styles.orgDetail}>{org.addressLine2}</Text>}
          {org.cityStateZip && <Text style={styles.orgDetail}>{org.cityStateZip}</Text>}
          {(org.phone || org.email) && (
            <Text style={styles.orgDetail}>
              {[org.phone, org.email].filter(Boolean).join(" · ")}
            </Text>
          )}
        </View>

        <Text style={styles.date}>{dateLabel}</Text>

        <View style={styles.recipient}>
          <Text>{recipientName}</Text>
          {recipientTitle && <Text>{recipientTitle}</Text>}
          {recipientOrgName && <Text>{recipientOrgName}</Text>}
        </View>

        <Text style={styles.salutation}>Dear {recipientName.split(" ")[0] || recipientName},</Text>

        {bodyParagraphs.map((p, i) => (
          <Text key={i} style={styles.bodyText}>
            {p.trim()}
          </Text>
        ))}

        <Text style={styles.signOff}>Sincerely,</Text>
        <Text style={styles.signature}>{signerName}</Text>
        <Text style={styles.orgDetail}>{org.name}</Text>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {org.name} — Prepared {dateLabel} — draft for manual mailing, not sent automatically
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateOutreachLetterPDF(input: OutreachLetterInput): Promise<Buffer> {
  const element = React.createElement(LetterDocument, { input });
  const buffer = await renderToBuffer(element as React.ReactElement);
  return Buffer.from(buffer);
}
