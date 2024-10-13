import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type RefObject,
} from 'react';
import shaka from 'shaka-player';
import type { VideoRef, ReactVideoProps, VideoMetadata } from './types';

const Video = forwardRef<VideoRef, ReactVideoProps>(
  (
    {
      source,
      paused,
      muted,
      volume,
      rate,
      repeat,
      controls,
      showNotificationControls = false,
      poster,
      fullscreen,
      fullscreenAutorotate,
      fullscreenOrientation,
      onBuffer,
      onLoad,
      onProgress,
      // onPlaybackRateChange,
      onError,
      onReadyForDisplay,
      onSeek,
      // onVolumeChange,
      onEnd,
    },
    ref,
  ) => {
    const nativeRef = useRef<HTMLVideoElement>(null);
    const shakaPlayerRef = useRef<shaka.Player | null>(null);

    const seek = useCallback(
      (time: number, _tolerance?: number) => {
        if (isNaN(time)) {
          throw new Error('Specified time is not a number');
        }
        if (!shakaPlayerRef.current) {
          console.warn('Shaka Player is not initialized');
          return;
        }
        time = Math.max(
          0,
          Math.min(time, shakaPlayerRef.current.seekRange().end)
        );
        onSeek?.({
          seekTime: time,
          currentTime: nativeRef.current?.currentTime || 0,
        });
      },
      [onSeek],
    );

    const pause = useCallback(() => {
      if (!nativeRef.current) {
        return;
      }
      nativeRef.current.pause();
    }, []);

    const resume = useCallback(() => {
      if (!nativeRef.current) {
        return;
      }
      nativeRef.current.play();
    }, []);

    const setVolume = useCallback((vol: number) => {
      if (!nativeRef.current) {
        return;
      }
      nativeRef.current.volume = Math.max(0, Math.min(vol, 100)) / 100;
    }, []);

    const getCurrentPosition = useCallback(async () => {
      if (!nativeRef.current) {
        throw new Error('Video Component is not mounted');
      }
      return nativeRef.current.currentTime;
    }, []);

    const unsupported = useCallback(() => {
      throw new Error('This is unsupported on the web');
    }, []);

    // Stock this in a ref to not invalidate memoization when those changes.
    const fsPrefs = useRef({
      fullscreenAutorotate,
      fullscreenOrientation,
    });
    fsPrefs.current = {
      fullscreenOrientation,
      fullscreenAutorotate,
    };
    const setFullScreen = useCallback(
      (
        newVal: boolean,
        orientation?: ReactVideoProps['fullscreenOrientation'],
        autorotate?: boolean,
      ) => {
        orientation ??= fsPrefs.current.fullscreenOrientation;
        autorotate ??= fsPrefs.current.fullscreenAutorotate;

        const run = async () => {
          try {
            if (newVal) {
              await nativeRef.current?.requestFullscreen({
                navigationUI: 'hide',
              });
              if (orientation === 'all' || !orientation || autorotate) {
                screen.orientation.unlock();
              } else {
                await screen.orientation.lock(orientation);
              }
            } else {
              if (document.fullscreenElement) {
                await document.exitFullscreen();
              }
              screen.orientation.unlock();
            }
          } catch (e) {
            // Changing fullscreen status without a button click is not allowed so it throws.
            // Some browsers also used to throw when locking screen orientation was not supported.
            console.error('Could not toggle fullscreen/screen lock status', e);
          }
        };
        run();
      },
      [],
    );

    useEffect(() => {
      setFullScreen(
        fullscreen || false,
        fullscreenOrientation,
        fullscreenAutorotate,
      );
    }, [
      setFullScreen,
      fullscreen,
      fullscreenAutorotate,
      fullscreenOrientation,
    ]);

    const presentFullscreenPlayer = useCallback(
      () => setFullScreen(true),
      [setFullScreen],
    );
    const dismissFullscreenPlayer = useCallback(
      () => setFullScreen(false),
      [setFullScreen],
    );

    useImperativeHandle(
      ref,
      () => ({
        seek,
        pause,
        resume,
        setVolume,
        getCurrentPosition,
        presentFullscreenPlayer,
        dismissFullscreenPlayer,
        setFullScreen,
        save: unsupported,
        restoreUserInterfaceForPictureInPictureStopCompleted: unsupported,
        nativeHtmlVideoRef: nativeRef,
      }),
      [
        seek,
        pause,
        resume,
        unsupported,
        setVolume,
        getCurrentPosition,
        nativeRef,
        presentFullscreenPlayer,
        dismissFullscreenPlayer,
        setFullScreen,
      ],
    );

    useEffect(() => {
      if (paused) {
        pause();
      } else {
        resume();
      }
    }, [paused, pause, resume]);
    useEffect(() => {
      if (volume === undefined) {
        return;
      }
      setVolume(volume);
    }, [volume, setVolume]);

    // Handle playback rate changes
    useEffect(() => {
      if (!nativeRef.current || rate === undefined) {
        return;
      }
      nativeRef.current.playbackRate = rate;
    }, [rate]);

    // Initialize Shaka Player
    useEffect(() => {
      if (!nativeRef.current) {
        console.warn('Video component is not mounted');
        return;
      }

      // Initialize Shaka Player
      const player = new shaka.Player(nativeRef.current);
      shakaPlayerRef.current = player;

      // Error handling
      player.addEventListener('error', (event) => {
        //@ts-ignore
        const shakaError = event.detail;
        console.error('Shaka Player Error', shakaError);
        onError?.({
          error: {
            errorString: shakaError.message,
            code: shakaError.code,
          },
        });
      });

      // Buffering events
      player.addEventListener('buffering', (event) => {
        //@ts-ignore
        onBuffer?.({ isBuffering: event.buffering });
      });

      player.attach(mediaElement)

      // Load the video source
      player
        //@ts-ignore
        .load(source?.uri)
        .then(() => {
          // Media loaded successfully
          if (!nativeRef.current) return;

          const duration = nativeRef.current.duration;
          const naturalSize = {
            width: nativeRef.current.videoWidth,
            height: nativeRef.current.videoHeight,
            orientation:
              nativeRef.current.videoWidth > nativeRef.current.videoHeight
                ? 'landscape'
                : 'portrait',
          };

          onLoad?.({
            currentTime: nativeRef.current.currentTime,
            duration,
            //@ts-ignore
            naturalSize,
            //@ts-ignore
            videoTracks: player.getVariantTracks(),
            //@ts-ignore
            audioTracks: player.getVariantTracks(),
            //@ts-ignore
            textTracks: player.getTextTracks(),
          });

          onReadyForDisplay?.();
        })
        .catch((error: any) => {
          console.error('Error loading video', error);
          onError?.({ error });
        });

      return () => {
        // Cleanup
        if (shakaPlayerRef.current) {
          shakaPlayerRef.current.destroy();
          shakaPlayerRef.current = null;
        }
      };
    }, [source?.uri]);

    // Handle Media Session (if implemented)
    useMediaSession(source?.metadata, nativeRef, showNotificationControls);

    return (
      <video
        ref={nativeRef}
        muted={true}
        controls={controls}
        loop={repeat}
        playsInline
        //@ts-ignore
        poster={poster}
        onCanPlay={() => onBuffer?.({ isBuffering: false })}
        onWaiting={() => onBuffer?.({ isBuffering: true })}
        onTimeUpdate={() => {
          if (!nativeRef.current) {
            return;
          }
          onProgress?.({
            currentTime: nativeRef.current.currentTime,
            playableDuration: nativeRef.current.buffered.length
              ? nativeRef.current.buffered.end(
                  nativeRef.current.buffered.length - 1
                )
              : 0,
            seekableDuration: nativeRef.current.seekable.length
              ? nativeRef.current.seekable.end(
                  nativeRef.current.seekable.length - 1
                )
              : 0,
          });
        }}
        onEnded={onEnd}
        onError={() => {
          if (!nativeRef.current?.error) {
            return;
          }
          onError?.({
            error: {
              errorString:
                nativeRef.current.error.message || 'Unknown error',
              code: nativeRef.current.error.code,
            },
          });
        }}
        style={videoStyle}
      />
    );
  }
);

const videoStyle = {
  position: 'absolute',
  inset: 0,
  objectFit: 'contain',
  width: '100%',
  height: '100%',
} satisfies React.CSSProperties;

const useMediaSession = (
  metadata: VideoMetadata | undefined,
  nativeRef: RefObject<HTMLVideoElement>,
  showNotification: boolean,
) => {
  const isPlaying = !nativeRef.current?.paused ?? false;
  const progress = nativeRef.current?.currentTime ?? 0;
  const duration = Number.isFinite(nativeRef.current?.duration)
    ? nativeRef.current?.duration
    : undefined;
  const playbackRate = nativeRef.current?.playbackRate ?? 1;

  const enabled = 'mediaSession' in navigator && showNotification;

  useEffect(() => {
    if (enabled) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata?.title,
        artist: metadata?.artist,
        artwork: metadata?.imageUri ? [{src: metadata.imageUri}] : undefined,
      });
    }
  }, [enabled, metadata]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const seekTo = (time: number) => {
      if (nativeRef.current) {
        nativeRef.current.currentTime = time;
      }
    };

    const seekRelative = (offset: number) => {
      if (nativeRef.current) {
        nativeRef.current.currentTime = nativeRef.current.currentTime + offset;
      }
    };

    const mediaActions: [
      MediaSessionAction,
      MediaSessionActionHandler | null,
    ][] = [
      ['play', () => nativeRef.current?.play()],
      ['pause', () => nativeRef.current?.pause()],
      [
        'seekbackward',
        (evt: MediaSessionActionDetails) =>
          seekRelative(evt.seekOffset ? -evt.seekOffset : -10),
      ],
      [
        'seekforward',
        (evt: MediaSessionActionDetails) =>
          seekRelative(evt.seekOffset ? evt.seekOffset : 10),
      ],
      ['seekto', (evt: MediaSessionActionDetails) => seekTo(evt.seekTime!)],
    ];

    for (const [action, handler] of mediaActions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // ignored
      }
    }
  }, [enabled, nativeRef]);

  useEffect(() => {
    if (enabled) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying, enabled]);
  useEffect(() => {
    if (enabled && duration !== undefined) {
      navigator.mediaSession.setPositionState({
        position: Math.min(progress, duration),
        duration,
        playbackRate: playbackRate,
      });
    }
  }, [progress, duration, playbackRate, enabled]);
};

Video.displayName = 'Video';
export default Video;
