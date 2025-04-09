import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

interface AuthState {
  isAuthenticated: boolean;
  user: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    isLoading: true,
    error: null
  });

  // Verify if the user is already authenticated
  const checkAuth = useCallback(async () => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await axios.get('/api/auth/verify');
      
      if (response.data.authenticated) {
        setAuthState({
          isAuthenticated: true,
          user: response.data.user,
          isLoading: false,
          error: null
        });
      } else {
        setAuthState({
          isAuthenticated: false,
          user: null,
          isLoading: false,
          error: null
        });
      }
    } catch (error) {
      setAuthState({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: 'Authentication failed'
      });
    }
  }, []);

  // Request verification code
  const requestCode = useCallback(async (email: string) => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await axios.post('/api/auth/request-code', { email });
      
      setAuthState(prev => ({ 
        ...prev, 
        isLoading: false,
        error: null
      }));
      
      return response.data;
    } catch (error) {
      let errorMessage = 'Failed to request verification code';
      
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        errorMessage = error.response.data.error;
      }
      
      setAuthState(prev => ({ 
        ...prev, 
        isLoading: false,
        error: errorMessage
      }));
      
      throw new Error(errorMessage);
    }
  }, []);

  // Verify code and sign in
  const verifyCode = useCallback(async (email: string, code: string) => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await axios.post('/api/auth/verify-code', { email, code });
      
      setAuthState({
        isAuthenticated: true,
        user: email,
        isLoading: false,
        error: null
      });
      
      // Store token if needed (for WebSocket)
      if (response.data.token) {
        localStorage.setItem('ws_token', response.data.token);
      }
      
      return response.data;
    } catch (error) {
      let errorMessage = 'Failed to verify code';
      
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        errorMessage = error.response.data.error;
      }
      
      setAuthState(prev => ({ 
        ...prev, 
        isLoading: false,
        error: errorMessage
      }));
      
      throw new Error(errorMessage);
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    setAuthState(prev => ({ ...prev, isLoading: true }));
    
    try {
      await axios.post('/api/auth/logout');
      
      // Remove token if stored
      localStorage.removeItem('ws_token');
      
      setAuthState({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: null
      });
    } catch (error) {
      setAuthState(prev => ({ 
        ...prev, 
        isLoading: false,
        error: 'Failed to logout'
      }));
    }
  }, []);

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return {
    ...authState,
    requestCode,
    verifyCode,
    logout,
    refreshAuth: checkAuth
  };
}