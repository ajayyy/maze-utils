import { isOnV3Extension, onMobile } from "../../maze-utils/src/pageInfo";

export const brandingBoxSelector = !onMobile()
    ? ("ytd-rich-grid-media, ytd-video-renderer, ytd-movie-renderer, ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-compact-movie-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, ytd-grid-video-renderer, ytd-grid-movie-renderer, ytd-rich-grid-slim-media, ytd-radio-renderer, ytd-reel-item-renderer, ytd-compact-playlist-renderer, ytd-playlist-renderer, ytd-grid-playlist-renderer, ytd-grid-show-renderer, ytd-structured-description-video-lockup-renderer, ytd-hero-playlist-thumbnail-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model"
        + ", .lohp-large-shelf-container, .lohp-medium-shelf, .yt-lockup-video, .related-video") // Vorapis v3
    : "ytm-video-with-context-renderer, ytm-compact-radio-renderer, ytm-reel-item-renderer, ytm-channel-featured-video-renderer, ytm-compact-video-renderer, ytm-playlist-video-renderer, .playlist-immersive-header-content, ytm-compact-playlist-renderer, ytm-video-card-renderer, ytm-vertical-list-renderer, ytm-playlist-panel-video-renderer, ytm-shorts-lockup-view-model";

export function getThumbnailElements() {
    if (!onMobile()) {
        return [
            "ytd-thumbnail", 
            "ytd-playlist-thumbnail",
            "ytm-shorts-lockup-view-model",
            "yt-thumbnail-view-model",
            ".ux-thumb-wrap" // V3 extension
        ];
    } else {
        return [
            ".media-item-thumbnail-container",
            ".video-thumbnail-container-compact",
            "ytm-thumbnail-cover",
            ".video-thumbnail-container-vertical",
            "ytm-hero-playlist-thumbnail-renderer",
            "ytm-shorts-lockup-view-model"
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
        if (!isOnV3Extension()) {
            return "ytd-thumbnail:not([hidden]) img, ytd-playlist-thumbnail yt-image:not(.blurred-image) img, yt-img-shadow.ytd-hero-playlist-thumbnail-renderer img, ytm-shorts-lockup-view-model img, yt-thumbnail-view-model *:not(.ytThumbnailViewModelBlurredImage) img";
        } else {
            return ".ux-thumb-wrap img:not(.cbCustomThumbnailCanvas)";
        }
    } else {
        return "img.video-thumbnail-img, img.amsterdam-playlist-thumbnail, ytm-shorts-lockup-view-model img";
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
            ".amsterdam-playlist-thumbnail-wrapper a",
            "a.YtmCompactMediaItemMetadataContent"
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