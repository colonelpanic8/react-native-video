import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from 'react';
//@ts-ignore
import shaka from 'shaka-player';
import type {VideoRef, ReactVideoProps, VideoMetadata} from './types';

// Action Queue Class
class ActionQueue {
  private queue: (() => Promise<void>)[] = [];
  private isRunning = false;

  enqueue(action: () => Promise<void>) {
    this.queue.push(action);
    this.runNext();
  }

  private async runNext() {
    if (this.isRunning || this.queue.length === 0) {
      return;
    }
    this.isRunning = true;
    const action = this.queue.shift();
    if (action) {
      try {
        await action();
      } catch (e) {
        console.error('Error in queued action:', e);
      } finally {
        this.isRunning = false;
        this.runNext();
      }
    }
  }
}

function shallowEqual(obj1: any, obj2: any) {
  // If both are strictly equal (covers primitive types and identical object references)
  if (obj1 === obj2) return true;

  // If one is not an object (meaning it's a primitive), they must be strictly equal
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
    return false;
  }

  // Get the keys of both objects
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  // If the number of keys is different, the objects are not equal
  if (keys1.length !== keys2.length) return false;

  // Check that all keys and their corresponding values are the same
  return keys1.every(key => {
    // If the value is an object, we fall back to reference equality (shallow comparison)
    return obj1[key] === obj2[key];
  });
}

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
      onPlaybackRateChange,
      onError,
      onReadyForDisplay,
      onSeek,
      onVolumeChange,
      onEnd,
      onPlaybackStateChanged,
    },
    ref,
  ) => {
    const nativeRef = useRef<HTMLVideoElement>(null);
    const shakaPlayerRef = useRef<shaka.Player | null>(null);
    const [currentSource, setCurrentSource] = useState<object | null>(null);
    const actionQueue = useRef(new ActionQueue());

    const isSeeking = useRef(false);

    const seek = useCallback(
      (time: number, _tolerance?: number) => {
        actionQueue.current.enqueue(async () => {
          if (isNaN(time)) {
            throw new Error('Specified time is not a number');
          }
          if (!nativeRef.current) {
            console.warn('Video Component is not mounted');
            return;
          }
          time = Math.max(0, Math.min(time, nativeRef.current.duration));
          nativeRef.current.currentTime = time;
          onSeek?.({
            seekTime: time,
            currentTime: nativeRef.current.currentTime,
          });
        });
      },
      [onSeek],
    );

    const pause = useCallback(() => {
      actionQueue.current.enqueue(async () => {
        if (!nativeRef.current) {
          return;
        }
        await nativeRef.current.pause();
      });
    }, []);

    const resume = useCallback(() => {
      actionQueue.current.enqueue(async () => {
        if (!nativeRef.current) {
          return;
        }
        try {
          await nativeRef.current.play();
        } catch (e) {
          console.error('Error playing video:', e);
        }
      });
    }, []);

    const setVolume = useCallback((vol: number) => {
      actionQueue.current.enqueue(async () => {
        if (!nativeRef.current) {
          return;
        }
        nativeRef.current.volume = Math.max(0, Math.min(vol, 100)) / 100;
      });
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

    // we use a ref to prevent triggerring the useEffect when the component rerender with a non-stable `onPlaybackStateChanged`.
    const playbackStateRef = useRef(onPlaybackStateChanged);
    playbackStateRef.current = onPlaybackStateChanged;
    useEffect(() => {
      // Not sure about how to do this but we want to wait for nativeRef to be initialized
      setTimeout(() => {
        if (!nativeRef.current) {
          return;
        }

        // Set play state to the player's value (if autoplay is denied)
        // This is useful if our UI is in a play state but autoplay got denied so
        // the video is actaully in a paused state.
        playbackStateRef.current?.({
          isPlaying: !nativeRef.current.paused,
          isSeeking: isSeeking.current,
        });
      }, 500);
    }, []);

    useEffect(() => {
      if (!nativeRef.current || rate === undefined) {
        return;
      }
      nativeRef.current.playbackRate = rate;
    }, [rate]);

    const makeNewShaka = useCallback(() => {
      actionQueue.current.enqueue(async () => {
        if (!nativeRef.current) {
          console.warn('No video element to attach Shaka Player');
          return;
        }

        // Pause the video before changing the source
        await nativeRef.current.pause();

        // Unload the previous Shaka player if it exists
        if (shakaPlayerRef.current) {
          await shakaPlayerRef.current.unload();
          shakaPlayerRef.current = null;
        }

        // Create a new Shaka player and attach it to the video element
        shakaPlayerRef.current = new shaka.Player(nativeRef.current);

        if (source?.cropStart) {
          shakaPlayerRef.current.configure({
            playRangeStart: source?.cropStart / 1000,
          });
        }
        if (source?.cropEnd) {
          shakaPlayerRef.current.configure({
            playRangeEnd: source?.cropEnd / 1000,
          });
        }

        shakaPlayerRef.current.addEventListener('error', event => {
          const shakaError = event.detail;
          console.error('Shaka Player Error', shakaError);
          onError?.({
            error: {
              errorString: shakaError.message,
              code: shakaError.code,
            },
          });
        });

        console.log('Initializing and attaching shaka');

        // Load the new source
        try {
          await shakaPlayerRef.current.load(source?.uri);
          console.log(`${source?.uri} finished loading`);

          // Optionally resume playback if not paused
          if (!paused) {
            try {
              await nativeRef.current.play();
            } catch (e) {
              console.error('Error playing video:', e);
            }
          }
        } catch (e) {
          console.error('Error loading video with Shaka Player', e);
          onError?.({
            error: {
              errorString: e.message,
              code: e.code,
            },
          });
        }
      });
    }, [source, paused, onError]);

    const nativeRefDefined = !!nativeRef.current;

    useEffect(() => {
      if (!nativeRef.current) {
        console.log('Not starting shaka yet because video element is undefined');
        return;
      }
      if (!shallowEqual(source, currentSource)) {
        console.log(
          'Making new shaka, Old source: ',
          currentSource,
          'New source',
          source,
        );
        setCurrentSource(source);
        makeNewShaka();
      }
    }, [source, nativeRefDefined, currentSource, makeNewShaka]);

    useMediaSession(source?.metadata, nativeRef, showNotificationControls);

    return (
      <video
        ref={nativeRef}
        muted={muted}
        autoPlay={!paused}
        controls={controls}
        loop={repeat}
        playsInline
        //@ts-ignore
        poster={poster}
        onCanPlay={() => onBuffer?.({isBuffering: false})}
        onWaiting={() => onBuffer?.({isBuffering: true})}
        onRateChange={() => {
          if (!nativeRef.current) {
            return;
          }
          onPlaybackRateChange?.({
            playbackRate: nativeRef.current?.playbackRate,
          });
        }}
        onDurationChange={() => {
          if (!nativeRef.current) {
            return;
          }
          onLoad?.({
            currentTime: nativeRef.current.currentTime,
            duration: nativeRef.current.duration,
            videoTracks: [],
            textTracks: [],
            audioTracks: [],
            naturalSize: {
              width: nativeRef.current.videoWidth,
              height: nativeRef.current.videoHeight,
              orientation: 'landscape',
            },
          });
        }}
        onTimeUpdate={() => {
          if (!nativeRef.current) {
            return;
          }
          onProgress?.({
            currentTime: nativeRef.current.currentTime,
            playableDuration: nativeRef.current.buffered.length
              ? nativeRef.current.buffered.end(
                  nativeRef.current.buffered.length - 1,
                )
              : 0,
            seekableDuration: 0,
          });
        }}
        onLoadedData={() => onReadyForDisplay?.()}
        onError={() => {
          if (!nativeRef.current?.error) {
            return;
          }
          onError?.({
            error: {
              errorString: nativeRef.current.error.message ?? 'Unknown error',
              code: nativeRef.current.error.code,
            },
          });
        }}
        onLoadedMetadata={() => {
          if (source?.startPosition) {
            seek(source.startPosition / 1000);
          }
        }}
        onPlay={() =>
          onPlaybackStateChanged?.({
            isPlaying: true,
            isSeeking: isSeeking.current,
          })
        }
        onPause={() =>
          onPlaybackStateChanged?.({
            isPlaying: false,
            isSeeking: isSeeking.current,
          })
        }
        onSeeking={() => (isSeeking.current = true)}
        onSeeked={() => (isSeeking.current = false)}
        onVolumeChange={() => {
          if (!nativeRef.current) {
            return;
          }
          onVolumeChange?.({volume: nativeRef.current.volume});
        }}
        onEnded={onEnd}
        style={videoStyle}
      />
    );
  },
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
