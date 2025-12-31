import { css } from '@emotion/css';
import { ChangeEvent, useState } from 'react';
import * as React from 'react';

import { DataQueryError, GrafanaTheme2 } from '@grafana/data';
import { Trans, t } from '@grafana/i18n';
import { Icon, InlineField, InlineLabel, TextArea, Toggletip, useStyles2, Stack, TextLink } from '@grafana/ui';

import { QueryErrorAlert } from '../../query/components/QueryErrorAlert';
import { ExpressionQuery } from '../types';

import { validateMathExpression } from './MathValidation';

interface Props {
  labelWidth: number | 'auto';
  query: ExpressionQuery;
  onChange: (query: ExpressionQuery) => void;
  onRunQuery: () => void;
  queries?: Array<{ refId: string }>; // Available queries for variable validation
}

const mathPlaceholder =
  'Math operations on one or more queries. You reference the query by ${refId} ie. $A, $B, $C etc\n' +
  'The sum of two scalar values: $A + $B > 10';

export const Math = ({ labelWidth, onChange, query, onRunQuery, queries }: Props) => {
  const [validationError, setValidationError] = useState<DataQueryError | null>(null);

  const onExpressionChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const newExpression = event.target.value;
    onChange({ ...query, expression: newExpression });

    // Clear validation error when user starts typing
    if (validationError) {
      setValidationError(null);
    }
  };

  const styles = useStyles2(getStyles);

  const executeQuery = () => {
    if (query.expression) {
      onRunQuery();
    }
  };

  const handleBlur = () => {
    const errorMessage = validateMathExpression(query.expression || '', queries);
    if (errorMessage) {
      // Show validation error using QueryErrorAlert
      setValidationError({
        message: errorMessage,
        refId: query.refId,
      });
    } else {
      // Clear any existing validation error and execute query
      setValidationError(null);
      executeQuery();
    }
  };

  return (
    <Stack direction="column">
      <InlineField
        label={
          <InlineLabel width="auto">
            <Toggletip
              fitContent
              content={
                <div className={styles.documentationContainer}>
                  <div>
                    <Trans
                      i18nKey="expressions.math.run-math-operations"
                      values={{
                        refExample: '${refId}',
                        ref1: '$A',
                        ref2: '$B',
                        ref3: '$C',
                        example: '$A + $B',
                      }}
                    >
                      Run math operations on one or more queries. You reference the query by {'{{refExample}}'} ie.{' '}
                      {'{{ref1}}'}, {'{{ref2}}'}, {'{{ref3}}'}
                      etc.
                      <br />
                      Example: <code>{'{{example}}'}</code>
                    </Trans>
                  </div>
                  <header className={styles.documentationHeader}>
                    <Trans i18nKey="expressions.math.available-math-functions">Available math functions</Trans>
                  </header>
                  <div className={styles.documentationFunctions}>
                    <DocumentedFunction
                      name="abs"
                      description={t(
                        'expression.math.description-abs',
                        'Returns the absolute value of its argument which can be a number or a series'
                      )}
                    />
                    <DocumentedFunction
                      name="is_inf"
                      description={t(
                        'expression.math.description-is-inf',
                        "Returns 1 for Inf values (negative or positive) and 0 for other values. It's able to operate on series or scalar values."
                      )}
                    />
                    <DocumentedFunction
                      name="is_nan"
                      description={t(
                        'expression.math.description-is-nan',
                        "Returns 1 for NaN values and 0 for other values. It's able to operate on series or scalar values."
                      )}
                    />
                    <DocumentedFunction
                      name="is_null"
                      description={t(
                        'expression.math.description-is-null',
                        "Returns 1 for null values and 0 for other values. It's able to operate on series or scalar values."
                      )}
                    />
                    <DocumentedFunction
                      name="is_number"
                      description={t(
                        'expression.math.description-is-number',
                        "Returns 1 for all real number values and 0 for non-number. It's able to operate on series or scalar values."
                      )}
                    />
                    <DocumentedFunction
                      name="log"
                      description={t(
                        'expression.math.description-log',
                        'Returns the natural logarithm of its argument, which can be a number or a series'
                      )}
                    />
                    <DocumentedFunction
                      name="inf, infn, nan, and null"
                      description={t(
                        'expression.math.description-inf-nan-null',
                        'The inf for infinity positive, infn for infinity negative, nan, and null functions all return a single scalar value that matches its name.'
                      )}
                    />
                    <DocumentedFunction
                      name="round"
                      description={t(
                        'expression.math.description-round',
                        "Returns a rounded integer value. It's able to operate on series or escalar values."
                      )}
                    />
                    <DocumentedFunction
                      name="ceil"
                      description={t(
                        'expression.math.description-ceil',
                        "Rounds the number up to the nearest integer value. It's able to operate on series or escalar values."
                      )}
                    />
                    <DocumentedFunction
                      name="floor"
                      description={t(
                        'expression.math.description-floor',
                        "Rounds the number down to the nearest integer value. It's able to operate on series or escalar values."
                      )}
                    />
                  </div>
                </div>
              }
              title={
                <Stack gap={1} direction="row">
                  <Icon name="book-open" /> <Trans i18nKey="expressions.math.tooltip-title">Math operator</Trans>
                </Stack>
              }
              footer={
                <div>
                  <Trans i18nKey="expressions.math.tooltip-footer">
                    See our additional documentation on{' '}
                    <TextLink
                      external
                      href="https://grafana.com/docs/grafana/latest/panels/query-a-data-source/use-expressions-to-manipulate-data/about-expressions/#math"
                    >
                      Math expressions
                    </TextLink>
                    .
                  </Trans>
                </div>
              }
              closeButton={true}
              placement="bottom-start"
            >
              <div className={styles.info}>
                <Trans i18nKey="expressions.math.tooltip-trigger">Expression</Trans> <Icon name="info-circle" />
              </div>
            </Toggletip>
          </InlineLabel>
        }
        labelWidth={labelWidth}
        grow={true}
        shrink={true}
      >
        <TextArea
          value={query.expression}
          onChange={onExpressionChange}
          rows={1}
          placeholder={mathPlaceholder}
          onBlur={handleBlur}
          style={{ minWidth: 250, lineHeight: '26px', minHeight: 32 }}
        />
      </InlineField>
      {validationError && <QueryErrorAlert error={validationError} />}
    </Stack>
  );
};

interface DocumentedFunctionProps {
  name: string;
  description: React.ReactNode;
}
const DocumentedFunction = ({ name, description }: DocumentedFunctionProps) => {
  const styles = useStyles2(getDocumentedFunctionStyles);

  return (
    <>
      <span className={styles.name}>{name}</span>
      <span className={styles.description}>{description}</span>
    </>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  documentationHeader: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.h5.fontWeight,
  }),
  documentationContainer: css({
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: theme.spacing(2),

    padding: theme.spacing(1, 2),
  }),
  documentationFunctions: css({
    display: 'grid',
    gridTemplateColumns: 'max-content auto',
    columnGap: theme.spacing(2),
  }),
  info: css({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    cursor: 'pointer',
    gap: theme.spacing(1),
  }),
});

const getDocumentedFunctionStyles = (theme: GrafanaTheme2) => ({
  name: css({
    fontWeight: theme.typography.fontWeightBold,
  }),
  description: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.disabled,
  }),
});
