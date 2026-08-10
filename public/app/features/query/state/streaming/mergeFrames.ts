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
 *
 * Series are ordered by the most recent chunk they appear in, so a series keeps its position in
 * the list as older parts arrive. That position decides the palette color, and a series changing
 * color halfway through loading is very visible.
 */
export function mergeChunkFrames(chunks: Array<DataQueryResponseData[] | undefined>): DataQueryResponseData[] {
  const byKey = new Map<string, Array<{ chunk: number; frame: DataFrame }>>();
  const order: string[] = [];
  const passThrough: DataQueryResponseData[] = [];
  let passThroughChunk: number | undefined;

  // Newest chunk first, so the series it contains keep the lowest indexes
  for (let chunk = chunks.length - 1; chunk >= 0; chunk--) {
    const frames = chunks[chunk];
    if (!frames) {
      continue;
    }

    for (const data of frames) {
      if (!isDataFrame(data)) {
        // Not a frame (e.g. a legacy response) - nothing sensible to merge, keep the newest one
        if (passThroughChunk === undefined || passThroughChunk === chunk) {
          passThroughChunk = chunk;
          passThrough.push(data);
        }
        continue;
      }

      const key = getFrameKey(data);
      const existing = byKey.get(key);
      if (existing) {
        existing.push({ chunk, frame: data });
      } else {
        byKey.set(key, [{ chunk, frame: data }]);
        order.push(key);
      }
    }
  }

  const merged: DataQueryResponseData[] = order.map((key) => {
    const entries = byKey.get(key)!;
    // Collected newest first, concatenate the values in time order
    return concatFrames(entries.sort((a, b) => a.chunk - b.chunk).map((entry) => entry.frame));
  });

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

  // A part may be missing the nanosecond column even when another part has it, collect it as soon
  // as any part carries one so the two arrays cannot drift out of sync
  const hasNanos = frames.some((frame) => frame.fields.some((field) => field.nanos));

  const fields: Field[] = template.fields.map((field) => ({
    ...field,
    values: [],
    nanos: hasNanos && (field.nanos || field.type === FieldType.time) ? [] : undefined,
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
        if (target.nanos) {
          target.nanos.push(source.nanos?.[row] ?? 0);
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
