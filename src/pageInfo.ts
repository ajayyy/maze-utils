export function onMobile() {
    return typeof window !== "undefined" && window.location.hostname === "m.youtube.com";
}

export function onYouTubeCableTV() {
    return typeof window !== "undefined" && window.location.hostname === "tv.youtube.com";
}

let onV3Extension: boolean | null = null;
const initTime = performance.now();
let lastCheck = performance.now();
export function isOnV3Extension(update = false): boolean {
    if (lastCheck - initTime < 500) {
        update = true;
        lastCheck = performance.now();
    }

    if (onV3Extension === null || (update && !onV3Extension)) {
        onV3Extension = !!document.querySelector("head > .v3");
    }

    return onV3Extension;
}

export function onVideoPage() {
    return !!document.URL.match(/\/watch|\/shorts|\/live|\/embed/);
}