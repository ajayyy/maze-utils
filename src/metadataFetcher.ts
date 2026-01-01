import { DataCache, PeekPromise } from "./cache";
import { addCleanupListener } from "./cleanup";
import { isSafari } from "./config";
import { isBodyGarbage } from "./formating";
import { onMobile } from "./pageInfo";
import type { ChannelID, VideoID } from "./video";
import { version } from "./version.json";
import { versionHigher } from "./versionHigher";

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

interface Request {
    type: "oembed" | "resolve" | "browse";
    query: string;
}

type Response = {
    result: OembedData | string | null;
    lastUsed: number;
} & Request;

interface FetcherMessageSimple {
    type: "init" | "leaderAlive" | "triggerElection";
}

interface FetcherMessageLeaderIdentify {
    type: "meIsLeader";
    version: string;
}

interface FetcherMessageRequest {
    type: "request" | "cacheBump";
    request: Request;
}

interface FetcherMessageCacheUpdate {
    type: "cacheUpdate";
    updates: Response[];
}

interface FetcherMessageElection {
    type: "submitElection" | "restartElection";
    version: string;
    random: number;
}

type FetcherMessage = FetcherMessageSimple | FetcherMessageLeaderIdentify | FetcherMessageRequest | FetcherMessageCacheUpdate | FetcherMessageElection;

type QueuedRequest = {
    resolve: (data: OembedData | string | null) => void;
    reject: (error: Error) => void;
} & Request;

// the video module has not been initialized yet - fetcher is working independently
interface FetcherStatusDetached {
    stage: "detached";
}

// the fetcher has just joined the channel and is awaiting a response from an already elected leader
// requests are queued without being processed
interface FetcherStatusInitial {
    stage: "init";
    channel: BroadcastChannel;
    requestTimeout: NodeJS.Timeout;
}

// an election has been triggered and is in progress
// the most up-to-date instance will win - in case of a tie, the instance that gets the highest random number wins
// requests are queued without being processed
interface FetcherStatusElection {
    stage: "election";
    channel: BroadcastChannel;
    random: number;
    winning: boolean;
    attempts: number;
    // when this expires, if this instance won, broadcast results
    concludeTimeout: NodeJS.Timeout;
    // when this expires and we're still in election mode, trigger election again
    retriggerTimeout: NodeJS.Timeout;
}

// this instance was picked as the leader and will process requests from all instances
interface FetcherStatusLeader {
    stage: "leader";
    channel: BroadcastChannel;
    keepaliveInterval: NodeJS.Timer;
}

// a different instance was picked as the leader - this instance will redirect fetches to the leader
interface FetcherStatusPassive {
    stage: "passive";
    channel: BroadcastChannel;
    keepaliveReceived: boolean;
    keepaliveCheckInterval: NodeJS.Timer;
}

type FetcherCache<Key extends string, Value> = DataCache<Key, { data: PeekPromise<Value | null> | null }>;
interface FetcherState {
    status: FetcherStatusDetached | FetcherStatusInitial | FetcherStatusElection | FetcherStatusLeader | FetcherStatusPassive;
    cache: {
        // single-fetch, shared between maze-utils instances
        basic: {
            oembed: FetcherCache<VideoID, OembedData>;
            resolveChannel: FetcherCache<string, ChannelID>;
            channelName: FetcherCache<ChannelID, string>;
        };
        // chained fetched cached above, not shared
        chained: {
            ucidFromVideo: FetcherCache<VideoID, ChannelID>;
            nameFromVideo: FetcherCache<VideoID, string>;
        };
    };
    pendingRequests: Map<string, QueuedRequest[]>;
    queuedRequests: QueuedRequest[];
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
const fetcherState: FetcherState = {
    status: {
        stage: "detached",
    },
    cache: {
        basic: {
            oembed: new DataCache(() => ({ data: null })),
            resolveChannel: new DataCache(() => ({ data: null })),
            channelName: new DataCache(() => ({ data: null })),
        },
        chained: {
            ucidFromVideo: new DataCache(() => ({ data: null })),
            nameFromVideo: new DataCache(() => ({ data: null })),
        },
    },
    pendingRequests: new Map(),
    queuedRequests: [],
};


// attaches the fetcher to the shared broadcast channel, enabling cache sharing
function attachFetcher() {
    if (fetcherState.status.stage !== "detached") return;
    const channel = new BroadcastChannel("maze-utils:metadata-fetcher");
    channel.addEventListener("message", onFetcherMessage)
    clearFetcherStateIntervals();
    fetcherState.status = {
        stage: "init",
        channel,
        requestTimeout: setTimeout(() => {
            if (fetcherState.status.stage === "init") {
                console.debug("[maze-utils/fetcher] no response after 500ms, triggering election")
                runFetcherElection()
            }
        }, 500),
    };
    channel.postMessage({ type: "init" } as FetcherMessage);
    console.debug("[maze-utils/fetcher] attaching: init message sent")
}

// detaches the fetcher from the shared broadcast channel
function detachFetcher() {
    console.debug("[maze-utils/fetcher] detaching")
    clearFetcherStateIntervals();
    // if we are the leader, trigger an election
    if (fetcherState.status.stage === "leader") {
        fetcherState.status.channel.postMessage({ type: "triggerElection" } as FetcherMessage);
    }
    // transition to detached state, if not detached already
    if (fetcherState.status.stage !== "detached") {
        fetcherState.status.channel.close();
        fetcherState.status = {
            stage: "detached",
        }
    }
}

function clearFetcherStateIntervals() {
    switch(fetcherState.status.stage) {
        case "leader":
            clearInterval(fetcherState.status.keepaliveInterval)
            break;
        case "passive":
            clearInterval(fetcherState.status.keepaliveCheckInterval);
            break;
        case "init":
            clearTimeout(fetcherState.status.requestTimeout);
            break;
        case "election":
            clearTimeout(fetcherState.status.retriggerTimeout);
            clearTimeout(fetcherState.status.concludeTimeout);
            break;
    }
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
function trustmebro<T>(val: unknown): asserts val is T {}

interface ElectionParams {
    message?: FetcherMessageElection,
    restart?: boolean,
}
function runFetcherElection(params?: ElectionParams) {
    // if detached, don't care
    if (fetcherState.status.stage === "detached") return;
    clearFetcherStateIntervals();
    if (fetcherState.status.stage === "election") {
        // election retry
        fetcherState.status.attempts += 1;
        console.debug(`[maze-utils/fetcher] election triggered: attempt #${fetcherState.status.attempts+1}`)
    } else {
        // new election
        fetcherState.status = {
            stage: "election",
            channel: fetcherState.status.channel,
            random: 0,
            attempts: 0,
            concludeTimeout: 0 as unknown as NodeJS.Timeout,
            retriggerTimeout: 0 as unknown as NodeJS.Timeout,
            winning: true,
        }
    }
    trustmebro<FetcherStatusElection>(fetcherState.status);
    if (fetcherState.status.attempts > 3) {
        console.error("[maze-utils/fetcher] election attempt limit reached: detaching");
        detachFetcher();
        return;
    }
    
    // generate common values
    fetcherState.status.winning = true;
    const rng = new Int32Array(1);
    crypto.getRandomValues(rng);
    fetcherState.status.random = Math.random();
    fetcherState.status.concludeTimeout = setTimeout(() => {
        if (fetcherState.status.stage === "election" && fetcherState.status.winning) {
            console.debug("[maze-utils/fetcher] we won the election, broadcasting result");
            fetcherState.status.channel.postMessage({
                type: "meIsLeader",
                version,
            } as FetcherMessage)
            // wait a bit for any election retriggers
            setTimeout(processFetcherQueue, 200);
            clearFetcherStateIntervals();
            fetcherState.status = {
                stage: "leader",
                channel: fetcherState.status.channel,
                keepaliveInterval: setInterval(() => {
                    if (fetcherState.status.stage === "leader") {
                        fetcherState.status.channel.postMessage({ type: "leaderAlive" } as FetcherMessage);
                    }
                }, 5000),
            }
        }
    }, 500 + 200 * Math.random());
    fetcherState.status.retriggerTimeout = setTimeout(() => {
        if (fetcherState.status.stage === "election") {
            console.warn("[maze-utils/fetcher] noone claimed the election win, retriggering");
            runFetcherElection({restart: true});
        }
    }, 2000 + 200 * Math.random());

    if (params?.message !== undefined) {
        // we got the first election trigger, let's check if we have any chance
        fetcherState.status.winning = versionHigher(version, params.message.version) || (fetcherState.status.random > params.message.random && !versionHigher(params.message.version, version));
    }
    // broadcast our election data
    if (fetcherState.status.winning) {
        fetcherState.status.channel.postMessage({
            type: params?.restart === true ? "restartElection" : "submitElection",
            version,
            random: fetcherState.status.random,
        } as FetcherMessage);
    }
    console.debug(`[maze-utils/fetcher] election status, winning: ${fetcherState.status.winning}`);
}

function processFetcherQueue() {
    if (fetcherState.status.stage === "election" || fetcherState.status.stage === "init") return;
    const queue = fetcherState.queuedRequests;
    fetcherState.queuedRequests = [];
    if (fetcherState.status.stage === "passive") {
        for (const req of queue) {
            const key = `${req.type}+${req.query}`;
            const pending = fetcherState.pendingRequests.get(key);
            if (pending != null) {
                pending.push(req);
            } else {
                fetcherState.pendingRequests.set(key, [req]);
            }

            fetcherState.status.channel.postMessage({
                type: "request",
                request: {
                    type: req.type,
                    query: req.query,
                }
            } as FetcherMessage)
        }
    } else {
        for (const req of queue) {
            switch (req.type) {
                case "oembed": {
                    doFetchOembed(req.query as VideoID).catch(err => {
                        console.error(`[maze-utils] OEmbed data request for video ${req.query} failed:`, err)
                        return null;
                    }).then(req.resolve, req.reject);
                    break;
                }
                case "resolve": {
                    doResolveHandle(req.query).catch(err => {
                        console.error(`[maze-utils] Innertube resolve URL request for channel handle ${req.query} failed:`, err)
                        return null;
                    }).then(req.resolve, req.reject);
                    break;
                }
                case "browse": {
                    doFetchChannelName(req.query as ChannelID).catch(err => {
                        console.error(`[maze-utils] Innertube channel browse request for UCID ${req.query} failed:`, err)
                        return null;
                    }).then(req.resolve, req.reject);
                    break;
                }
            }
        }
    }
}

function onFetcherMessage(event: MessageEvent<FetcherMessage>) {
    switch(event.data.type) {
        case "init": {
            // only respond if we're the leader
            if (fetcherState.status.stage !== "leader") return;
            console.debug("[maze-utils/fetcher] received an init request");
            fetcherState.status.channel.postMessage({
                type: "meIsLeader",
                version,
            } as FetcherMessage);
            fetcherState.status.channel.postMessage({
                type: "cacheUpdate",
                updates: [
                    ...Object.entries(fetcherState.cache.basic.oembed.cache)
                        .map(([vid, data]) => ({
                            type: "oembed",
                            query: vid,
                            result: data.data?.peek(),
                            lastUsed: data.lastUsed,
                        }))
                        .filter(({ result }) => result != null),
                    ...Object.entries(fetcherState.cache.basic.resolveChannel.cache)
                        .map(([vid, data]) => ({
                            type: "resolve",
                            query: vid,
                            result: data.data?.peek(),
                            lastUsed: data.lastUsed,
                        }))
                        .filter(({ result }) => result != null),
                    ...Object.entries(fetcherState.cache.basic.channelName.cache)
                        .map(([vid, data]) => ({
                            type: "browse",
                            query: vid,
                            result: data.data?.peek(),
                            lastUsed: data.lastUsed,
                        }))
                        .filter(({ result }) => result != null),
                ],
            } as FetcherMessage);
            break;
        }
        case "leaderAlive": {
            if (fetcherState.status.stage === "passive") {
                // mark keepalive as received
                fetcherState.status.keepaliveReceived = true;
            } else if (fetcherState.status.stage === "leader") {
                // looks like we've got a leader conflict, run an election
                console.warn("[maze-utils/fetcher] received a leader keepalive, but we're the leader - triggering election")
                runFetcherElection();
            }
            break;
        }
        case "triggerElection": {
            if (fetcherState.status.stage === "election") return;
            console.debug("[maze-utils/fetcher] received a trigger election request");
            runFetcherElection();
            break;
        }
        case "meIsLeader": {
            if (fetcherState.status.stage === "leader") {
                // someone's claiming leader when we're already leading - trigger election
                console.warn("[maze-utils/fetcher] leader conflict - triggering election");
                runFetcherElection();
            } else if (fetcherState.status.stage === "election" && fetcherState.status.winning) {
                // someone's claiming the win when we're winning - restart election
                console.warn("[maze-utils/fetcher] election fraud - restarting election");
                runFetcherElection({restart: true});
            } else if (fetcherState.status.stage === "init" || fetcherState.status.stage === "election") {
                console.debug("[maze-utils/fetcher] election/init concluded - someone claimed leader")
                setTimeout(processFetcherQueue, 200);
                clearFetcherStateIntervals();
                fetcherState.status = {
                    stage: "passive",
                    channel: fetcherState.status.channel,
                    keepaliveReceived: true,
                    keepaliveCheckInterval: setInterval(() => {
                        if (fetcherState.status.stage === "passive" && !fetcherState.status.keepaliveReceived) {
                            // no keepalive, trigger election
                            console.warn("[maze-utils/fetcher] no leader keepalive received - triggering election");
                            runFetcherElection();
                        }
                    }, 7000 + 3000 * Math.random()),
                }
            }
            break;
        }
        case "submitElection": {
            if (fetcherState.status.stage === "election") {
                fetcherState.status.winning &&= versionHigher(version, event.data.version) || (fetcherState.status.random > event.data.random && !versionHigher(event.data.version, version));
            } else {
                runFetcherElection({ message: event.data });
            }
            break;
        }
        case "restartElection": {
            runFetcherElection({ message: event.data });
            break;
        }
        case "cacheUpdate": {
            for (const update of event.data.updates) {
                switch (update.type) {
                    case "oembed": {
                        const entry = fetcherState.cache.basic.oembed.setupCache(update.query as VideoID);
                        entry.data = new PeekPromise(Promise.resolve(update.result as OembedData));
                        entry.lastUsed = update.lastUsed;
                        break;
                    }
                    case "resolve": {
                        const entry = fetcherState.cache.basic.resolveChannel.setupCache(update.query);
                        entry.data = new PeekPromise(Promise.resolve(update.result as ChannelID));
                        entry.lastUsed = update.lastUsed;
                        break;
                    }
                    case "browse": {
                        const entry = fetcherState.cache.basic.channelName.setupCache(update.query as ChannelID);
                        entry.data = new PeekPromise(Promise.resolve(update.result as string));
                        entry.lastUsed = update.lastUsed;
                        break;
                    }
                }

                const key = `${update.type}+${update.query}`;
                const pending = fetcherState.pendingRequests.get(key);
                fetcherState.pendingRequests.delete(key);
                for (const request of pending ?? []) {
                    request.resolve(update.result);
                }
            }
            break;
        }
        case "cacheBump": {
            switch (event.data.request.type) {
                case "oembed":
                    fetcherState.cache.basic.oembed.cacheUsed(event.data.request.query as VideoID);
                    break;
                case "resolve":
                    fetcherState.cache.basic.resolveChannel.cacheUsed(event.data.request.query);
                    break;
                case "browse":
                    fetcherState.cache.basic.channelName.cacheUsed(event.data.request.query as ChannelID);
                    break;
            }
            break;
        }
        case "request": {
            if (fetcherState.status.stage !== "leader") return;
            switch (event.data.request.type) {
                case "oembed": {
                    const entry = fetcherState.cache.basic.oembed.getFromCache(event.data.request.query as VideoID);
                    if (entry?.data?.isReady()) {
                        fetcherState.status.channel.postMessage({
                            type: "cacheUpdate",
                            updates: [
                                {
                                    type: "oembed",
                                    query: event.data.request.query,
                                    result: entry.data.peek(),
                                    lastUsed: entry.lastUsed
                                }
                            ]
                        } as FetcherMessage);
                    } else if (entry == null) {
                        void fetchOembed(event.data.request.query as VideoID);
                    }
                    break;
                }
                case "resolve": {
                    const entry = fetcherState.cache.basic.resolveChannel.getFromCache(event.data.request.query);
                    if (entry?.data?.isReady()) {
                        fetcherState.status.channel.postMessage({
                            type: "cacheUpdate",
                            updates: [
                                {
                                    type: "resolve",
                                    query: event.data.request.query,
                                    result: entry.data.peek(),
                                    lastUsed: entry.lastUsed
                                }
                            ]
                        } as FetcherMessage);
                    } else if (entry == null) {
                        void resolveHandle(event.data.request.query);
                    }
                    break;
                }
                case "browse": {
                    const entry = fetcherState.cache.basic.channelName.getFromCache(event.data.request.query as ChannelID);
                    if (entry?.data?.isReady()) {
                        fetcherState.status.channel.postMessage({
                            type: "cacheUpdate",
                            updates: [
                                {
                                    type: "browse",
                                    query: event.data.request.query,
                                    result: entry.data.peek(),
                                    lastUsed: entry.lastUsed
                                }
                            ]
                        } as FetcherMessage);
                    } else if (entry == null) {
                        void fetchChannelName(event.data.request.query as ChannelID);
                    }
                    break;
                }
            }
            break;
        }
    }
}

function bumpRemoteCaches(type: Request["type"], query: string) {
    if (fetcherState.status.stage === "detached") return;
    fetcherState.status.channel.postMessage({
        type: "cacheBump",
        request: { type, query },
    } as FetcherMessage);
}

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

    window.addEventListener("pagehide", detachFetcher);
    window.addEventListener("pageshow", attachFetcher);
    attachFetcher();

    addCleanupListener(() => {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("pagehide", detachFetcher);
        window.removeEventListener("pageshow", attachFetcher);
        detachFetcher();
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

function requestOembed(videoID: VideoID): Promise<OembedData | null> {
    if (fetcherState.status.stage === "leader" || fetcherState.status.stage === "detached") {
        return doFetchOembed(videoID).catch(err => {
            console.error(`[maze-utils] OEmbed data request for video ${videoID} failed:`, err)
            return null;
        }).then(res => {
            if (fetcherState.status.stage !== "detached") {
                fetcherState.status.channel.postMessage({
                    type: "cacheUpdate",
                    updates: [{
                        type: "oembed",
                        query: videoID,
                        lastUsed: Date.now(),
                        result: res,
                    }]
                } as FetcherMessage)
            }
            return res;
        });
    }
    return new Promise((res, rej) => {
        const req: QueuedRequest = {
            type: "oembed",
            query: videoID,
            resolve: res as QueuedRequest["resolve"],
            reject: rej,
        }
        if (fetcherState.status.stage === "passive") {
            const key = `oembed+${videoID}`;
            const queue = fetcherState.pendingRequests.get(key);
            if (queue != null) {
                queue.push(req);
            } else {
                fetcherState.pendingRequests.set(key, [req]);
            }
            fetcherState.status.channel.postMessage({
                type: "request",
                request: {
                    type: req.type,
                    query: req.query,
                }
            } as FetcherMessage)
        } else {
            fetcherState.queuedRequests.push(req);
        }
    })
}

export function fetchOembed(videoID: VideoID): PeekPromise<OembedData | null> {
    const entry = fetcherState.cache.basic.oembed.setupCache(videoID);
    entry.data ??= new PeekPromise(requestOembed(videoID))
    fetcherState.cache.basic.oembed.cacheUsed(videoID);
    bumpRemoteCaches("oembed", videoID);
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

function requestResolveHandle(channelHandle: string): Promise<ChannelID | null> {
    if (fetcherState.status.stage === "leader" || fetcherState.status.stage === "detached") {
        return doResolveHandle(channelHandle).catch(err => {
            console.error(`[maze-utils] Innertube resolve URL request for channel handle ${channelHandle} failed:`, err)
            return null;
        }).then(res => {
            if (fetcherState.status.stage !== "detached") {
                fetcherState.status.channel.postMessage({
                    type: "cacheUpdate",
                    updates: [{
                        type: "resolve",
                        query: channelHandle,
                        lastUsed: Date.now(),
                        result: res,
                    }]
                } as FetcherMessage)
            }
            return res;
        });
    }
    return new Promise((res, rej) => {
        const req: QueuedRequest = {
            type: "resolve",
            query: channelHandle,
            resolve: res as QueuedRequest["resolve"],
            reject: rej,
        }
        if (fetcherState.status.stage === "passive") {
            const key = `resolve+${channelHandle}`;
            const queue = fetcherState.pendingRequests.get(key);
            if (queue != null) {
                queue.push(req);
            } else {
                fetcherState.pendingRequests.set(key, [req]);
            }
            fetcherState.status.channel.postMessage({
                type: "request",
                request: {
                    type: req.type,
                    query: req.query,
                }
            } as FetcherMessage)
        } else {
            fetcherState.queuedRequests.push(req);
        }
    })
}

export function resolveHandle(channelHandle: string): PeekPromise<ChannelID | null> {
    const entry = fetcherState.cache.basic.resolveChannel.setupCache(channelHandle);
    entry.data ??= new PeekPromise(requestResolveHandle(channelHandle));
    fetcherState.cache.basic.resolveChannel.cacheUsed(channelHandle);
    bumpRemoteCaches("resolve", channelHandle);
    return entry.data;
}

export function getUcidFromVideo(videoID: VideoID): PeekPromise<ChannelID | null> {
    const entry = fetcherState.cache.chained.ucidFromVideo.setupCache(videoID);
    entry.data ??= new PeekPromise((async () => {
        const oembedData = await fetchOembed(videoID);
        if (oembedData?.parsed.channelHandle == null) return null;
        return await resolveHandle(oembedData.parsed.channelHandle);
    })())
    fetcherState.cache.chained.ucidFromVideo.cacheUsed(videoID);
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

function requestFetchChannelName(ucid: ChannelID): Promise<string | null> {
    if (fetcherState.status.stage === "leader" || fetcherState.status.stage === "detached") {
        return doFetchChannelName(ucid).catch(err => {
            console.error(`[maze-utils] Innertube channel browse request for UCID ${ucid} failed:`, err)
            return null;
        }).then(res => {
            if (fetcherState.status.stage !== "detached") {
                fetcherState.status.channel.postMessage({
                    type: "cacheUpdate",
                    updates: [{
                        type: "browse",
                        query: ucid,
                        lastUsed: Date.now(),
                        result: res,
                    }]
                } as FetcherMessage)
            }
            return res;
        });
    }
    return new Promise((res, rej) => {
        const req: QueuedRequest = {
            type: "browse",
            query: ucid,
            resolve: res as QueuedRequest["resolve"],
            reject: rej,
        }
        if (fetcherState.status.stage === "passive") {
            const key = `browse+${ucid}`;
            const queue = fetcherState.pendingRequests.get(key);
            if (queue != null) {
                queue.push(req);
            } else {
                fetcherState.pendingRequests.set(key, [req]);
            }
            fetcherState.status.channel.postMessage({
                type: "request",
                request: {
                    type: req.type,
                    query: req.query,
                }
            } as FetcherMessage)
        } else {
            fetcherState.queuedRequests.push(req);
        }
    })
}

export function fetchChannelName(ucid: ChannelID): PeekPromise<string | null> {
    const entry = fetcherState.cache.basic.channelName.setupCache(ucid);
    entry.data ??= new PeekPromise(requestFetchChannelName(ucid))
    fetcherState.cache.basic.channelName.cacheUsed(ucid);
    bumpRemoteCaches("browse", ucid);
    return entry.data;
}

export function getChannelNameFromVideo(videoID: VideoID): PeekPromise<string | null> {
    const entry = fetcherState.cache.chained.nameFromVideo.setupCache(videoID);
    entry.data ??= new PeekPromise((async () => {
        const ucid = await getUcidFromVideo(videoID);
        if (ucid === null) return null;
        return await fetchChannelName(ucid);
    })())
    fetcherState.cache.chained.nameFromVideo.cacheUsed(videoID);
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
