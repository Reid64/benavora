export interface NeedDataPoint {
  metric: string;
  value: number;
  year: number;
  geography: string;
  source: string;
  citation: string;
  category: 'poverty' | 'housing' | 'demographics' | 'health' | 'employment';
}
