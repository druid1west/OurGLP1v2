// BottomNav.tsx
import React from 'react';
import { Link } from 'react-router-dom';
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
  fontSize: '14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '1rem',
  marginTop: 0,
  flexWrap: 'wrap', // helps on smaller screens
};

const linkStyle: React.CSSProperties = {
  fontSize: '14px',
  color: 'white',
  textDecoration: 'none',
  opacity: 0.95,
};

const BottomNav: React.FC<BottomNavProps> = ({ showWhenAnon = true }) => {
  const { user, isPro } = useAuth();

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
            <Link to="/protocols" style={linkStyle} aria-label="Protocols">Protocols</Link>
            <Link to="/settings" style={linkStyle} aria-label="Settings">Settings</Link>
            <Link to="/weeklysummary" style={linkStyle} aria-label="Weekly Summary">Summary</Link>
            {!isPro && (
              <Link to="/paywall" style={linkStyle} aria-label="Subscribe to Pro">Go Pro</Link>
            )}
            <Link to="/support" style={linkStyle} aria-label="Support">Support</Link>
            <Link to="/resetpassword" style={linkStyle} aria-label="Password Reset">Password<br /> Reset</Link>
          </>
        )}
      </div>
    </nav>
  );
};

export default BottomNav;
