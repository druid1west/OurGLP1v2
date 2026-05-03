import React from 'react';
import type { RouteProps } from 'react-router-dom';
interface PrivateRouteProps extends RouteProps {
    component: React.ComponentType<Record<string, unknown>>;
}
declare const PrivateRoute: React.FC<PrivateRouteProps>;
export default PrivateRoute;
