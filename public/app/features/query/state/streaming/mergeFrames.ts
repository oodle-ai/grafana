import { DataFrame, DataQueryResponseData, Field, FieldType } from '@grafana/data';

/**
 * Identifies the same series across the responses of the different parts of a split query.
 * Frames with the same key are guaranteed to have the same field structure, so their values
 * can be concatenated field by field.
 */
export function getFrameKey(frame: DataFrame): string {
  const fields = frame.fields.map((field) => `${field.name}#${field.type}#${stringifyLabels(field.labels)}`).join(',');

  return `${frame.refId ?? ''}|${frame.name ?? ''}|${fields}`;
}

function stringifyLabels(labels?: Record<string, string>): string {
  if (!labels) {
    return '';
  }
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(',');
}

function isDataFrame(data: DataQueryResponseData): data is DataFrame {
  return data != null && Array.isArray(data.fields);
}

/**
 * Merges the responses of the parts of a split query into a single set of frames.
 *
 * `chunks` must be ordered oldest first. Frames present in several chunks are concatenated in
 * time order and de-duplicated on the shared boundary timestamp. The most recent chunk is used
 * as the template for field config and metadata, so the merged frames look exactly like the
 * frames of an unsplit query.
 */
export function mergeChunkFrames(chunks: Array<DataQueryResponseData[] | undefined>): DataQueryResponseData[] {
  const byKey = new Map<string, DataFrame[]>();
  const order: string[] = [];
  const passThrough: DataQueryResponseData[] = [];

  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }

    for (const data of chunk) {
      if (!isDataFrame(data)) {
        // Not a frame (e.g. a legacy response) - nothing sensible to merge, keep the newest one
        passThrough.push(data);
        continue;
      }

      const key = getFrameKey(data);
      const existing = byKey.get(key);
      if (existing) {
        existing.push(data);
      } else {
        byKey.set(key, [data]);
        order.push(key);
      }
    }
  }

  const merged: DataQueryResponseData[] = order.map((key) => concatFrames(byKey.get(key)!));

  return merged.concat(passThrough);
}

/** `frames` are ordered oldest first and share the same field structure */
function concatFrames(frames: DataFrame[]): DataFrame {
  if (frames.length === 1) {
    return frames[0];
  }

  // The newest frame carries the freshest meta/config, use it as the template
  const template = frames[frames.length - 1];
  const timeFieldIndex = template.fields.findIndex((field) => field.type === FieldType.time);

  const fields: Field[] = template.fields.map((field) => ({
    ...field,
    values: [],
    nanos: field.nanos ? [] : undefined,
    // display/state caches are per-instance and must not be reused with a new value array
    state: null,
  }));

  let lastTime: number | undefined;

  for (const frame of frames) {
    if (frame.fields.length !== template.fields.length) {
      continue;
    }

    let startIndex = 0;
    if (timeFieldIndex >= 0 && lastTime !== undefined) {
      const times = frame.fields[timeFieldIndex].values;
      // Parts share their boundary timestamp, skip the samples already collected
      while (startIndex < times.length && times[startIndex] <= lastTime) {
        startIndex++;
      }
    }

    for (let i = 0; i < fields.length; i++) {
      const source = frame.fields[i];
      const target = fields[i];

      // Appending in a loop, spreading large value arrays can overflow the call stack
      for (let row = startIndex; row < source.values.length; row++) {
        target.values.push(source.values[row]);
        if (target.nanos && source.nanos) {
          target.nanos.push(source.nanos[row]);
        }
      }
    }

    if (timeFieldIndex >= 0) {
      const times = fields[timeFieldIndex].values;
      if (times.length > 0) {
        lastTime = times[times.length - 1];
      }
    }
  }

  return {
    ...template,
    fields,
    length: fields.length > 0 ? fields[0].values.length : 0,
  };
}
