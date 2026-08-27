"use client";

import type { SessionRecord } from "@supply-flow/core/session";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

interface SessionDetailResponse {
  session?: SessionRecord;
  output?: string;
  outputOffset?: number;
  outputSize?: number;
  outputTruncated?: boolean;
  transcript?: string;
  error?: string;
}

const OUTPUT_POLL_INTERVAL_MS = 100;
const OUTPUT_RETRY_INTERVAL_MS = 1_500;

export function TmuxTerminal({
  sessionEndpoint,
  session,
  onSessionUpdated,
  onSessionRemoved,
  onTerminalError,
  refreshRequestId,
  onTerminalRefreshComplete
}: {
  sessionEndpoint: string;
  session: SessionRecord;
  onSessionUpdated: (session: SessionRecord) => void;
  onSessionRemoved: () => void;
  onTerminalError: (message: string) => void;
  refreshRequestId: number | null;
  onTerminalRefreshComplete: (requestId: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionStatusRef = useRef(session.status);
  const onSessionUpdatedRef = useRef(onSessionUpdated);
  const onSessionRemovedRef = useRef(onSessionRemoved);
  const onTerminalErrorRef = useRef(onTerminalError);
  const onTerminalRefreshCompleteRef = useRef(onTerminalRefreshComplete);
  const liveViewportRef = useRef<HTMLDivElement>(null);
  const wheelRemainderRef = useRef(0);
  const [isReady, setIsReady] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);

  useEffect(() => {
    sessionStatusRef.current = session.status;
  }, [session.status]);

  useEffect(() => {
    onSessionUpdatedRef.current = onSessionUpdated;
  }, [onSessionUpdated]);

  useEffect(() => {
    onSessionRemovedRef.current = onSessionRemoved;
  }, [onSessionRemoved]);

  useEffect(() => {
    onTerminalErrorRef.current = onTerminalError;
  }, [onTerminalError]);

  useEffect(() => {
    onTerminalRefreshCompleteRef.current = onTerminalRefreshComplete;
  }, [onTerminalRefreshComplete]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let disposed = false;
    let inputDisposable: { dispose: () => void } | undefined;
    let resizeFrame: number | undefined;

    async function mountTerminal() {
      const [{ FitAddon }, { Terminal }] = await Promise.all([
        import("@xterm/addon-fit"),
        import("@xterm/xterm")
      ]);
      if (disposed || !containerRef.current) {
        return;
      }

      const terminal = new Terminal({
        allowTransparency: false,
        convertEol: false,
        cursorBlink: true,
        fontFamily: '"SF Mono", SFMono-Regular, Consolas, monospace',
        fontSize: 12,
        scrollback: 0,
        theme: {
          background: "#111412",
          black: "#111412",
          blue: "#7eb8ff",
          brightBlack: "#607068",
          brightBlue: "#a8caff",
          brightCyan: "#86e6e4",
          brightGreen: "#8ad4ac",
          brightMagenta: "#e5b6ed",
          brightRed: "#ffaaa1",
          brightWhite: "#ffffff",
          brightYellow: "#f8d78a",
          cursor: "#d9efe2",
          cursorAccent: "#111412",
          cyan: "#58c8c5",
          foreground: "#dbe7df",
          green: "#54b983",
          magenta: "#bf8aca",
          red: "#e5786f",
          selectionBackground: "rgba(217, 239, 226, 0.18)",
          white: "#dbe7df",
          yellow: "#d9ad50"
        }
      });
      const fitAddon = new FitAddon();

      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      fitAddon.fit();
      resizeFrame = window.requestAnimationFrame(() => fitAddon.fit());

      inputDisposable = terminal.onData((data) => {
        if (!isInteractiveStatus(sessionStatusRef.current)) {
          return;
        }

        void sendTerminalInput(sessionEndpoint, data).catch((error: unknown) => {
          onTerminalErrorRef.current(
            error instanceof Error ? error.message : "Unable to send terminal input."
          );
        });
      });
      setIsReady(true);
      terminal.focus();
    }

    void mountTerminal();
    return () => {
      disposed = true;
      if (resizeFrame !== undefined) {
        window.cancelAnimationFrame(resizeFrame);
      }
      inputDisposable?.dispose();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setIsReady(false);
    };
  }, [session.id, sessionEndpoint]);

  useEffect(() => {
    if (!isReady || !liveViewportRef.current) {
      return;
    }

    let resizeTimer: number | undefined;

    function resizeTerminal() {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!terminal || !fitAddon) {
        return;
      }

      fitAddon.fit();
      if (!isInteractiveStatus(sessionStatusRef.current)) {
        return;
      }

      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        void resizeTmuxTerminal(sessionEndpoint, terminal.cols, terminal.rows);
      }, 100);
    }

    const observer = new ResizeObserver(resizeTerminal);
    observer.observe(liveViewportRef.current);
    resizeTerminal();

    return () => {
      observer.disconnect();
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
    };
  }, [isReady, session.id, sessionEndpoint]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    let cancelled = false;
    let pollTimer: number | undefined;
    let outputOffset: number | undefined;
    let resetLiveTerminal = true;
    let refreshFromTmux = refreshRequestId !== null;
    let transcriptLoaded = false;

    function schedulePoll(delay: number) {
      if (!cancelled) {
        pollTimer = window.setTimeout(() => {
          void pollTerminal();
        }, delay);
      }
    }

    function scrollToBottomAfterRender() {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!cancelled) {
            const viewport = wrapperRef.current;
            viewport?.scrollTo({ top: viewport.scrollHeight });
          }
        });
      });
    }

    async function pollTerminal() {
      const terminal = terminalRef.current;
      if (!terminal || cancelled) {
        return;
      }

      const requestedTmuxRefresh = refreshFromTmux;
      refreshFromTmux = false;
      const includeTranscript = !transcriptLoaded || requestedTmuxRefresh;
      const shouldScrollToBottom = includeTranscript;
      if (requestedTmuxRefresh) {
        outputOffset = undefined;
        resetLiveTerminal = true;
      }

      try {
        const parameters = new URLSearchParams();
        if (outputOffset !== undefined) {
          parameters.set("offset", String(outputOffset));
        }
        if (includeTranscript) {
          parameters.set("transcript", "1");
        }
        const query = parameters.size ? `?${parameters}` : "";
        const response = await fetch(`${sessionEndpoint}${query}`, { cache: "no-store" });
        const data = (await response.json()) as SessionDetailResponse;
        if (response.status === 404) {
          onSessionRemovedRef.current();
          return;
        }
        if (!response.ok || !data.session) {
          throw new Error(data.error ?? "Unable to read terminal output.");
        }

        if (cancelled) {
          return;
        }

        if (includeTranscript && data.transcript !== undefined) {
          setTranscript(data.transcript || null);
          transcriptLoaded = true;
        }
        if (resetLiveTerminal || data.outputTruncated) {
          terminal.reset();
          resetLiveTerminal = false;
        }
        if (data.output) {
          await writeTerminalOutput(terminal, data.output);
        }
        if (shouldScrollToBottom) {
          scrollToBottomAfterRender();
        }
        if (cancelled) {
          return;
        }
        outputOffset = data.outputSize ?? outputOffset;
        onSessionUpdatedRef.current(data.session);

        if (isInteractiveStatus(data.session.status)) {
          schedulePoll(OUTPUT_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (!cancelled) {
          onTerminalErrorRef.current(
            error instanceof Error ? error.message : "Unable to read terminal output."
          );
          if (isInteractiveStatus(sessionStatusRef.current)) {
            schedulePoll(OUTPUT_RETRY_INTERVAL_MS);
          }
        }
      } finally {
        if (requestedTmuxRefresh && refreshRequestId !== null) {
          onTerminalRefreshCompleteRef.current(refreshRequestId);
        }
      }
    }

    void pollTerminal();
    return () => {
      cancelled = true;
      if (pollTimer) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [isReady, refreshRequestId, session.id, sessionEndpoint]);

  return (
    <div
      className="tmux-terminal-viewport"
      onWheelCapture={(event) => {
        const viewport = wrapperRef.current;
        if (!viewport) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        wheelRemainderRef.current += wheelPixels(
          event.deltaY,
          event.deltaMode,
          viewport.clientHeight
        );
        const pixels = Math.trunc(wheelRemainderRef.current);
        if (pixels !== 0) {
          viewport.scrollBy({ top: pixels });
          wheelRemainderRef.current -= pixels;
        }
      }}
      ref={wrapperRef}
    >
      {transcript ? <pre className="tmux-terminal-transcript">{transcript}</pre> : null}
      <div
        className="tmux-terminal-live"
        onMouseDown={() => terminalRef.current?.focus()}
        ref={liveViewportRef}
      >
        <div className="tmux-terminal-canvas" ref={containerRef} />
      </div>
    </div>
  );
}

function isInteractiveStatus(status: SessionRecord["status"]): boolean {
  return status === "starting" || status === "running";
}

function writeTerminalOutput(terminal: Terminal, output: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(output, resolve);
  });
}

function wheelPixels(deltaY: number, deltaMode: number, viewportHeight: number): number {
  if (deltaMode === 1) {
    return deltaY * 18;
  }
  if (deltaMode === 2) {
    return deltaY * viewportHeight;
  }
  return deltaY;
}

async function sendTerminalInput(sessionEndpoint: string, input: string): Promise<void> {
  const response = await fetch(`${sessionEndpoint}/stdin`, {
    body: JSON.stringify({ data: encodeBase64(input) }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  if (!response.ok) {
    const data = (await response.json()) as { error?: string };
    throw new Error(data.error ?? "Unable to send terminal input.");
  }
}

async function resizeTmuxTerminal(
  sessionEndpoint: string,
  columns: number,
  rows: number
): Promise<void> {
  await fetch(`${sessionEndpoint}/resize`, {
    body: JSON.stringify({ columns, rows }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
