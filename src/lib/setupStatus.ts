import type { User } from '../context/authTypes';
import { hasCompletePrimaryProtocol, getPrimaryProtocol, type Protocol } from '../db/ProtocolRepository';

export type SetupStatus = {
  hasAccount: boolean;
  hasPrimaryProtocol: boolean;
  primaryProtocol: Protocol | null;
  complete: boolean;
  nextStep: 'account' | 'protocol' | 'complete';
};

export function hasRealLocalAccount(user: User | null | undefined): boolean {
  return Boolean(user?.id && user.email && !user.email.endsWith('@local.ourglp1'));
}

export async function getSetupStatus(user: User | null | undefined): Promise<SetupStatus> {
  const hasAccount = hasRealLocalAccount(user);
  if (!hasAccount || !user?.id) {
    return {
      hasAccount: false,
      hasPrimaryProtocol: false,
      primaryProtocol: null,
      complete: false,
      nextStep: 'account',
    };
  }

  const [primaryProtocol, completePrimaryProtocol] = await Promise.all([
    getPrimaryProtocol(user.id),
    hasCompletePrimaryProtocol(user.id),
  ]);

  return {
    hasAccount: true,
    hasPrimaryProtocol: completePrimaryProtocol,
    primaryProtocol,
    complete: completePrimaryProtocol,
    nextStep: completePrimaryProtocol ? 'complete' : 'protocol',
  };
}
