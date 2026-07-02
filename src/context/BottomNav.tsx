// BottomNav.tsx
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useIonRouter, type RouterDirection } from '@ionic/react';
import { useAuth } from '../context/useAuth';
import { getLatestEmailPasswordAccount } from '../db/LocalAccountRepository';

interface BottomNavProps {
  showWhenAnon?: boolean;
  setupOnly?: boolean;
}

const barStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  minHeight: 'var(--bottom-nav-height, 88px)',
  background: '#2563eb',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 12px',
  boxShadow: '0 -2px 10px rgba(0,0,0,0.15)',
  zIndex: 10000,
};

const baseRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: 0,
  flexWrap: 'wrap', // helps on smaller screens
};

const baseLinkStyle: React.CSSProperties = {
  color: 'white',
  textDecoration: 'none',
  opacity: 0.95,
  lineHeight: 1.15,
};

const BottomNav: React.FC<BottomNavProps> = ({ showWhenAnon = true, setupOnly = false }) => {
  const { user, isPro, logout } = useAuth();
  const ion = useIonRouter();
  const location = useLocation();
  const isLoggedInNav = Boolean(user && !setupOnly);
  const isSetupNav = Boolean(setupOnly);

  const rowStyle: React.CSSProperties = {
    ...baseRowStyle,
    gap: isLoggedInNav ? 'clamp(0.48rem, 2.2vw, 0.72rem)' : 'clamp(0.8rem, 4vw, 1.25rem)',
  };

  const linkStyle: React.CSSProperties = {
    ...baseLinkStyle,
    fontSize: isLoggedInNav
      ? 'clamp(12px, 3vw, 13.5px)'
      : isSetupNav
        ? 'clamp(13.5px, 3.45vw, 15px)'
        : 'clamp(15px, 4vw, 17px)',
    fontWeight: 700,
  };

  const btnStyle: React.CSSProperties = {
    ...linkStyle,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
  };

  type NavDirection = Extract<RouterDirection, 'forward' | 'back' | 'root' | 'none'>;

  const navigateTo = React.useCallback(
    (path: string, replace = false): void => {
      const dir: NavDirection = replace ? 'root' : 'forward';
      ion.push(path, dir);
    },
    [ion]
  );

  const handleLogout = async (): Promise<void> => {
    let hasSavedLogin = false;
    try {
      hasSavedLogin = Boolean(await getLatestEmailPasswordAccount());
      await logout();
    } finally {
      navigateTo(hasSavedLogin ? '/login' : '/coach', true);
    }
  };

  const paywallHref = React.useMemo(() => {
    const current = `${location.pathname}${location.search || ''}`;
    const returnTo = current.startsWith('/paywall') ? '/today' : current;
    return `/paywall?returnTo=${encodeURIComponent(returnTo)}`;
  }, [location.pathname, location.search]);

  return (
    <nav
      id="bottomNav"
      style={barStyle}
      role="navigation"
      aria-label="Bottom navigation"
    >
      <div style={rowStyle}>
        {setupOnly && (
          <>
            <Link to="/coach" style={linkStyle} aria-label="Coach setup">Coach</Link>
            <Link to="/home" style={linkStyle} aria-label="Home">Home</Link>
            <Link to="/information" style={linkStyle} aria-label="Information">Info</Link>
            <Link to="/medical-sources" style={linkStyle} aria-label="Medical sources and citations">Sources</Link>
            <Link to="/support" style={linkStyle} aria-label="Support">Support</Link>
            <Link to="/privacy" style={linkStyle} aria-label="Privacy Policy">Privacy</Link>
            <Link to="/terms" style={linkStyle} aria-label="Terms of Service">Terms</Link>
          </>
        )}

        {!setupOnly && !user && showWhenAnon && (
          <>
            <Link to="/coach" style={linkStyle} aria-label="Coach setup">Coach</Link>
            <Link to="/privacy" style={linkStyle} aria-label="Privacy Policy">Privacy</Link>
            <Link to="/support" style={linkStyle} aria-label="Support">Support</Link>
            <Link to="/terms" style={linkStyle} aria-label="Terms of Service">Terms</Link>
            <Link to="/medical-sources" style={linkStyle} aria-label="Medical sources and citations">Sources</Link>
            <Link to="/deepdive" style={linkStyle} aria-label="About OurGLP1">About</Link>
          </>
        )}

        {!setupOnly && user && (
          <>
            <Link to="/coach" style={linkStyle} aria-label="Coach">Coach</Link>
            <Link to="/today" style={linkStyle} aria-label="Today">Today</Link>
            <Link to="/profile" style={linkStyle} aria-label="Profile">Profile</Link>
            <Link to="/settings" style={linkStyle} aria-label="Settings">Settings</Link>
            {!isPro && (
              <Link to={paywallHref} style={linkStyle} aria-label="Subscribe to Pro">Go Pro</Link>
            )}
            {isPro && (
              <Link to="/weeklysummary" style={linkStyle} aria-label="Weekly Summary">Summary</Link>
            )}
            <Link to="/support" style={linkStyle} aria-label="Support">Support</Link>
            <Link to="/medical-sources" style={linkStyle} aria-label="Medical sources and citations">Sources</Link>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Log out"
              style={btnStyle}
            >
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
};

export default BottomNav;
