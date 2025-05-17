/**
 * Local storage utility functions
 */

// Keys
const MOCK_USER_ID_KEY = 'mock_user_id';

/**
 * Initialize mock user ID for development
 */
export const initMockUser = (): void => {
  // Check if we have a mock user ID already
  if (!localStorage.getItem(MOCK_USER_ID_KEY)) {
    localStorage.setItem(MOCK_USER_ID_KEY, 'user123');
  }
};

/**
 * Get the current mock user ID
 */
export const getMockUserId = (): string => {
  return localStorage.getItem(MOCK_USER_ID_KEY) || 'user123';
};

/**
 * Set a new mock user ID
 */
export const setMockUserId = (userId: string): void => {
  localStorage.setItem(MOCK_USER_ID_KEY, userId);
};