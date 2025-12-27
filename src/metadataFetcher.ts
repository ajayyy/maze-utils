import { DataCache, PeekPromise } from "./cache";
import { addCleanupListener } from "./cleanup";
import { isSafari } from "./config";
import { isBodyGarbage } from "./formating";
import { onMobile } from "./pageInfo";
import type { ChannelID, VideoID } from "./video";

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

export interface OembedData {
    author_url: string;
    parsed: {
        // the @handle of the uploader
        channelHandle: string | null;
    };
}

export const videoMetadataCache = new DataCache<VideoID, VideoMetadata>(() => ({
    playbackUrls: [],
    duration: null,
    channelID: null,
    author: null,
    isLive: null,
    isUpcoming: null
}));
const oembedCache = new DataCache<VideoID, { data: PeekPromise<OembedData | null> | null }>(() => ({
    data: null,
}));
const channelResolveCache = new DataCache<string, { data: PeekPromise<ChannelID | null> | null }>(() => ({
    data: null,
}));
const ucidFromVideoCache = new DataCache<VideoID, { data: PeekPromise<ChannelID | null> | null }>(() => ({
    data: null,
}));
const channelNameFromUcidCache = new DataCache<ChannelID, { data: PeekPromise<string | null> | null }>(() => ({
    data: null,
}));
const channelNameFromVideoCache = new DataCache<VideoID, { data: PeekPromise<string | null> | null }>(() => ({
    data: null,
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

        } else if (event.data?.type === "maze-utils:video-metadata-requested" && !(event.data.videoID in activeRequests)) {
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

async function doFetchOembed(videoID: VideoID): Promise<OembedData> {
    const url = new URL("https://www.youtube.com/oembed");
    url.searchParams.set("url", `https://youtu.be/${videoID}`);
    
    const resp = await fetch(url, {
        headers: {
            'Content-Type': 'application/json'
        },
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`OEmbed request failed: Got response code ${resp.status} ${resp.statusText}${isBodyGarbage(body) ? "" : ` with body ${body}`}`);
    }
    const data = await resp.json() as OembedData;
    data.parsed = {
        channelHandle: null,
    }
    try {
        const channelUrl = new URL(data.author_url);
        if (channelUrl.pathname.startsWith("/@") && channelUrl.pathname.lastIndexOf("/") === 0) {
            data.parsed.channelHandle = decodeURIComponent(channelUrl.pathname.substring(1));
        } else {
            console.warn(`[maze-utils] author_url for video ${videoID} was not a channel handle URL`);
        }
    } catch (e) {
        console.error(`[maze-utils] Caught error while parsing OEmbed data for video ${videoID}:`, e);
    }
    return data;
}

export function fetchOembed(videoID: VideoID): PeekPromise<OembedData | null> {
    const entry = oembedCache.setupCache(videoID);
    entry.data ??= new PeekPromise(doFetchOembed(videoID).catch(err => {
        console.error(`[maze-utils] OEmbed data request for video ${videoID} failed:`, err)
        return null;
    }))
    oembedCache.cacheUsed(videoID);
    return entry.data;
}

export function isUCID(ucid: string): ucid is ChannelID {
    return /^UC[0-9A-Za-z-]{22}$/.test(ucid);
}

async function doResolveHandle(channelHandle: string): Promise<ChannelID> {
    const url = "https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false";
    const data = {
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20230327.07.00"
            }
        },
        url: `https://www.youtube.com/${encodeURIComponent(channelHandle)}`,
    };

    const resp = await fetch(url, {
        body: JSON.stringify(data),
        headers: {
            'Content-Type': 'application/json'
        },
        method: "POST",
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Innertube resolve URL request failed: Got response code ${resp.status} ${resp.statusText}${isBodyGarbage(body) ? "" : ` with body ${body}`}`);
    }
    const resolved = await resp.json();
    const ucid = resolved.endpoint.browseEndpoint.browseId as string;
    // sanity check
    // https://github.com/yt-dlp/yt-dlp/blob/a065086640e888e8d58c615d52ed2f4f4e4c9d18/yt_dlp/extractor/youtube.py#L518-L519
    if (!isUCID(ucid)) {
        throw new Error(`Innertube response contained a seemingly invalid UCID: ${ucid}`);
    }
    return ucid;
}

export function resolveHandle(channelHandle: string): PeekPromise<ChannelID | null> {
    const entry = channelResolveCache.setupCache(channelHandle);
    entry.data ??= new PeekPromise(doResolveHandle(channelHandle).catch(err => {
        console.error(`[maze-utils] Innertube resolve URL request for channel handle ${channelHandle} failed:`, err)
        return null;
    }))
    channelResolveCache.cacheUsed(channelHandle);
    return entry.data;
}

export function getUcidFromVideo(videoID: VideoID): PeekPromise<ChannelID | null> {
    const entry = ucidFromVideoCache.setupCache(videoID);
    entry.data ??= new PeekPromise((async () => {
        const oembedData = await fetchOembed(videoID);
        if (oembedData?.parsed.channelHandle == null) return null;
        return await resolveHandle(oembedData.parsed.channelHandle);
    })())
    ucidFromVideoCache.cacheUsed(videoID);
    return entry.data;
}

async function doFetchChannelName(ucid: ChannelID): Promise<string> {
    const url = "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";
    const data = {
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20230327.07.00"
            }
        },
        browseId: ucid,
        param: "", // home page, since we don't need a specific one
    };

    const resp = await fetch(url, {
        body: JSON.stringify(data),
        headers: {
            'Content-Type': 'application/json'
        },
        method: "POST",
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Innertube channel browse request failed: Got response code ${resp.status} ${resp.statusText}${isBodyGarbage(body) ? "" : ` with body ${body}`}`);
    }
    const resolved = await resp.json();
    return resolved.microformat.microformatDataRenderer.title;
}

export function fetchChannelName(ucid: ChannelID): PeekPromise<string | null> {
    const entry = channelNameFromUcidCache.setupCache(ucid);
    entry.data ??= new PeekPromise(doFetchChannelName(ucid).catch(err => {
        console.error(`[maze-utils] Innertube channel browse request for UCID ${ucid} failed:`, err)
        return null;
    }))
    channelNameFromUcidCache.cacheUsed(ucid);
    return entry.data;
}

export function getChannelNameFromVideo(videoID: VideoID): PeekPromise<string | null> {
    const entry = channelNameFromVideoCache.setupCache(videoID);
    entry.data ??= new PeekPromise((async () => {
        const ucid = await getUcidFromVideo(videoID);
        if (ucid === null) return null;
        return await fetchChannelName(ucid);
    })())
    channelNameFromVideoCache.cacheUsed(videoID);
    return entry.data;
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
