export type QlooParams = Record<string, string>;

export interface QlooEntity {
  entity_id: string;
  name: string;
  subtype?: string;
  types?: string[];
  popularity?: number;
  disambiguation?: string;
  properties?: Record<string, unknown>;
  query?: {
    affinity?: number;
    explainability?: { 'signal.interests.entities'?: { entity_id: string; score: number }[] };
  };
  tags?: { id: string; name: string; type?: string }[];
  location?: unknown;
}

export interface QlooTag {
  tag_id: string;
  name: string;
  subtype?: string;
  type?: string;
  query?: { affinity?: number };
}

export interface DemographicsRow {
  entity_id: string;
  query: { age: Record<AgeBucket, number>; gender: { male: number; female: number } };
}

export const AGE_BUCKETS = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export interface QlooResponse {
  success?: boolean;
  results?: {
    entities?: QlooEntity[];
    tags?: QlooTag[];
    demographics?: DemographicsRow[];
  } | QlooEntity[];
  errors?: unknown;
}

export interface QlooCallRecord {
  at: string;
  tag: string;
  path: string;
  status: number;
  latency_ms: number;
  cached: boolean;
}
