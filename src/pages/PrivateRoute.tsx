// src/pages/PrivateRoute.tsx
import React from 'react';
import { Route, useHistory, type RouteProps } from 'react-router-dom';
import { IonSpinner, useIonRouter } from '@ionic/react';
import { useAuth } from '../context/useAuth';

interface PrivateRouteProps extends RouteProps {
  component: React.ComponentType;
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({ component: Component, ...rest }) => {
  const { user, loading } = useAuth();
  const ion = useIonRouter();
  const history = useHistory();
  const [kicked, setKicked] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user && !kicked) {
      setKicked(true);
      // 1) Try to reset Ionic stack to /login
      if (ion && typeof ion.push === 'function') {
        ion.push('/login', 'root'); // 'root' clears stack
      }
      // 2) Ensure URL actually becomes /login (works on web too)
      history.replace('/login');
    }
  }, [loading, user, kicked, ion, history]);

  return (
    <Route
      {...rest}
      render={() => {
        if (loading) {
          return (
            <div className="pr-loadingCenter" role="status" aria-live="polite">
              <IonSpinner name="crescent" />
              <p>Checking login status...</p>
            </div>
          );
        }
        if (!user) return null; // avoid render-loop while we just replaced
        return <Component />;
      }}
    />
  );
};

export default PrivateRoute;



