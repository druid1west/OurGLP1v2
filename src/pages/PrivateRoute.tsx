// src/pages/PrivateRoute.tsx
import React, { useEffect, useState } from 'react';
import { Route, Redirect, type RouteProps } from 'react-router-dom';
import { IonSpinner } from '@ionic/react';
import { useAuth } from '../context/useAuth';
import { getSetupStatus, type SetupStatus } from '../lib/setupStatus';

interface PrivateRouteProps extends RouteProps {
  component: React.ComponentType<Record<string, unknown>>;
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({ component: Component, ...rest }) => {
  const { user, loading, refreshUser } = useAuth();
  const [requestedRefresh, setRequestedRefresh] = useState<boolean>(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupLoading, setSetupLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!user && !loading && !requestedRefresh) {
      setRequestedRefresh(true);
      void refreshUser();
    }
  }, [user, loading, requestedRefresh, refreshUser]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || loading) {
      setSetupStatus(null);
      setSetupLoading(false);
      return;
    }

    setSetupLoading(true);
    void getSetupStatus(user)
      .then((status) => {
        if (!cancelled) setSetupStatus(status);
      })
      .finally(() => {
        if (!cancelled) setSetupLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  if (loading || (!user && requestedRefresh) || setupLoading || (user && setupStatus === null)) {
    return (
      <div className="pr-loadingCenter" role="status" aria-live="polite">
        <IonSpinner name="crescent" />
        <p>Checking login status...</p>
      </div>
    );
  }

  if (user) {
    if (setupStatus && !setupStatus.complete) {
      return <Redirect to="/coach" />;
    }

    return (
      <Route
        {...rest}
        render={(props) => <Component {...props} />}
      />
    );
  }

  return <Redirect to="/coach" />;
};

export default PrivateRoute;
