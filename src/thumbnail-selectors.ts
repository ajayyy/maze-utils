import { onMobile } from "../../maze-utils/src/pageInfo";

export function getThumbnailElements() {
    if (!onMobile()) {
        return [
            "ytd-thumbnail", 
            "ytd-playlist-thumbnail"
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

export function getThumbnailImageSelectors() {
    if (!onMobile()) {
        return "ytd-thumbnail:not([hidden]) img, ytd-playlist-thumbnail yt-image:not(.blurred-image) img, yt-img-shadow.ytd-hero-playlist-thumbnail-renderer img";
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