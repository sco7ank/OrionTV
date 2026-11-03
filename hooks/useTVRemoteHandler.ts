import { useEffect, useRef, useCallback } from "react";
import { Dimensions, useTVEventHandler, TVEventControl, HWEvent } from "react-native";
import usePlayerStore from "@/stores/playerStore";

const SEEK_STEP = 20 * 1000;
const CONTROLS_TIMEOUT = 5000;
const PAN_EVENT_GUARD_MS = 700;

export const useTVRemoteHandler = () => {
  const { showControls, setShowControls, showEpisodeModal, togglePlayPause, seek, status, startScrubbing, updateScrubbing, finishScrubbing } = usePlayerStore();
  const controlsTimer = useRef<NodeJS.Timeout | null>(null);
  const fastForwardIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPanAtRef = useRef(0);
  const lastPanXRef = useRef(0);
  const panScrubActiveRef = useRef(false);

  useEffect(() => {
    TVEventControl.enableTVPanGesture();
    return () => TVEventControl.disableTVPanGesture();
  }, []);

  const resetTimer = useCallback(() => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), CONTROLS_TIMEOUT);
  }, [setShowControls]);

  useEffect(() => {
    if (showControls) {
      resetTimer();
    } else if (controlsTimer.current) {
      clearTimeout(controlsTimer.current);
      controlsTimer.current = null;
    }
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [showControls, resetTimer]);

  useEffect(() => () => {
    if (fastForwardIntervalRef.current) clearInterval(fastForwardIntervalRef.current);
  }, []);

  const handleTVEvent = useCallback((event: HWEvent) => {
    if (showEpisodeModal) return;

    // tvOS may emit both a continuous pan and a directional event for one swipe.
    // Treat the pan as the source of truth and swallow the duplicate direction event.
    if (event.eventType === "pan") {
      lastPanAtRef.current = Date.now();
      const body = event.body;
      if (!body) return;

      if (body.state === "Began") {
        lastPanXRef.current = 0;
        panScrubActiveRef.current = false;
        return;
      }

      if (body.state === "Changed") {
        if (showEpisodeModal || !status?.isLoaded || !status.durationMillis) return;
        const x = body.x || 0;
        const y = body.y || 0;

        // Only claim clearly horizontal gestures; vertical swipes remain UI navigation.
        if (!panScrubActiveRef.current) {
          if (Math.abs(x) < 8 || Math.abs(x) <= Math.abs(y)) return;
          panScrubActiveRef.current = true;
          lastPanXRef.current = 0;
          startScrubbing();
        }

        const deltaX = x - lastPanXRef.current;
        lastPanXRef.current = x;
        const speedMultiplier = 1 + Math.min(Math.abs(body.velocityX || 0) / 1600, 1.5);
        const pixelsPerFullDuration = Dimensions.get("window").width * 2.2;
        const deltaMillis = deltaX * (status.durationMillis / pixelsPerFullDuration) * speedMultiplier;
        updateScrubbing(deltaMillis);
        return;
      }

      if (body.state === "Ended") {
        resetTimer();
        if (panScrubActiveRef.current) {
          panScrubActiveRef.current = false;
          finishScrubbing();
          return;
        }
        const { velocityX = 0, velocityY = 0 } = body;
        if (Math.abs(velocityY) > Math.abs(velocityX) && Math.abs(velocityY) > 0.2) {
          if (velocityY > 0) setShowControls(true);
        }
      }
      return;
    }

    if (["up", "down", "left", "right"].includes(event.eventType) &&
        Date.now() - lastPanAtRef.current < PAN_EVENT_GUARD_MS) {
      return;
    }

    if (event.eventType === "longRight" || event.eventType === "longLeft") {
      if (event.eventKeyAction === 1 && fastForwardIntervalRef.current) {
        clearInterval(fastForwardIntervalRef.current);
        fastForwardIntervalRef.current = null;
      }
    }

    resetTimer();
    if (showControls) return;

    switch (event.eventType) {
      case "select":
      case "playPause":
        togglePlayPause();
        setShowControls(true);
        break;
      case "left":
        seek(-SEEK_STEP);
        break;
      case "right":
        seek(SEEK_STEP);
        break;
      case "longLeft":
        if (!fastForwardIntervalRef.current && event.eventKeyAction === 0) {
          fastForwardIntervalRef.current = setInterval(() => seek(-SEEK_STEP), 200);
        }
        break;
      case "longRight":
        if (!fastForwardIntervalRef.current && event.eventKeyAction === 0) {
          fastForwardIntervalRef.current = setInterval(() => seek(SEEK_STEP), 200);
        }
        break;
      case "down":
        setShowControls(true);
        break;
    }
  }, [showControls, showEpisodeModal, setShowControls, resetTimer, togglePlayPause, seek, status, startScrubbing, updateScrubbing, finishScrubbing]);

  useTVEventHandler(handleTVEvent);

  const onScreenPress = () => {
    const next = !showControls;
    setShowControls(next);
    if (next) resetTimer();
  };

  return { onScreenPress };
};
