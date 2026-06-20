// NIH Reporter funded application ingestion pipeline.
// Full implementation scheduled for Night 1 data ingestion run (GRANT_INTELLIGENCE_ARCHITECTURE.md §6).
// This stub satisfies the API route import and will be replaced with the full pipeline.

export interface NihIngestionResult {
  success: boolean
  proposal_id: string
  sections_extracted: number
  message?: string
}

export async function ingestNihProposals(): Promise<NihIngestionResult> {
  return {
    success: true,
    proposal_id: '',
    sections_extracted: 0,
    message: 'NIH ingestion pipeline not yet implemented. Full pipeline builds on Night 1.',
  }
}
