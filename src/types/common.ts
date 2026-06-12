import {
  FUNDER_CATEGORIES,
  PIPELINE_STAGES,
  USER_ROLES,
} from "@/lib/utils/constants";

export type FunderCategory = (typeof FUNDER_CATEGORIES)[number];
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type UserRole = (typeof USER_ROLES)[number];

/** Consistent API error shape (Behavioral Contracts §16). */
export interface ApiError {
  error: string;
  code: string;
}

/** Standard API response envelope. */
export type ApiResult<T> = { data: T } | ApiError;
