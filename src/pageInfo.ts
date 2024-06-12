export function onMobile() {
    return window.location.hostname === "m.youtube.com";
}

export function onVideoPage() {
    return !!document.URL.match(/\/watch|\/shorts|\/live|\/embed/);
}