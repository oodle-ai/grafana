import { withErrorBoundary } from '@grafana/ui';

const FORWARDED_PARAMS = ['query', 'labels'];

const OodleAlertsCreate = () => {
  if (window.parent) {
    const source = new URLSearchParams(window.location.search);
    const target = new URLSearchParams();
    for (const key of FORWARDED_PARAMS) {
      const value = source.get(key);
      if (value) {
        target.set(key, value);
      }
    }
    const qs = target.toString();
    window.parent.location.href = qs ? `/alerts/create?${qs}` : '/alerts/create';
  }
  return null;
};

export default withErrorBoundary(OodleAlertsCreate, { style: 'page' });
