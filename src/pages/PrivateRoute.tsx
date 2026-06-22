// src/pages/PrivateRoute.tsx
import React, { useEffect, useState } from 'react';
import { Route, Redirect, type RouteProps } from 'react-router-dom';
import { IonSpinner } from '@ionic/react';
import { useAuth } from '../context/useAuth';

interface PrivateRouteProps extends RouteProps {
  component: React.ComponentType<Record<string, unknown>>;
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({ component: Component, ...rest }) => {
  const { user, loading, refreshUser } = useAuth();
  const [requestedRefresh, setRequestedRefresh] = useState<boolean>(false);

  useEffect(() => {
    if (!user && !loading && !requestedRefresh) {
      setRequestedRefresh(true);
      void refreshUser();
    }
  }, [user, loading, requestedRefresh, refreshUser]);

  if (loading || (!user && requestedRefresh)) {
    return (
      <div className="pr-loadingCenter" role="status" aria-live="polite">
        <IonSpinner name="crescent" />
        <p>Checking login status...</p>
      </div>
    );
  }

  if (user) {
    return (
      <Route
        {...rest}
        render={(props) => <Component {...props} />}
      />
    );
  }

  return <Redirect to="/login" />;
};

export default PrivateRoute;
