// Core Grafana history https://github.com/grafana/grafana/blob/v11.0.0-preview/public/app/plugins/datasource/prometheus/components/monaco-query-field/MonacoQueryFieldWrapper.tsx
import { MonacoQueryFieldLazy } from './MonacoQueryFieldLazy';
import { Props as MonacoProps } from './MonacoQueryFieldProps';

type Props = Omit<MonacoProps, 'onRunQuery' | 'onBlur'> & {
  onChange: (query: string) => void;
  onRunQuery: () => void;
};

export const MonacoQueryFieldWrapper = (props: Props) => {
  const { onRunQuery, onChange, ...rest } = props;

  const handleRunQuery = (value: string) => {
    onChange(value);
    onRunQuery();
  };

  const handleBlur = (value: string) => {
    onChange(value);
  };

  /**
   * Handles changes without running any queries
   * @param value
   */
  const handleChange = (value: string) => {
    onChange(value);
  };

  return <MonacoQueryFieldLazy onChange={handleChange} onRunQuery={handleRunQuery} onBlur={handleBlur} {...rest} />;
};
