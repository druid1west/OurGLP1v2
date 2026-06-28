// TopNav.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useReminderBadge } from './ReminderBadgeContext';
import { useAuth } from '../context/useAuth';

interface TopNavProps {
  showWhenAnon?: boolean;
  setupOnly?: boolean;
}

const barStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  top: 0,
  backgroundColor: '#2563eb',
  paddingLeft: 16,
  paddingRight: 16,

  // Keep links below the status bar / Dynamic Island. Some simulator/native
  // combinations report env(safe-area-inset-top) too small, so keep a real
  // fallback clearance as well.
  paddingTop: 'max(72px, calc(env(safe-area-inset-top, 0px) + 52px))',
  paddingBottom: 10,

  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
  zIndex: 10000,
  boxSizing: 'border-box',

  minHeight: 'calc(max(72px, calc(env(safe-area-inset-top, 0px) + 52px)) + 44px)',
};


const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'clamp(12px, 3.1vw, 20px)',
  width: '100%',
  minHeight: 34,
  marginTop: 0,
  whiteSpace: 'nowrap',
  overflowX: 'auto',
  overflowY: 'hidden',
  WebkitOverflowScrolling: 'touch',
  scrollbarWidth: 'none',
};


const linkStyle: React.CSSProperties = {
  fontSize: 'clamp(14px, 3.65vw, 16px)',
  lineHeight: 1.15,
  fontWeight: 700,
  color: 'white',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  flex: '0 0 auto',
};

const badgeStyle: React.CSSProperties = {
  marginLeft: '0.35rem',
  backgroundColor: '#f97373',
  color: 'white',
  borderRadius: '9px',
  padding: '0 5px',
  fontSize: '0.7rem',
  lineHeight: 1.45,
  minWidth: 16,
  textAlign: 'center',
};

const TopNav: React.FC<TopNavProps> = ({ showWhenAnon = true, setupOnly = false }) => {
  const { user, isPro } = useAuth();
  const { count, refreshCount } = useReminderBadge();

  React.useEffect(() => {
    void refreshCount();
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void refreshCount();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshCount]);

  return (
    <nav id="topNav" className="top-nav" style={barStyle} role="navigation" aria-label="Top navigation">
      <div style={rowStyle}>
        {setupOnly ? (
          <>
            <Link to="/coach" style={linkStyle}>Coach</Link>
            <Link to="/home" style={linkStyle}>Home</Link>
            <Link to="/information" style={linkStyle}>Info</Link>
            <Link to="/support" style={linkStyle}>Support</Link>
            {!user && <Link to="/login" style={linkStyle}>Login</Link>}
            {!user && <Link to="/register" style={linkStyle}>Register</Link>}
          </>
        ) : user ? (
          <>
            <Link to="/coach" style={linkStyle}>Coach</Link>
            <Link to="/today" style={linkStyle}>Today</Link>
            <Link to="/profile" style={linkStyle}>Profile</Link>
            <Link to="/healthtracker" style={linkStyle}>Tracker</Link>
            {isPro ? (
              <>
                <Link to="/protocols" style={linkStyle}>Protocols</Link>
                <Link to="/personalplan" style={linkStyle}>Plan</Link>
              </>
            ) : (
              <Link to="/paywall?returnTo=/today" style={linkStyle}>Go Pro</Link>
            )}
            <Link
              to="/reminders"
              style={linkStyle}
              aria-label={`Reminders${count > 0 ? ` (${count})` : ''}`}
            >
              Reminders
              {count > 0 && <span style={badgeStyle}>{count}</span>}
            </Link>
          </>
        ) : (
          showWhenAnon && (
            <>
              <Link to="/welcome" style={linkStyle}>Welcome</Link>
              <Link to="/home" style={linkStyle}>Home</Link>
              <Link to="/login" style={linkStyle}>Login</Link>
              <Link to="/register" style={linkStyle}>Register</Link>
              <Link to="/information" style={linkStyle}>Info</Link>
              
            </>
          )
        )}
      </div>
    </nav>
  );
};

export default TopNav;
