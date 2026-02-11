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
    // If the value looks like an intentional regex pattern (contains .*),
    // preserve metacharacters so it works as expected in =~ matchers.
    // Otherwise use the original escape path for literal label values.
    return looksLikeRegex(value) ? escapePromQLRegexString(value) : prometheusSpecialRegexEscape(value);
  }

  // Single-element array: same logic as single string.
  // (templateSrv always passes single selections as a 1-element array for multi/includeAll variables)
  if (value.length === 1) {
    return looksLikeRegex(value[0]) ? escapePromQLRegexString(value[0]) : prometheusSpecialRegexEscape(value[0]);
  }

  // Multiple values: escape all regex metacharacters in each value to build a safe (val1|val2) alternation.
  const escapedValues = value.map((val) => prometheusSpecialRegexEscape(val));
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

// Returns true if the value contains .* indicating the user intended it as a regex pattern.
function looksLikeRegex(value: string): boolean {
  return value.includes('.*');
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
