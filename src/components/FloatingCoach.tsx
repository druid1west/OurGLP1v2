import React, { useMemo, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { MessageCircleHeart, UserRound, X } from 'lucide-react';
import { useAuth } from '@/context/useAuth';
import styles from './FloatingCoach.module.css';

type CoachPrompt = Readonly<{
  text: string;
  actionLabel: string;
  actionPath: string;
}>;

function useCoachPrompt(): CoachPrompt | null {
  const { pathname } = useLocation();
  const { user, isPro } = useAuth();

  return useMemo(() => {
    if (pathname === '/login' || pathname === '/register' || pathname === '/paywall') {
      return null;
    }

    if (pathname === '/coach') {
      return {
        text: user?.id ? 'Need a tiny check-in?' : 'Let’s set up your GLP-1 support profile.',
        actionLabel: user?.id ? 'Check in' : 'Start setup',
        actionPath: '/coach',
      };
    }

    if (pathname === '/profile') {
      return {
        text: 'Check your details and add a photo when you’re ready.',
        actionLabel: 'Review profile',
        actionPath: '/profile',
      };
    }

    if (pathname === '/today') {
      return {
        text: isPro ? 'Your rhythm is building.' : 'Free setup first. Pro adds deeper reviews later.',
        actionLabel: isPro ? 'Ask Coach' : 'See Coach',
        actionPath: '/coach',
      };
    }

    return {
      text: 'One rough day changes nothing.',
      actionLabel: 'Ask Coach',
      actionPath: '/coach',
    };
  }, [isPro, pathname, user?.id]);
}

const FloatingCoach: React.FC = () => {
  const history = useHistory();
  const { isPro } = useAuth();
  const prompt = useCoachPrompt();
  const [bubbleOpen, setBubbleOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!prompt) return null;

  const go = (path: string): void => {
    setMenuOpen(false);
    setBubbleOpen(false);
    history.push(path);
  };

  return (
    <div className={styles.coachWrap} aria-label="Floating coach assistant">
      {bubbleOpen && (
        <div className={styles.bubble} role="status">
          <button
            type="button"
            className={styles.closeBubble}
            onClick={() => setBubbleOpen(false)}
            aria-label="Close coach tip"
          >
            <X size={13} />
          </button>
          <p>{prompt.text}</p>
          <button type="button" onClick={() => go(prompt.actionPath)}>
            {prompt.actionLabel}
          </button>
        </div>
      )}

      {menuOpen && (
        <div className={styles.menu} role="menu">
          <button type="button" role="menuitem" onClick={() => go('/coach')}>
            <MessageCircleHeart size={16} />
            Ask Coach
          </button>
          <button type="button" role="menuitem" onClick={() => go('/profile')}>
            <UserRound size={16} />
            Review profile
          </button>
          {!isPro && (
            <button type="button" role="menuitem" onClick={() => go('/coach')}>
              <MessageCircleHeart size={16} />
              Finish setup
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        className={styles.avatarButton}
        onClick={() => {
          setMenuOpen((open) => !open);
          if (!bubbleOpen) setBubbleOpen(true);
        }}
        aria-label="Open Coach assistant"
        aria-expanded={menuOpen}
      >
        <img src="/assets/coach/coach-avatar.png" alt="" />
      </button>
    </div>
  );
};

export default FloatingCoach;
