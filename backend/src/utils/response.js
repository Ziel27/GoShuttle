/**
 * Standardized API Response Utilities
 * Ensures consistent response format across all endpoints
 */

/**
 * Parse and validate pagination parameters
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {{skip: number, limit: number, page: number}}
 */
const parsePagination = (page = 1, limit = 20) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20)); // Max 100 per page
  const skip = (pageNum - 1) * limitNum;

  return { page: pageNum, limit: limitNum, skip };
};

/**
 * Format paginated response
 * @param {Array} data - Result items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total count
 * @returns {object} Paginated response object
 */
const formatPaginatedResponse = (data, page, limit, total) => {
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage,
      hasPrevPage,
    },
  };
};

/**
 * Standardized error response
 * @param {number} statusCode - HTTP status code
 * @param {string} error - Error message
 * @returns {object} Error response
 */
const errorResponse = (statusCode, error) => {
  return {
    status: 'error',
    statusCode,
    error,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Standardized success response
 * @param {*} data - Response data
 * @param {string} message - Success message
 * @returns {object} Success response
 */
const successResponse = (data, message = 'Success') => {
  return {
    status: 'success',
    message,
    data,
    timestamp: new Date().toISOString(),
  };
};

module.exports = {
  parsePagination,
  formatPaginatedResponse,
  errorResponse,
  successResponse,
};
