import { withErrorBoundary } from '@grafana/ui';

const OodleAlertsCreate = () => {
  if (window.parent) {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('query');
    const url = query
      ? `/alerts/create?query=${encodeURIComponent(query)}`
      : '/alerts/create';
    window.parent.location.href = url;
  }
  return null;
};

export default withErrorBoundary(OodleAlertsCreate, { style: 'page' });
