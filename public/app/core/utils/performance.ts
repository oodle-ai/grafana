export function startGPerformanceMeasure(eventName: string) {
    console.time(eventName);
    if (!performance || !performance.mark) {
        return;
    }

    performance.mark(`${eventName}_started`);

    if (!window.parent || !window.parent.performance || !window.parent.performance.mark) {
        return;
    }

    window.parent.performance.mark(`${eventName}_started`);
}

export function stopGPerformanceMeasure(eventName: string) {
    console.timeEnd(eventName);
    if (!performance || !performance.mark) {
        return;
    }

    performance.mark(`${eventName}_completed`);
    performance.measure(`${eventName}_measured`, `${eventName}_started`, `${eventName}_completed`);

    if (!window.parent || !window.parent.performance || !window.parent.performance.mark) {
        return;
    }

    window.parent.performance.mark(`${eventName}_completed`);
    window.parent.performance.measure(`${eventName}_measured`, `${eventName}_started`, `${eventName}_completed`);
}

export function addGPerformanceMarker(markerName: string, detail?: any) {
    console.log(markerName, detail);
    if (!performance || !performance.mark) {
        return;
    }

    performance.mark(markerName, { detail });

    console.timeStamp(markerName);

    if (!window.parent || !window.parent.performance || !window.parent.performance.mark) {
        return;
    }

    window.parent.performance.mark(markerName, { detail });
}
