// src/pages/PrivateRoute.tsx
import React, { useEffect, useState } from 'react';
import { Route, Redirect } from 'react-router-dom';
import type { RouteProps } from 'react-router-dom';
import { IonSpinner } from '@ionic/react';
import { useAuth } from '../context/useAuth';

interface PrivateRouteProps extends RouteProps {
  component: React.ComponentType<Record<string, unknown>>;
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({ component: Component, ...rest }) => {
  const { user, loading, refreshUser } = useAuth();
  const [requestedRefresh, setRequestedRefresh] = useState<boolean>(false);

  // One-time attempt to restore session if we have no user and not currently loading
  useEffect(() => {
    if (!user && !loading && !requestedRefresh) {
      setRequestedRefresh(true);
      void refreshUser();
    }
  }, [user, loading, requestedRefresh, refreshUser]);

  // While auth is loading OR we've requested a refresh, show a blocking spinner
  if (loading || (!user && requestedRefresh)) {
    return (
      <div style={{ textAlign: 'center', marginTop: '3rem' }}>
        <IonSpinner name="crescent" />
        <p>Checking login status…</p>
      </div>
    );
  }

  // Authenticated → render protected route
  if (user) {
    return (
      <Route
        {...rest}
        render={(props) => <Component {...props} />}
      />
    );
  }

  // Not authenticated → redirect to login
  return <Redirect to="/login" />;
};

export default PrivateRoute;
