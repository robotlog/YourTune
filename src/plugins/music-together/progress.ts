// YTM's volume slider also contains a tp-yt-paper-progress track.
export const isSeekProgress = (element: Element) => {
  const slider = element.closest('tp-yt-paper-slider');
  return !slider || slider.id === 'progress-bar';
};
