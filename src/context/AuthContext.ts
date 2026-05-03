// src/context/AuthContext.ts
import { createContext } from 'react';
import type { AuthContextType } from './authTypes';

// No default value — consumers MUST be inside <AuthProvider>
export const AuthContext = createContext<AuthContextType | undefined>(undefined);


