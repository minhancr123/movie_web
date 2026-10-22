// A fixed owner binds the shared ciphertext to the server, never a viewer.
export const SHARED_TORBOX_OWNER = '__cinevn_shared_torbox__';

export const usesSharedTorbox = () => {
  const mode = (process.env.TORBOX_KEY_MODE || 'personal').trim();
  if (!['personal', 'shared'].includes(mode)) {
    const error = new Error('TORBOX_KEY_MODE phải là personal hoặc shared');
    error.status = 503;
    throw error;
  }
  return mode === 'shared';
};

export const credentialOwner = (userId, provider) =>
  provider === 'torbox' && usesSharedTorbox() ? SHARED_TORBOX_OWNER : userId;

export const canManageProvider = (user) => !usesSharedTorbox() || user?.role === 'admin';

export const publicProviderStatus = (status, user) => {
  if (!usesSharedTorbox()) return { ...status, mode: 'personal', canManage: true };
  // Viewers need availability, not the provider account identity or key fingerprint.
  return {
    connected: status.connected,
    provider: 'torbox',
    mode: 'shared',
    canManage: canManageProvider(user),
    ...(canManageProvider(user) ? { masked: status.masked, plan: status.plan } : {}),
  };
};
