// BottomNav.tsx
import React from 'react';
import { Link, useHistory } from 'react-router-dom';
import { useIonRouter, type RouterDirection } from '@ionic/react';
import { useAuth } from '../context/useAuth';

interface BottomNavProps {
  showWhenAnon?: boolean;
}

const barStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  minHeight: 'var(--bottom-nav-height, 88px)',
  background: '#174b4b',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 12px',
  boxShadow: '0 -2px 10px rgba(0,0,0,0.15)',
  zIndex: 10000,
};

const rowStyle: React.CSSProperties = {
  fontSize: '13px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.85rem',
  marginTop: 0,
  flexWrap: 'wrap', // helps on smaller screens
};

const linkStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'white',
  textDecoration: 'none',
  opacity: 0.95,
};

const btnStyle: React.CSSProperties = {
  ...linkStyle,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
};

const BottomNav: React.FC<BottomNavProps> = ({ showWhenAnon = true }) => {
  const { user, isPro, logout } = useAuth();
  const ion = useIonRouter();
  const history = useHistory();

  type NavDirection = Extract<RouterDirection, 'forward' | 'back' | 'root' | 'none'>;

  const navigateTo = React.useCallback(
    (path: string, replace = false): void => {
      const dir: NavDirection = replace ? 'root' : 'forward';
      ion.push(path, dir);
      if (replace) {
        history.replace(path);
      } else {
        history.push(path);
      }
    },
    [ion, history]
  );

  const handleLogout = async (): Promise<void> => {
    try {
      await logout();
    } finally {
      navigateTo('/login', true);
    }
  };

  return (
    <nav
      id="bottomNav"
      style={barStyle}
      role="navigation"
      aria-label="Bottom navigation"
    >
      <div style={rowStyle}>
        {!user && showWhenAnon && (
          <>
            <Link to="/privacy" style={linkStyle} aria-label="Privacy Policy">Privacy</Link>
            <Link to="/support" style={linkStyle} aria-label="Support">Support</Link>
            <Link to="/terms" style={linkStyle} aria-label="Terms of Service">Terms</Link>
            <Link to="/paywall" style={linkStyle} aria-label="Subscribe to Pro">Subscribe</Link>
            <Link to="/deepdive" style={linkStyle} aria-label="About OurGLP1">About</Link>
          </>
        )}

        {user && (
          <>
            <Link to="/today" style={linkStyle} aria-label="Today">Today</Link>
            <Link to="/coach" style={linkStyle} aria-label="GLP-1 Coach">Coach</Link>
            <Link to="/protocols" style={linkStyle} aria-label="Protocols">Protocols</Link>
            <Link to="/settings" style={linkStyle} aria-label="Settings">Settings</Link>
            <Link to="/weeklysummary" style={linkStyle} aria-label="Weekly Summary">Summary</Link>
            {!isPro && (
              <Link to="/paywall" style={linkStyle} aria-label="Subscribe to Pro">Go Pro</Link>
            )}
            <Link to="/support" style={linkStyle} aria-label="Support">Support</Link>
            <Link to="/resetpassword" style={linkStyle} aria-label="Password Reset">Password<br /> Reset</Link>
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
