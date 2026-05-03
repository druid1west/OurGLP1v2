import React from 'react';
import { verifyIdentity } from '../utils/biometric';

const BiometricTestButton: React.FC = () => {
  const handleVerify = async () => {
    const success = await verifyIdentity({ reason: 'Confirm your identity to continue' });
    if (success) {
      alert('Authentication succeeded!');
    } else {
      alert('Authentication failed or was canceled.');
    }
  };

  return (
    <button onClick={handleVerify} style={{ padding: '12px 24px', fontSize: '16px', cursor: 'pointer' }}>
      Test Biometric Authentication
    </button>
  );
};

export default BiometricTestButton;

