// TopNav.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useReminderBadge } from './ReminderBadgeContext';
import { useAuth } from '../context/useAuth';

interface TopNavProps {
  showWhenAnon?: boolean;
}

const barStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  top: 0,
  backgroundColor: '#174b4b',
  paddingLeft: 10,
  paddingRight: 10,

  // ⬇️ Push content below the notch/status bar
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 52px)',

  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
  zIndex: 10000,

  // Keep overall height consistent with your pages’ paddingTop (96px)
  minHeight: 'calc(var(--top-nav-height, 96px) + env(safe-area-inset-top, 0px))',
};


const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: '10px',
  width: '100%',
  marginTop: 0, // no extra nudge needed once we pad above
  whiteSpace: 'nowrap',
  overflowX: 'auto',
  overflowY: 'hidden',
  WebkitOverflowScrolling: 'touch',
  scrollbarWidth: 'none',
};


const linkStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'white',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  flex: '0 0 auto',
};

const badgeStyle: React.CSSProperties = {
  marginLeft: '0.35rem',
  backgroundColor: 'red',
  color: 'white',
  borderRadius: '9px',
  padding: '0 5px',
  fontSize: '0.7rem',
  lineHeight: 1.45,
  minWidth: 16,
  textAlign: 'center',
};

const TopNav: React.FC<TopNavProps> = ({ showWhenAnon = true }) => {
  const { user } = useAuth();
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
        {user ? (
          <>
            <Link to="/coach" style={linkStyle}>Coach</Link>
            <Link to="/today" style={linkStyle}>Today</Link>
            <Link to="/profile" style={linkStyle}>Profile</Link>
            <Link to="/protocols" style={linkStyle}>Protocols</Link>
            <Link to="/personalplan" style={linkStyle}>Plan</Link>
            <Link to="/healthtracker" style={linkStyle}>Tracker</Link>
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
