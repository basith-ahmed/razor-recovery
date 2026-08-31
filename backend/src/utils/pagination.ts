export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Parses and sanitizes standard page and limit query parameters.
 */
export function parsePagination(
  query: Record<string, unknown>,
  defaultLimit = 20,
  maxLimit = 100,
): PaginationParams {
  const page = Math.max(1, parseInt(String(query.page || "1"), 10) || 1);
  const limit = Math.max(1, Math.min(maxLimit, parseInt(String(query.limit || defaultLimit), 10) || defaultLimit));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * Formats a clean, standard paginated response envelope.
 */
export function paginatedResponse<T>(
  items: T[],
  total: number,
  params: PaginationParams,
): PaginatedResult<T> {
  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit) || 1,
  };
}
