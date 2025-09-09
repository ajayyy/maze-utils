import { waitFor } from ".";
import { addCleanupListener } from "./cleanup";
import { onMobile } from "./pageInfo";
import { getThumbnailLink, getThumbnailSelectors } from "./thumbnail-selectors";
import { isOnInvidious } from "./video";

export type ThumbnailListener = (newThumbnails: HTMLElement[]) => void;

const handledThumbnails = new Map<HTMLElement, MutationObserver>();
let lastGarbageCollection = 0;
let thumbnailListener: ThumbnailListener | null = null;
let selector = getThumbnailSelectors();
let invidiousSelector = "div.thumbnail";

export function getThumbnailSelector(): string {
    return isOnInvidious() ? invidiousSelector : selector;
}

export function setThumbnailListener(listener: ThumbnailListener, onInitialLoad: () => void,
        configReady: () => boolean, selectorParam?: string,
            invidiousSelectorParam?: string): void {
    thumbnailListener = listener;
    if (selectorParam) selector = selectorParam;
    if (invidiousSelectorParam) invidiousSelector = invidiousSelectorParam;

    const onLoad = () => {
        onInitialLoad?.();

        // Label thumbnails on load if on Invidious (wait for variable initialization before checking)
        void waitFor(() => isOnInvidious() !== null).then(() => {
            if (isOnInvidious()) newThumbnails();
        });
    };

    if (document.readyState === "complete") {
        onLoad();
    } else {
        window.addEventListener("load", onLoad);
    }

    void waitFor(() => configReady(), 5000, 10).then(() => {
        newThumbnails();
    });

    if (onMobile()) {
        const eventListener = () => mobileNewThumbnailHandler()
        window.addEventListener("touchstart", eventListener);
        window.addEventListener("touchend", eventListener);
        window.addEventListener("scrollend", eventListener);
        window.addEventListener("state-navigateend", eventListener);

        addCleanupListener(() => {
            window.removeEventListener("touchstart", eventListener);
            window.removeEventListener("touchend", eventListener);
            window.removeEventListener("scrollend", eventListener);
            window.removeEventListener("state-navigateend", eventListener);
        });
    }

    addCleanupListener(() => {
        for (const handledThumbnail of handledThumbnails) {
            handledThumbnail[1].disconnect();
        }

        handledThumbnails.clear();
    });
}

let lastThumbnailCheck = 0;
let thumbnailCheckTimeout: NodeJS.Timer | null = null;

export function newThumbnails() {
    if (performance.now() - lastThumbnailCheck < 50 || thumbnailCheckTimeout) {
        if (thumbnailCheckTimeout) {
            return;
        } else {
            thumbnailCheckTimeout = setTimeout(() => {
                thumbnailCheckTimeout = null;
                newThumbnails();
            }, 50);
            return;
        }
    }

    lastThumbnailCheck = performance.now();

    const notNewThumbnails = handledThumbnails.keys();

    const thumbnails = document.querySelectorAll(getThumbnailSelector()) as NodeListOf<HTMLElement>;
    const newThumbnailsFound: HTMLElement[] = [];
    for (const thumbnail of thumbnails) {
        if (!handledThumbnails.has(thumbnail)) {
            newThumbnailsFound.push(thumbnail);
            
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === "attributes" && mutation.attributeName === "href") {
                        thumbnailListener?.([thumbnail]);
                        break;
                    }
                }
            });
            handledThumbnails.set(thumbnail, observer);

            const link = getThumbnailLink(thumbnail);
            if (link) observer.observe(link, { attributes: true });

            // For channel pages where video thumbnails become shorts thumbnails
            const observer2 = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === "childList" 
                            && (mutation.addedNodes[0]?.nodeName.toLowerCase().includes("shorts"))
                                || mutation.previousSibling?.nodeName.toLowerCase().includes("shorts")) {
                        thumbnailListener?.([thumbnail]);
                        break;
                    }
                }
            });

            const content = thumbnail.querySelector("#content");
            if (content) observer2.observe(content, { childList: true });
        }
    }

    thumbnailListener?.(newThumbnailsFound);

    if (performance.now() - lastGarbageCollection > 5000) {
        // Clear old ones (some will come back if they are still on the page)
        // But are handled by happening to be when new ones are added too
        for (const thumbnail of notNewThumbnails) {
            if (document.body && !document.body.contains(thumbnail)) {
                const observer = handledThumbnails.get(thumbnail);
                observer?.disconnect();
                handledThumbnails.delete(thumbnail);
            }
        }

        lastGarbageCollection = performance.now();
    }
}

export function updateAll(): void {
    if (thumbnailListener) thumbnailListener([...handledThumbnails.keys()]);
}

const mobileCheckTimes = [100, 200, 300, 400, 500, 750, 1000, 1500, 2500, 5000, 10000];
let mobileTimeout: NodeJS.Timer | null = null;

/**
 * Will check multiple times up to 5 seconds in the future
 */
function mobileNewThumbnailHandler(index = 0) {
    if (index >= mobileCheckTimes.length) return;
    if (mobileTimeout) clearTimeout(mobileTimeout);

    const timeout = mobileCheckTimes[index] - (index > 0 ? mobileCheckTimes[index - 1] : 0);
    mobileTimeout = setTimeout(() => {
        newThumbnails();
        mobileNewThumbnailHandler(index + 1);
    }, timeout);

    newThumbnails();
}