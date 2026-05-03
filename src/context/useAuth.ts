// src/context/useAuth.ts
import { useContext } from 'react';
import { AuthContext } from './AuthContext';
import type { AuthContextType } from './authTypes';

/**
 * Hook for accessing authentication context.
 * Ensures safe usage within an <AuthProvider>.
 *
 * Example:
 *   const { user, loading, refreshUser, logout, isPro } = useAuth();
 */
export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }

  return ctx;
};

export default useAuth;


