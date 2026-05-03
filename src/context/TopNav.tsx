// TopNav.tsx
import React from 'react';
import { Link, useHistory } from 'react-router-dom';
import { useIonRouter, type RouterDirection } from '@ionic/react';
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
  paddingLeft: 20,
  paddingRight: 20,

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
  justifyContent: 'center',
  gap: '16px',
  width: '100%',
  marginTop: 0, // no extra nudge needed once we pad above
  whiteSpace: 'nowrap',
};


const linkStyle: React.CSSProperties = {
  fontSize: '14px',
  color: 'white',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

const btnStyle: React.CSSProperties = {
  ...linkStyle,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};

const badgeStyle: React.CSSProperties = {
  marginLeft: '0.35rem',
  backgroundColor: 'red',
  color: 'white',
  borderRadius: '11px',
  padding: '0 6px',
  fontSize: '0.85rem',
  lineHeight: 1.6,
  minWidth: 18,
  textAlign: 'center',
};

const TopNav: React.FC<TopNavProps> = ({ showWhenAnon = true }) => {
  const { user, logout } = useAuth();
  const { count, refreshCount } = useReminderBadge();
  const ion = useIonRouter();
  const history = useHistory();

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

  type NavDirection = Extract<RouterDirection, 'forward' | 'back' | 'root' | 'none'>;

  const navigateTo = React.useCallback(
    (path: string, replace = false): void => {
      const dir: NavDirection = replace ? 'root' : 'forward';
      // Reset Ionic stack (dir === 'root' clears history inside the Ionic nav stack)
      ion.push(path, dir);
      // Keep the browser URL/history consistent as well
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
      if (logout) {
        await logout();
      }
    } finally {
      navigateTo('/login', true);
    }
  };

  return (
    <nav id="topNav" className="top-nav" style={barStyle} role="navigation" aria-label="Top navigation">
      <div style={rowStyle}>
        {user ? (
          <>
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
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Log out"
              style={btnStyle}
            >
              Logout
            </button>
          </>
        ) : (
          showWhenAnon && (
            <>
              <Link to="/welcome" style={{ ...linkStyle, fontSize: '15px' }}>Welcome</Link>
              <Link to="/home" style={{ ...linkStyle, fontSize: '15px' }}>Home</Link>
              <Link to="/login" style={{ ...linkStyle, fontSize: '15px' }}>Login</Link>
              <Link to="/register" style={{ ...linkStyle, fontSize: '15px' }}>Register</Link>
              <Link to="/information" style={{ ...linkStyle, fontSize: '15px' }}>Info</Link>
              
            </>
          )
        )}
      </div>
    </nav>
  );
};

export default TopNav;


