import type * as MediaSession from "../src/injected/mediaSession";

class TestMediaMetadata {
    constructor(private readonly data: MediaMetadataInit = {}) {}

    get title() { return this.data.title ?? ""; }
    get artist() { return this.data.artist ?? ""; }
    get album() { return this.data.album ?? ""; }
    get artwork() { return this.data.artwork ?? []; }
}

describe("Media Session state", () => {
    const originalGlobals = new Map(["navigator", "MediaMetadata"].map((name) => [
        name, Object.getOwnPropertyDescriptor(globalThis, name)
    ]));
    let mediaSession: typeof MediaSession;

    function setPageMetadata(title: string, artist: string, artwork: string) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title, artist, artwork: [{ src: artwork }]
        });
    }

    beforeEach(async () => {
        jest.resetModules();
        jest.useFakeTimers();
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { mediaSession: { metadata: null } }
        });
        Object.defineProperty(globalThis, "MediaMetadata", {
            configurable: true,
            value: TestMediaMetadata
        });
        mediaSession = await import("../src/injected/mediaSession");
        setPageMetadata("Original A", "Artist A", "https://example.com/a.jpg");
        mediaSession.setMediaSessionInfo({ title: "Custom A" });
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    afterAll(() => {
        for (const [name, descriptor] of originalGlobals) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        }
    });

    it("preserves the new video's title on an artwork-only update", () => {
        jest.advanceTimersByTime(500);
        mediaSession.resetMediaSessionState();
        setPageMetadata("Original B", "Artist B", "https://example.com/b.jpg");
        mediaSession.setMediaSessionInfo({
            artwork: [{ src: "https://dearrow-thumb.example.com/b.jpg" }]
        });
        jest.advanceTimersByTime(500);

        expect(navigator.mediaSession.metadata?.title.trim()).toBe("Original B");
        expect(navigator.mediaSession.metadata?.artist).toBe("Artist B");
        expect(navigator.mediaSession.metadata?.artwork[0].src).toBe("https://dearrow-thumb.example.com/b.jpg");
    });

    it("does not retry the previous video's metadata after a reset", () => {
        mediaSession.resetMediaSessionState();
        setPageMetadata("Original B", "Artist B", "https://example.com/b.jpg");
        jest.advanceTimersByTime(500);

        expect(navigator.mediaSession.metadata?.title).toBe("Original B");
        expect(navigator.mediaSession.metadata?.artist).toBe("Artist B");
        expect(navigator.mediaSession.metadata?.artwork[0].src).toBe("https://example.com/b.jpg");
    });

    it("restores the new video's thumbnail without reviving an old title", () => {
        jest.advanceTimersByTime(500);
        mediaSession.resetMediaSessionState();
        setPageMetadata("Original B", "Artist B", "https://example.com/b.jpg");
        mediaSession.setMediaSessionInfo({
            artwork: [{ src: "https://dearrow-thumb.example.com/b.jpg" }]
        });
        setPageMetadata("Original B", "Artist B", "https://example.com/b.jpg");
        mediaSession.resetMediaSessionThumbnail();
        jest.advanceTimersByTime(500);

        expect(navigator.mediaSession.metadata?.title.trim()).toBe("Original B");
        expect(navigator.mediaSession.metadata?.artist).toBe("Artist B");
        expect(navigator.mediaSession.metadata?.artwork[0].src).toBe("https://example.com/b.jpg");
    });

    it("preserves the current video's custom title when restoring its thumbnail", () => {
        mediaSession.setMediaSessionInfo({
            artwork: [{ src: "https://dearrow-thumb.example.com/a.jpg" }]
        });
        mediaSession.resetMediaSessionThumbnail();
        jest.advanceTimersByTime(500);

        expect(navigator.mediaSession.metadata?.title.trim()).toBe("Custom A");
        expect(navigator.mediaSession.metadata?.artist).toBe("Artist A");
        expect(navigator.mediaSession.metadata?.artwork[0].src).toBe("https://example.com/a.jpg");
    });
});
