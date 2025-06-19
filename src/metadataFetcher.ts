import { DataCache } from "./cache";
import { addCleanupListener } from "./cleanup";
import { isSafari } from "./config";
import { onMobile } from "./pageInfo";
import { ChannelID, VideoID } from "./video";

export interface PlaybackUrl {
    url: string;
    width: number;
    height: number;
}

interface VideoMetadata {
    playbackUrls: PlaybackUrl[];
    duration: number | null;
    channelID: ChannelID | null;
    author: string | null;
    isLive: boolean | null;
    isUpcoming: boolean | null;
}

export interface Format {
    url: string;
    width: number;
    height: number;
}

interface InnerTubeFormat {
    url: string;
    width: number;
    height: number;
    mimeType: string;
}


interface InnerTubeMetadataBase {
    duration: number | null;
    channelID: ChannelID | null;
    author: string | null;
    isLive: boolean | null;
    isUpcoming: boolean | null;
    playabilityStatus?: string;
}

interface InnerTubeMetadata extends InnerTubeMetadataBase {
    formats: InnerTubeFormat[];
}

interface VideoMetadata extends InnerTubeMetadataBase {
    playbackUrls: PlaybackUrl[];
}

export interface ChannelInfo {
    channelID: string | null;
    author: string | null;
}

export const videoMetadataCache = new DataCache<VideoID, VideoMetadata>(() => ({
    playbackUrls: [],
    duration: null,
    channelID: null,
    author: null,
    isLive: null,
    isUpcoming: null
}));

interface MetadataWaiting {
    videoID: VideoID;
    callbacks: Array<(metadata: VideoMetadata) => void>;
}
const waitingForMetadata: MetadataWaiting[] = [];
let claimMainMetadataFetcher = false;

export function setupMetadataOnRecieve() {
    // Try to claim fetcher for channel data
    const documentScript = document.getElementById("sponsorblock-document-script");
    if (documentScript) {
        const claim = documentScript.getAttribute("claim-id");
        if (!claim || claim === chrome.runtime.id) {
            claimMainMetadataFetcher = true;
            
            if (!claim) {
                documentScript.setAttribute("claim-id", chrome.runtime.id);
            }
        }
    }

    const onMessage = (event: MessageEvent) => {
        if (event.data?.type === "maze-utils:video-metadata-received") {
            const data = event.data;
            if (data.videoID && data.metadata && !videoMetadataCache.getFromCache(data.videoID)) {
                const metadata = data.metadata as VideoMetadata;
                const cachedData = videoMetadataCache.setupCache(data.videoID);
            
                cachedData.playbackUrls = metadata.playbackUrls;
                cachedData.duration = metadata.duration;
                cachedData.channelID = metadata.channelID;
                cachedData.author = metadata.author;
                cachedData.isLive = metadata.isLive;
                cachedData.isUpcoming = metadata.isUpcoming;

                const index = waitingForMetadata.findIndex((item) => item.videoID === data.videoID);
                if (index !== -1) {
                    waitingForMetadata[index].callbacks.forEach((callback) => {
                        callback(data.metadata);
                    });
    
                    waitingForMetadata.splice(index, 1);
                }
            }

        } else if (event.data?.type === "maze-utils:video-metadata-requested") {
            waitingForMetadata.push({
                videoID: event.data.videoID,
                callbacks: []
            });
        }
    };

    window.addEventListener("message", onMessage);

    addCleanupListener(() => {
        window.removeEventListener("message", onMessage);
    });
}

const activeRequests: Record<VideoID, Promise<VideoMetadata>> = {};
export async function fetchVideoMetadata(videoID: VideoID, ignoreCache: boolean, waitForOtherScript = false): Promise<VideoMetadata> {
    const cachedData = videoMetadataCache.getFromCache(videoID);
    if (!ignoreCache && cachedData && cachedData.duration !== null) {
        return cachedData;
    }

    let waiting = waitingForMetadata.find((item) => item.videoID === videoID);
    if (waiting || waitForOtherScript) {
        return new Promise((resolve) => {
            if (!waiting) {
                waiting = {
                    videoID,
                    callbacks: []
                };

                waitingForMetadata.push(waiting);
            }

            waiting.callbacks.push((metadata) => {
                videoMetadataCache.cacheUsed(videoID);
                resolve(metadata);
            });
        });
    }

    try {
        const result = activeRequests[videoID] ?? (async () => {
            window.postMessage({
                type: "maze-utils:video-metadata-requested",
                videoID
            }, "*");

            let metadata = await fetchVideoDataDesktopClient(videoID).catch(() => null);

            // Don't retry for LOGIN_REQUIRED, they will never have urls
            if (!onMobile() && (!metadata 
                    || (metadata.formats.length === 0 && metadata.playabilityStatus !== "LOGIN_REQUIRED"))) metadata = await fetchVideoDataDesktopClient(videoID).catch(() => null);

            if (metadata) {
                let formats = metadata.formats;
                if (isSafari()) {
                    formats = formats.filter((format) => format.mimeType.includes("avc"));
                }

                const containsVp9 = formats.some((format) => format.mimeType.includes("vp9"));
                // Should already be reverse sorted, but reverse sort just incase (not slow if it is correct already)
                const sorted = formats
                    .reverse()
                    .filter((format) => format.width && format.height && (!containsVp9 || format.mimeType.includes("vp9")))
                    .sort((a, b) => a?.width - b?.width);

                const videoCache = videoMetadataCache.setupCache(videoID);
                videoCache.playbackUrls = sorted.map((format) => ({
                    url: format.url,
                    width: format.width,
                    height: format.height
                }));
                videoCache.duration = metadata.duration;
                videoCache.channelID = metadata.channelID;
                videoCache.author = metadata.author;
                videoCache.isLive = metadata.isLive;
                videoCache.isUpcoming = metadata.isUpcoming;

                // Remove this from active requests after it's been dealt with in other places
                setTimeout(() => delete activeRequests[videoID], 500);

                window.postMessage({
                    type: "maze-utils:video-metadata-received",
                    videoID,
                    metadata: videoCache
                }, "*");

                return videoCache;
            }

            window.postMessage({
                type: "maze-utils:video-metadata-received",
                videoID,
                metadata: {
                    duration: null,
                    channelID: null,
                    author: null,
                    playbackUrls: [],
                    isLive: null,
                    isUpcoming: null
                }
            }, "*");

            return {
                duration: null,
                channelID: null,
                author: null,
                playbackUrls: [],
                isLive: null,
                isUpcoming: null
            }; 
        })();

        activeRequests[videoID] = result;
        return await result;
    } catch (e) { } //eslint-disable-line no-empty

    return {
        duration: null,
        channelID: null,
        author: null,
        playbackUrls: [],
        isLive: null,
        isUpcoming: null
    };
}

export async function fetchVideoDataAndroidClient(videoID: VideoID): Promise<InnerTubeMetadata> {
    const innertubeDetails = {
        apiKey: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
        clientVersion: "17.31.35",
        clientName: "3",
        androidVersion: "12"
    }

    const context = {
        client: {
            clientName: "ANDROID",
            clientVersion: innertubeDetails.clientVersion,
            androidSdkVersion: 31,
            osName: "Android",
            osVersion: innertubeDetails.androidVersion,
            hl: "en",
            gl: "US"
        }
    }

    const url = `https://www.youtube.com/youtubei/v1/player?key=${innertubeDetails.apiKey}`;
    const data = {
        context: context,
        videoId: videoID,
        params: "8AEB",
        playbackContext: {
            contentPlaybackContext: {
                html5Preference: "HTML5_PREF_WANTS"
            }
        },
        contentCheckOk: true,
        racyCheckOk: true
    }

    try {
        const result = await fetch(url, {
            body: JSON.stringify(data),
            headers: {
                "X-Youtube-Client-Name": innertubeDetails.clientName,
                "X-Youtube-Client-Version": innertubeDetails.clientVersion,
                "User-Agent": `com.google.android.youtube/${innertubeDetails.clientVersion} (Linux; U; Android ${innertubeDetails.androidVersion}) gzip`,
                "Content-Type": "application/json",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-us,en;q=0.5",
                "Sec-Fetch-Mode": "navigate",
                "Connection": "close"
            },
            method: "POST"
        });

        if (result.ok) {
            const response = await result.json();
            const newVideoID = response?.videoDetails?.videoId ?? null;
            if (newVideoID !== videoID) {
                return {
                    formats: [],
                    duration: null,
                    channelID: null,
                    author: null,
                    isLive: null,
                    isUpcoming: null
                };
            }

            const formats = response?.streamingData?.adaptiveFormats as InnerTubeFormat[];
            const duration = response?.videoDetails?.lengthSeconds ? parseInt(response.videoDetails.lengthSeconds) : null;
            const channelId = response?.videoDetails?.channelId ?? null;
            const author = response?.videoDetails?.author ?? null;
            const isLive = response?.videoDetails?.isLive ?? null;
            const isUpcoming = response?.videoDetails?.isUpcoming ?? null;
            const playabilityStatus = response?.playabilityStatus?.status ?? null;
            if (formats) {
                return {
                    formats,
                    duration,
                    channelID: channelId,
                    author,
                    isLive,
                    isUpcoming,
                    playabilityStatus
                };
            }
        }

    } catch (e) { } //eslint-disable-line no-empty

    return {
        formats: [],
        duration: null,
        channelID: null,
        author: null,
        isLive: null,
        isUpcoming: null
    };
}

export async function fetchVideoDataDesktopClient(videoID: VideoID): Promise<InnerTubeMetadata> {
    const url = "https://www.youtube.com/youtubei/v1/player";
    const data = {
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20230327.07.00"
            }
        },
        videoId: videoID
    };

    try {
        const result = await fetch(url, {
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json'
            },
            method: "POST"
        });

        if (result.ok) {
            const response = await result.json();
            const newVideoID = response?.videoDetails?.videoId ?? null;
            if (newVideoID !== videoID) {
                return {
                    formats: [],
                    duration: null,
                    channelID: null,
                    author: null,
                    isLive: null,
                    isUpcoming: null
                };
            }

            const formats = response?.streamingData?.adaptiveFormats as InnerTubeFormat[] || [];
            const duration = response?.videoDetails?.lengthSeconds ? parseInt(response.videoDetails.lengthSeconds) : null;
            const channelId = response?.videoDetails?.channelId ?? null;
            const author = response?.videoDetails?.author ?? null;
            const isLive = response?.videoDetails?.isLive ?? null;
            const isUpcoming = response?.videoDetails?.isUpcoming ?? null;
            const playabilityStatus = response?.playabilityStatus?.status ?? null;

            return {
                formats,
                duration,
                channelID: channelId,
                author,
                isLive,
                isUpcoming,
                playabilityStatus
            };
        }

    } catch (e) { } //eslint-disable-line no-empty

    return {
        formats: [],
        duration: null,
        channelID: null,
        author: null,
        isLive: null,
        isUpcoming: null
    };
}

export async function getPlaybackFormats(videoID: VideoID,
    width?: number, height?: number, ignoreCache = false): Promise<Format | null> {
    const formats = await fetchVideoMetadata(videoID, ignoreCache);

    if (width && height) {
        const bestFormat = formats?.playbackUrls?.find?.(f => f?.width >= width && f?.height >= height);

        if (bestFormat) {
            videoMetadataCache.cacheUsed(videoID);

            return bestFormat;
        }
    } else if (formats?.playbackUrls?.length > 0) {
        return formats[0];
    }

    return null;
}

export async function getChannelID(videoID: VideoID, waitForOtherScript = false): Promise<ChannelInfo> {
    const metadata = await fetchVideoMetadata(videoID, false, waitForOtherScript);

    if (metadata) {
        return {
            channelID: metadata.channelID,
            author: metadata.author
        };
    }

    return {
        channelID: null,
        author: null
    };
}

export function getChannelIDSync(videoID: VideoID): ChannelInfo | null {
    const cachedData = videoMetadataCache.getFromCache(videoID);

    if (cachedData) {
        return {
            channelID: cachedData.channelID,
            author: cachedData.author
        };
    }

    return null;
}

export async function isLiveOrUpcoming(videoID: VideoID): Promise<boolean | null> {
    const data = await fetchVideoMetadata(videoID, false);
    if (data) {
        return data.isLive || data.isUpcoming;
    }

    return null;
}

export function isLiveSync(videoID: VideoID): boolean | null {
    const cachedData = videoMetadataCache.getFromCache(videoID);

    if (cachedData) {
        return cachedData.isLive && !cachedData.isUpcoming;
    }

    return null;
}

export function isMainMetadataFetcher(): boolean {
    return claimMainMetadataFetcher;
}