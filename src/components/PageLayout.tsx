// src/components/PageLayout.tsx
import React from 'react';
import { IonPage, IonContent } from '@ionic/react';
import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';

interface PageLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  showNav?: boolean;
  transparent?: boolean;
  /**
   * If true (default) PageLayout renders as a simple wrapper <div>.
   * If false, it renders a full Ionic page (<IonPage>/<IonContent>) and navs.
   * Use embedded=true when placing PageLayout *inside* an existing IonPage/IonContent (like Home).
   */
  embedded?: boolean;
}

const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  showNav = true,
  transparent = false,
  embedded = true, // default: embedded for use inside pages
  className,
  style,
  ...rest
}) => {
  const topNavHeight = 96;
  const bottomNavHeight = 72;

  const contentStyle = {
    '--padding-top': showNav ? `${topNavHeight}px` : '0',
    '--padding-bottom': showNav ? `${bottomNavHeight}px` : '0',
    ...(transparent ? { background: 'transparent' } : {}),
    ...style,
  } as React.CSSProperties;

  const classNames = `${className ?? ''}`.trim();

  if (embedded) {
    return (
      <div className={classNames} style={contentStyle} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <IonPage {...rest} className={className}>
      {showNav && <TopNav showWhenAnon={false} />}
      <IonContent style={contentStyle}>
        {children}
      </IonContent>
      {showNav && <BottomNav />}
    </IonPage>
  );
};

export default PageLayout;

