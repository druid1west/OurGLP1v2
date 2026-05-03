import React from 'react';
interface TopNavProps {
    user: {
        id: string;
        email: string;
    } | null;
    logout: () => void;
}
declare const TopNav: React.FC<TopNavProps>;
export default TopNav;
