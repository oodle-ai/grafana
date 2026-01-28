import { css } from '@emotion/css';
import { useCallback, useState } from 'react';

import { DataSourceApi, GrafanaTheme2, TimeRange } from '@grafana/data';
import { t } from '@grafana/i18n';
import { getBackendSrv } from '@grafana/runtime';
import { DataQuery } from '@grafana/schema';
import { Button, Dropdown, Icon, Menu, Tooltip, useStyles2 } from '@grafana/ui';

interface DataExplorerLinkProps {
  targets: DataQuery[] | undefined;
  dataSourcesMap: Map<string, DataSourceApi>;
  timeRange: TimeRange;
}

/**
 * Fetches index pattern ID from the .kibana index by querying through the datasource proxy.
 */
async function getIndexPatternId(datasource: DataSourceApi, indexPatternName: string): Promise<string | null> {
  try {
    // Query the .kibana index directly to find the index pattern by title
    const searchQuery = {
      query: {
        bool: {
          must: [
            { term: { type: 'index-pattern' } },
            { term: { 'index-pattern.title': indexPatternName } },
          ],
        },
      },
      size: 1,
    };

    const response = await getBackendSrv().post(
      `/api/datasources/proxy/uid/${datasource.uid}/.kibana/_search`,
      searchQuery
    );

    if (response?.hits?.hits?.length > 0) {
      const hit = response.hits.hits[0];
      // The document ID in .kibana is usually "index-pattern:<id>"
      // We need to extract just the ID part
      const docId = String(hit._id ?? '');
      if (docId.startsWith('index-pattern:')) {
        return docId.replace('index-pattern:', '');
      }
      return docId;
    }

    console.error(`Could not find index pattern ID for: ${indexPatternName}`);
    return null;
  } catch (error) {
    console.error('Failed to fetch index pattern ID from .kibana index:', error);
    return null;
  }
}

/**
 * Converts a time value to ISO8601 format for the go link URL.
 */
function toISOString(time: unknown): string {
  if (typeof time === 'number') {
    return new Date(time).toISOString();
  }
  // Handle DateTime objects (from @grafana/data)
  if (time && typeof time === 'object' && 'toISOString' in time && typeof time.toISOString === 'function') {
    return time.toISOString();
  }
  // Handle valueOf for DateTime
  if (time && typeof time === 'object' && 'valueOf' in time && typeof time.valueOf === 'function') {
    const ms = time.valueOf();
    if (typeof ms === 'number') {
      return new Date(ms).toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Constructs the go link URL for the Logs Explorer.
 * Uses /go/logs with query parameters: indexPatternID, start, end, query
 */
function buildDataExplorerUrl(indexPatternId: string, luceneQuery: string, timeRange: TimeRange): string {
  const params = new URLSearchParams();

  // Add index pattern ID
  params.set('indexPatternID', indexPatternId);

  // Add time range as ISO8601 timestamps
  params.set('start', toISOString(timeRange.from));
  params.set('end', toISOString(timeRange.to));

  // Add Lucene query if present
  if (luceneQuery && luceneQuery !== '*') {
    params.set('query', luceneQuery);
  }

  return `/go/logs?${params.toString()}`;
}

/**
 * Gets the index pattern name from the datasource.
 * For Elasticsearch datasources, this is stored in the 'index' property.
 */
export function getIndexPatternName(datasource: DataSourceApi): string | null {
  // Access the index property which contains the index pattern name
  // This is available on Elasticsearch and similar datasources
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const ds = datasource as { index?: string };
  return ds.index ?? null;
}

/**
 * Gets the Lucene query from the target.
 * For Elasticsearch queries, this is stored in the 'query' property.
 */
function getLuceneQuery(target: DataQuery): string {
  // Access the query property which contains the Lucene query
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const t = target as { query?: string };
  return t.query ?? '*';
}

export const DataExplorerLink = ({ targets, dataSourcesMap, timeRange }: DataExplorerLinkProps) => {
  const styles = useStyles2(getStyles);
  const [isLoading, setIsLoading] = useState(false);

  // Filter targets that have associated datasources with valid index patterns
  const availableTargets =
    targets?.filter((target) => {
      const ds = dataSourcesMap.get(target.refId);
      return ds && getIndexPatternName(ds) !== null;
    }) || [];

  const handleOpenInDataExplorer = useCallback(
    async (target: DataQuery) => {
      const datasource = dataSourcesMap.get(target.refId);
      if (!datasource) {
        console.warn('Datasource not found for target:', target.refId);
        return;
      }

      setIsLoading(true);
      try {
        const indexPatternName = getIndexPatternName(datasource);
        if (!indexPatternName) {
          console.warn('Index pattern name not found in datasource');
          setIsLoading(false);
          return;
        }

        const indexPatternId = await getIndexPatternId(datasource, indexPatternName);
        if (!indexPatternId) {
          console.warn('Could not resolve index pattern ID');
          setIsLoading(false);
          return;
        }

        const luceneQuery = getLuceneQuery(target);
        const url = buildDataExplorerUrl(indexPatternId, luceneQuery, timeRange);

        // Open in new tab
        window.open(url, '_blank');
      } catch (error) {
        console.error('Error opening Data Explorer:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [dataSourcesMap, timeRange]
  );

  // Don't render if no targets available
  if (availableTargets.length === 0) {
    return null;
  }

  // If only one query, render a simple button
  if (availableTargets.length === 1) {
    return (
      <Tooltip content={t('logs.data-explorer-link.tooltip', 'Open in Logs Explorer')}>
        <Button
          variant="secondary"
          size="sm"
          fill="text"
          icon={isLoading ? 'spinner' : 'external-link-alt'}
          onClick={() => handleOpenInDataExplorer(availableTargets[0])}
          disabled={isLoading}
          className={styles.button}
        >
          {t('logs.data-explorer-link.button', 'Logs Explorer')}
        </Button>
      </Tooltip>
    );
  }

  // Multiple queries - show dropdown
  const menu = (
    <Menu>
      {availableTargets.map((target) => {
        const datasource = dataSourcesMap.get(target.refId);
        const indexName = datasource ? getIndexPatternName(datasource) : null;
        const query = getLuceneQuery(target);
        const displayQuery = query.length > 30 ? query.substring(0, 30) + '...' : query;

        return (
          <Menu.Item
            key={target.refId}
            label={t('logs.data-explorer-link.menu-item', '{{refId}}: {{query}}', {
              refId: target.refId,
              query: displayQuery,
            })}
            description={indexName || undefined}
            onClick={() => handleOpenInDataExplorer(target)}
          />
        );
      })}
    </Menu>
  );

  return (
    <Dropdown overlay={menu} placement="bottom-end">
      <Button
        variant="secondary"
        size="sm"
        fill="text"
        disabled={isLoading}
        className={styles.button}
      >
        {isLoading ? <Icon name="spinner" /> : <Icon name="external-link-alt" />}
        <span className={styles.buttonText}>{t('logs.data-explorer-link.button', 'Logs Explorer')}</span>
        <Icon name="angle-down" />
      </Button>
    </Dropdown>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  button: css({
    marginLeft: theme.spacing(1),
  }),
  buttonText: css({
    marginLeft: theme.spacing(0.5),
    marginRight: theme.spacing(0.5),
  }),
});
