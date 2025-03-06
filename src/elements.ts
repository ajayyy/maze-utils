export function getYouTubeTitleNodeSelector(): string {
    // New YouTube Title, YouTube, Mobile YouTube, Invidious, YouTube videoPrimaryInfoRenderer (2021) layout, Vorapis v3, tv.youtube.com
    return "#title h1, .ytd-video-primary-info-renderer.title, .slim-video-information-title, #player-container + .h-box > h1, .ytd-video-primary-info-renderer > h1.title, #watch7-headline, .ypcs-video-info";
}

export function getYouTubeTitleNode(): HTMLElement {
    return document.querySelector(getYouTubeTitleNodeSelector()) as HTMLElement;
}