export function acquireTurn(runtime) {
    if (!runtime || runtime.isGenerating) return false;
    runtime.isGenerating = true;
    return true;
}

export function releaseTurn(runtime) {
    if (runtime) runtime.isGenerating = false;
}

export function isSessionContextCurrent(expected, current) {
    return !!expected && !!current
        && expected.epoch === current.epoch
        && expected.worldId === current.worldId;
}
