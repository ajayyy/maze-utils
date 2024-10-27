import { onMobile } from "../../maze-utils/src/pageInfo";

export function getThumbnailElements() {
    if (!onMobile()) {
        return [
            "ytd-thumbnail", 
            "ytd-playlist-thumbnail",
            "ytm-shorts-lockup-view-model",
            "yt-thumbnail-view-model"
        ];
    } else {
        return [
            ".media-item-thumbnail-container",
            ".video-thumbnail-container-compact",
            "ytm-thumbnail-cover",
            ".video-thumbnail-container-vertical",
            "ytm-hero-playlist-thumbnail-renderer"
        ];
    }
}

export function getThumbnailElementsToListenFor() {
    const results = getThumbnailElements();

    if (!onMobile()) {
        results.push("yt-lockup-view-model");
        results.push("ytm-shorts-lockup-view-model-v2");
    }

    return results;
}

export function getThumbnailImageSelectors() {
    if (!onMobile()) {
        return "ytd-thumbnail:not([hidden]) img, ytd-playlist-thumbnail yt-image:not(.blurred-image) img, yt-img-shadow.ytd-hero-playlist-thumbnail-renderer img, ytm-shorts-lockup-view-model img, .yt-thumbnail-view-model__image img";
    } else {
        return "img.video-thumbnail-img, img.amsterdam-playlist-thumbnail";
    }
}

export function getThumbnailLink(thumbnail: HTMLElement): HTMLElement | null {
    if (!onMobile()) {
        return thumbnail.querySelector(getThumbnailSelectors(" a"));
    } else {
        return thumbnail.querySelector([
            "a.media-item-thumbnail-container",
            "ytm-channel-featured-video-renderer a",
            "a.compact-media-item-image",
            "a.reel-item-endpoint",
            ".amsterdam-playlist-thumbnail-wrapper a"
        ].join(", "));
    }
}

export function getThumbnailBoxSelectors() {
    if (!onMobile()) {
        // Hero thumbnail appears as hidden even though it is not
        return getThumbnailSelectors(":not([hidden])", ".ytd-hero-playlist-thumbnail-renderer");
    } else {
        return ".media-item-thumbnail-container";
    }
}

export function getThumbnailSelectors(...additionalSelectors: string[]) {
    if (additionalSelectors.length === 0) {
        additionalSelectors = [""];
    }

    return getThumbnailElements().map((s) => additionalSelectors.map((selector) => `${s}${selector}`).join(", ")).join(", ");
}