/** Short, process-local cooldown for malformed/gateway-wide provider outages.
 * No account IDs, keys or URLs are retained. Ordinary missing-file errors do
 * not open this circuit; the provider is probed again after the cooldown.
 */
export const createProviderCircuit = ({ now = () => Date.now(), cooldownMs = 30000 } = {}) => {
  let until = 0;
  return {
    fail() { until = now() + cooldownMs; },
    remainingSeconds() { return Math.max(0, Math.ceil((until - now()) / 1000)); },
  };
};
