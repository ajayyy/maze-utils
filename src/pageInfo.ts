export function onMobile() {
    return typeof window !== "undefined" && window.location.hostname === "m.youtube.com";
}

export function onYouTubeCableTV() {
    return typeof window !== "undefined" && window.location.hostname === "tv.youtube.com";
}

export function onVideoPage() {
    return !!document.URL.match(/\/watch|\/shorts|\/live|\/embed/);
}