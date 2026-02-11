// NOTE: these two functions are similar to the escapeLabelValueIn* functions
// in language_utils.ts, but they are not exactly the same algorithm, and we found

import { QueryVariableModel, CustomVariableModel } from '@grafana/data';
import { config } from '@grafana/runtime';

export function interpolateQueryExpr(
  value: string | string[] = [],
  variable: QueryVariableModel | CustomVariableModel
) {
  // if no multi or include all do not regexEscape
  if (!variable.multi && !variable.includeAll) {
    return prometheusRegularEscape(value);
  }

  if (typeof value === 'string') {
    // For single string values, preserve regex metacharacters so user-entered
    // patterns like de.* work as expected in =~ matchers.
    return escapePromQLRegexString(value);
  }

  const escapedValues = value.map((val) => prometheusSpecialRegexEscape(val));

  if (escapedValues.length === 1) {
    return escapedValues[0];
  }

  return '(' + escapedValues.join('|') + ')';
}

// no way to reuse one in the another or vice versa.
export function prometheusRegularEscape<T>(value: T) {
  if (typeof value !== 'string') {
    return value;
  }

  if (config.featureToggles.prometheusSpecialCharsInLabelValues) {
    // if the string looks like a complete label matcher (e.g. 'job="grafana"' or 'job=~"grafana"'),
    // don't escape the encapsulating quotes
    if (/^\w+(=|!=|=~|!~)".*"$/.test(value)) {
      return value;
    }

    return value
      .replace(/\\/g, '\\\\') // escape backslashes
      .replace(/"/g, '\\"'); // escape double quotes
  }

  // classic behavior
  return value
    .replace(/\\/g, '\\\\') // escape backslashes
    .replace(/'/g, "\\\\'"); // escape single quotes
}

export function prometheusSpecialRegexEscape<T>(value: T) {
  if (typeof value !== 'string') {
    return value;
  }

  if (config.featureToggles.prometheusSpecialCharsInLabelValues) {
    return value
      .replace(/\\/g, '\\\\\\\\') // escape backslashes
      .replace(/"/g, '\\\\\\"') // escape double quotes
      .replace(/[$^*{}\[\]\'+?.()|]/g, '\\\\$&'); // escape regex metacharacters
  }

  // classic behavior
  return value
    .replace(/\\/g, '\\\\\\\\') // escape backslashes
    .replace(/[$^*{}\[\]+?.()|]/g, '\\\\$&'); // escape regex metacharacters
}

// Escapes a string value for safe insertion into a PromQL regex string literal,
// while preserving regex metacharacters so user-entered patterns like foo.*bar work.
// Only escapes backslashes and quotes (the characters that would break the string literal).
function escapePromQLRegexString(value: string): string {
  if (config.featureToggles.prometheusSpecialCharsInLabelValues) {
    return value
      .replace(/\\/g, '\\\\\\\\') // escape backslashes (two-layer: PromQL string + RE2)
      .replace(/"/g, '\\\\\\"'); // escape double quotes for PromQL string literal
  }

  // classic behavior
  return value
    .replace(/\\/g, '\\\\\\\\') // escape backslashes (two-layer: PromQL string + RE2)
    .replace(/'/g, "\\\\'"); // escape single quotes
}

// NOTE: the following 2 exported functions are very similar to the prometheus*Escape
// functions in datasource.ts, but they are not exactly the same algorithm, and we found
// no way to reuse one in the another or vice versa.

// Prometheus regular-expressions use the RE2 syntax (https://github.com/google/re2/wiki/Syntax),
// so every character that matches something in that list has to be escaped.
// the list of metacharacters is: *+?()|\.[]{}^$
// we make a javascript regular expression that matches those characters:
const RE2_METACHARACTERS = /[*+?()|\\.\[\]{}^$]/g;

function escapePrometheusRegexp(value: string): string {
  return value.replace(RE2_METACHARACTERS, '\\$&');
}

// based on the openmetrics-documentation, the 3 symbols we have to handle are:
// - \n ... the newline character
// - \  ... the backslash character
// - "  ... the double-quote character
export function escapeLabelValueInExactSelector(labelValue: string): string {
  return labelValue.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

export function escapeLabelValueInRegexSelector(labelValue: string): string {
  return escapeLabelValueInExactSelector(escapePrometheusRegexp(labelValue));
}
