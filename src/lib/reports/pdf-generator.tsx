import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

import type {
  BoardReportData,
  PipelineStage,
  FinancialItem,
  AgentActivityItem,
} from "./board-report";

export interface AISections {
  executiveSummary: string;
  pipelineStatus: string;
  submissionActivity: string;
  awardsAndFunding: string;
  agentPerformance: string;
  financialOverview: string;
  recommendations: string;
}

const TEAL = "#0d9488";
const NAVY = "#0f172a";
const SLATE = "#475569";
const LIGHT_BG = "#f8fafc";
const BORDER = "#e2e8f0";
const WHITE = "#ffffff";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: NAVY,
    paddingTop: 48,
    paddingBottom: 60,
    paddingHorizontal: 48,
    backgroundColor: WHITE,
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: TEAL,
  },
  orgName: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
  },
  reportTitle: {
    fontSize: 12,
    color: SLATE,
    marginTop: 2,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  dateRange: {
    fontSize: 9,
    color: SLATE,
  },
  generatedLabel: {
    fontSize: 8,
    color: SLATE,
    marginTop: 2,
  },
  // Section heading
  sectionHeading: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    marginTop: 20,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  // Body text
  bodyText: {
    fontSize: 10,
    color: NAVY,
    lineHeight: 1.6,
    marginBottom: 6,
  },
  // KPI row
  kpiRow: {
    flexDirection: "row",
    marginBottom: 12,
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: LIGHT_BG,
    borderRadius: 4,
    padding: 10,
    alignItems: "center",
  },
  kpiValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
  },
  kpiLabel: {
    fontSize: 8,
    color: SLATE,
    marginTop: 2,
    textAlign: "center",
  },
  // Tables
  table: {
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: TEAL,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: WHITE,
    flex: 1,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tableRowAlt: {
    backgroundColor: LIGHT_BG,
  },
  tableCell: {
    fontSize: 9,
    color: NAVY,
    flex: 1,
  },
  tableCellRight: {
    fontSize: 9,
    color: NAVY,
    flex: 1,
    textAlign: "right",
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 6,
  },
  footerText: {
    fontSize: 8,
    color: SLATE,
  },
  confidential: {
    fontSize: 8,
    color: SLATE,
    fontFamily: "Helvetica-Oblique",
  },
});

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

function humanizeLabel(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// --- Sub-components ---

function SectionHeading({ title }: { title: string }) {
  return <Text style={styles.sectionHeading}>{title}</Text>;
}

function BodyParagraph({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <Text key={i} style={styles.bodyText}>
          {p.trim()}
        </Text>
      ))}
    </>
  );
}

function KpiRow({ data }: { data: BoardReportData }) {
  const { executive } = data;
  const winRate =
    executive.awards + executive.denials > 0
      ? Math.round(
          (executive.awards / (executive.awards + executive.denials)) * 100,
        )
      : 0;

  const kpis = [
    { value: String(executive.totalOpportunities), label: "Total Opportunities" },
    { value: String(executive.applicationsSubmitted), label: "Applications Submitted" },
    { value: formatCurrency(executive.totalRequested), label: "Total Requested" },
    { value: formatCurrency(executive.totalAwarded), label: "Total Awarded" },
    { value: `${winRate}%`, label: "Win Rate" },
    {
      value: String(executive.awards),
      label: `Awards / ${executive.denials} Denials`,
    },
  ];

  return (
    <View style={styles.kpiRow}>
      {kpis.map((k, i) => (
        <View key={i} style={styles.kpiCard}>
          <Text style={styles.kpiValue}>{k.value}</Text>
          <Text style={styles.kpiLabel}>{k.label}</Text>
        </View>
      ))}
    </View>
  );
}

function PipelineTable({ pipeline }: { pipeline: PipelineStage[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Stage</Text>
        <Text style={[styles.tableHeaderCell, { textAlign: "right" }]}>
          Applications
        </Text>
      </View>
      {pipeline.map((row, i) => (
        <View
          key={row.stage}
          style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}
        >
          <Text style={[styles.tableCell, { flex: 2 }]}>
            {humanizeLabel(row.stage)}
          </Text>
          <Text style={styles.tableCellRight}>{row.count}</Text>
        </View>
      ))}
    </View>
  );
}

function FinancialTable({ financial }: { financial: FinancialItem[] }) {
  const totals = financial.reduce(
    (acc, r) => ({
      requested: acc.requested + r.requested,
      awarded: acc.awarded + r.awarded,
    }),
    { requested: 0, awarded: 0 },
  );

  return (
    <View style={styles.table}>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Category</Text>
        <Text style={[styles.tableHeaderCell, { textAlign: "right" }]}>
          Requested
        </Text>
        <Text style={[styles.tableHeaderCell, { textAlign: "right" }]}>
          Awarded
        </Text>
        <Text style={[styles.tableHeaderCell, { textAlign: "right" }]}>
          Rate
        </Text>
      </View>
      {financial.map((row, i) => {
        const rate =
          row.requested > 0
            ? Math.round((row.awarded / row.requested) * 100)
            : 0;
        return (
          <View
            key={row.category}
            style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}
          >
            <Text style={[styles.tableCell, { flex: 2 }]}>
              {humanizeLabel(row.category)}
            </Text>
            <Text style={styles.tableCellRight}>
              {formatCurrency(row.requested)}
            </Text>
            <Text style={styles.tableCellRight}>
              {formatCurrency(row.awarded)}
            </Text>
            <Text style={styles.tableCellRight}>{rate}%</Text>
          </View>
        );
      })}
      <View style={[styles.tableRow, { backgroundColor: "#e0f2fe" }]}>
        <Text
          style={[
            styles.tableCell,
            { flex: 2, fontFamily: "Helvetica-Bold" },
          ]}
        >
          Total
        </Text>
        <Text style={[styles.tableCellRight, { fontFamily: "Helvetica-Bold" }]}>
          {formatCurrency(totals.requested)}
        </Text>
        <Text style={[styles.tableCellRight, { fontFamily: "Helvetica-Bold" }]}>
          {formatCurrency(totals.awarded)}
        </Text>
        <Text style={[styles.tableCellRight, { fontFamily: "Helvetica-Bold" }]}>
          {totals.requested > 0
            ? `${Math.round((totals.awarded / totals.requested) * 100)}%`
            : "-"}
        </Text>
      </View>
    </View>
  );
}

function AgentTable({ agentActivity }: { agentActivity: AgentActivityItem[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Agent Type</Text>
        <Text style={[styles.tableHeaderCell, { textAlign: "right" }]}>Runs</Text>
        <Text style={[styles.tableHeaderCell, { textAlign: "right" }]}>
          Success Rate
        </Text>
      </View>
      {agentActivity.map((row, i) => (
        <View
          key={row.agentType}
          style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}
        >
          <Text style={[styles.tableCell, { flex: 2 }]}>
            {humanizeLabel(row.agentType)}
          </Text>
          <Text style={styles.tableCellRight}>{row.runs}</Text>
          <Text style={styles.tableCellRight}>{row.successRate}%</Text>
        </View>
      ))}
    </View>
  );
}

function Footer({
  orgName,
  generatedAt,
}: {
  orgName: string;
  generatedAt: string;
}) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        {orgName} - Board Report - {generatedAt}
      </Text>
      <Text style={styles.confidential}>Confidential</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}

// --- Main PDF Document ---

function BoardReportDocument({
  data,
  sections,
  generatedAt,
}: {
  data: BoardReportData;
  sections: AISections;
  generatedAt: string;
}) {
  const { organization, dateRange } = data;
  const dateLabel = `${formatDate(dateRange.start)} - ${formatDate(dateRange.end)}`;

  return (
    <Document
      title={`Board Report - ${organization.name}`}
      author={organization.name}
      subject="Grant Management Board Report"
    >
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.orgName}>{organization.name}</Text>
            <Text style={styles.reportTitle}>Board Report</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.dateRange}>{dateLabel}</Text>
            <Text style={styles.generatedLabel}>Generated {generatedAt}</Text>
            {organization.ein && (
              <Text style={styles.generatedLabel}>
                EIN: {organization.ein}
              </Text>
            )}
          </View>
        </View>

        {/* KPI Summary Bar */}
        <KpiRow data={data} />

        {/* Executive Summary */}
        <SectionHeading title="Executive Summary" />
        <BodyParagraph text={sections.executiveSummary} />

        {/* Pipeline Status */}
        <SectionHeading title="Pipeline Status" />
        <BodyParagraph text={sections.pipelineStatus} />
        {data.pipeline.length > 0 && (
          <PipelineTable pipeline={data.pipeline} />
        )}

        {/* Submission Activity */}
        <SectionHeading title="Submission Activity" />
        <BodyParagraph text={sections.submissionActivity} />

        {/* Awards and Funding */}
        <SectionHeading title="Awards and Funding" />
        <BodyParagraph text={sections.awardsAndFunding} />

        {/* Agent Performance */}
        <SectionHeading title="Agent Performance" />
        <BodyParagraph text={sections.agentPerformance} />
        {data.agentActivity.length > 0 && (
          <AgentTable agentActivity={data.agentActivity} />
        )}

        {/* Financial Overview */}
        <SectionHeading title="Financial Overview" />
        <BodyParagraph text={sections.financialOverview} />
        {data.financial.length > 0 && (
          <FinancialTable financial={data.financial} />
        )}

        {/* Recommendations */}
        <SectionHeading title="Recommendations" />
        <BodyParagraph text={sections.recommendations} />

        {/* Footer */}
        <Footer orgName={organization.name} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

export async function generateBoardReportPDF(
  data: BoardReportData,
  sections: AISections,
  generatedAt: string,
): Promise<Buffer> {
  const element = React.createElement(BoardReportDocument, {
    data,
    sections,
    generatedAt,
  });
  const buffer = await renderToBuffer(element as React.ReactElement);
  return Buffer.from(buffer);
}
