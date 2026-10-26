import Color from 'color';
import { FastAverageColor } from 'fast-average-color';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

import type { MusicPlayer } from '@/types/music-player';

// How high each layer rises, how wide its bumps are and how fast it drifts (radians per ms).
const LAYERS = [
  { height: 1, width: 0.011, speed: 0.0008, phase: 0 },
  { height: 0.8, width: 0.017, speed: -0.0011, phase: 2 },
  { height: 0.6, width: 0.008, speed: 0.0014, phase: 4 },
];
// The app icon's gradient, shown until the first cover is read.
const DEFAULT_COLORS = ['#ff6b2c', '#ff2fa6', '#7b3cff'];

const fastAverageColor = new FastAverageColor();

let playerApi: MusicPlayer | null = null;
let canvas: HTMLCanvasElement | null = null;
let observer: ResizeObserver | null = null;
let frame = 0;
let energy = 0;
let colors = DEFAULT_COLORS;
let analyser: AnalyserNode | null = null;
let analysedSource: MediaElementAudioSourceNode | null = null;
let samples = new Uint8Array(0);

const updateColors = async () => {
  const url = playerApi
    ?.getPlayerResponse()
    ?.videoDetails?.thumbnail?.thumbnails?.at(0)?.url;
  if (!url) return;

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  try {
    await image.decode();
  } catch {
    return;
  }

  // One color from each third of the cover, like the layers of the android media player.
  const third = image.naturalWidth / 3;
  colors = [0, 1, 2].map((i) => {
    const { hex } = fastAverageColor.getColor(image, {
      left: Math.round(i * third),
      top: 0,
      width: Math.round(third),
      height: image.naturalHeight,
      algorithm: 'dominant',
    });
    const color = Color(hex);
    // Dark or washed-out covers would disappear on the dark player bar.
    return color
      .saturationl(Math.max(color.saturationl(), 40))
      .lightness(Math.min(Math.max(color.lightness(), 50), 75))
      .hex();
  });
};

const onDataChange = (event: DocumentEventMap['videodatachange']) => {
  if (event.detail.name === 'dataloaded') updateColors().catch(console.error);
};

const onAudioCanPlay = ({
  detail: { audioContext, audioSource },
}: DocumentEventMap['peard:audio-can-play']) => {
  if (analysedSource === audioSource) return;

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  samples = new Uint8Array(analyser.fftSize);
  audioSource.connect(analyser);
  analysedSource = audioSource;
};

const loudness = () => {
  if (!analyser) return 0;

  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
  return Math.sqrt(sum / samples.length);
};

const draw = (time: number) => {
  frame = 0;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;

  const video = document.querySelector('video');
  const playing = !!video && !video.paused;
  // Waves swell with the music and sink flat while paused.
  const target = playing ? 0.7 + Math.min(loudness() * 2, 0.3) : 0;
  energy += (target - energy) * 0.05;

  const { width, height } = canvas;
  const scale = window.devicePixelRatio;
  context.clearRect(0, 0, width, height);
  context.globalAlpha = 0.6;
  LAYERS.forEach((layer, index) => {
    // solid at the bar, fading towards the crests so the page shows through (colors are #rrggbb, 26 is 15% alpha)
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, `${colors[index]}26`);
    gradient.addColorStop(1, colors[index]);
    context.beginPath();
    context.moveTo(0, height);
    const step = 4 * scale;
    for (let x = 0; x <= width + step; x += step) {
      const position = (x / scale) * layer.width;
      const drift = time * layer.speed;
      const wave =
        (Math.sin(position + drift + layer.phase) * 0.6) +
        (Math.sin((position * 2.3) - (drift * 1.7) + layer.phase) * 0.4);
      // below zero dips under the edge, which leaves flat gaps between the bumps
      const rise = 0.3 + (0.7 * wave);
      context.lineTo(x, height - (height * energy * layer.height * rise));
    }
    context.lineTo(width, height);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
  });

  if (playing || energy > 0.01) frame = requestAnimationFrame(draw);
};

const wake = () => {
  if (!frame) frame = requestAnimationFrame(draw);
};

export default createPlugin({
  name: () => t('plugins.player-waves.name'),
  description: () => t('plugins.player-waves.description'),
  restartNeeded: false,
  config: {
    enabled: true,
  },
  stylesheets: [style],
  renderer: {
    start() {
      const playerBar =
        document.querySelector<HTMLElement>('ytmusic-player-bar');
      if (!playerBar) return;

      canvas = document.createElement('canvas');
      canvas.id = 'player-waves';
      playerBar.prepend(canvas);

      observer = new ResizeObserver(() => {
        if (!canvas) return;
        canvas.width = Math.round(canvas.clientWidth * window.devicePixelRatio);
        canvas.height = Math.round(
          canvas.clientHeight * window.devicePixelRatio,
        );
        wake();
      });
      observer.observe(canvas);

      // media events don't bubble, so listen in the capture phase
      document.addEventListener('play', wake, true);
      document.addEventListener('videodatachange', onDataChange);
      document.addEventListener('peard:audio-can-play', onAudioCanPlay, {
        passive: true,
      });
    },

    onPlayerApiReady(api) {
      playerApi = api;
      updateColors().catch(console.error);
      wake();
    },

    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      observer?.disconnect();
      observer = null;
      canvas?.remove();
      canvas = null;

      document.removeEventListener('play', wake, true);
      document.removeEventListener('videodatachange', onDataChange);
      document.removeEventListener('peard:audio-can-play', onAudioCanPlay);

      if (analyser && analysedSource) analysedSource.disconnect(analyser);
      analyser = null;
      analysedSource = null;
    },
  },
});
